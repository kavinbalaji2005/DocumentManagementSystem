import json
import difflib
import re
from flask import Blueprint, request, jsonify, current_app, g
import openai
from models import Version
from routes.auth import token_required
from utils.permissions import require_permission

ai_bp = Blueprint('ai', __name__, url_prefix='/ai')

SYSTEM_INSTRUCTION = """You are a Document Analyst. You will receive a list of changes grouped by their document SECTION.

Your task is to provide a clean, high-level summary of only the most significant changes.

MARKDOWN STRUCTURE:
### **DELETIONS**
- [Concise bullet]
### **ADDITIONS**
- [Concise bullet]
### **MODIFICATIONS**
- [Concise bullet]

RULES:
- **Be Highly Selective**: Only report changes that significantly alter the document's meaning or data. Omit minor details.
- **Ignore OCR Artifacts**: Because the text is extracted from PDFs, sometimes text is merged into titles, or lists are parsed as tables in different versions. If you see text removed from one place and added to another, or merged into a header, DO NOT report it as a modification, addition, or deletion. ONLY report true, semantic data changes.
- **Extreme Brevity**: Use sentence fragments.
- **Formatting**: Use the exact headers shown above. Omit a header if its category has no major changes.
- **Delta**: For modifications, use the format: "**Old Value** → **New Value**".
- **Direct Output**: No preamble and no sign-off. Jump straight to the headers."""

PDF_SYSTEM_INSTRUCTION = """You are a strict PDF changelog generator. You receive a machine-generated diff of text blocks extracted from two PDF versions. Each change is tagged ADDED, REMOVED, or MODIFIED and grouped under a SECTION label that contains the Page number.

Your ONLY job is to output a concise, highly readable changelog in the EXACT markdown format below.

OUTPUT FORMAT (use these exact headers, omit a header if its category is empty):
### **DELETIONS**
- [bullet]
### **ADDITIONS**
- [bullet]
### **MODIFICATIONS**
- [bullet]

STRICT RULES FOR ALL DOCUMENT TYPES:
1. PAGE REFERENCES: ALWAYS begin each bullet with the Page number from the SECTION label. Example: "Page 5: Removed paragraph about fee structure."
2. ENTIRE PAGES: If a single page is entirely added or removed, report it as "Page X: Page removed/added." Do NOT list its contents.
3. PAGE GROUPING: If multiple consecutive pages are entirely added/removed, GROUP them. Example: "Pages 79-90: Pages removed."
4. SEMANTIC FOCUS: Describe the MEANING of the change. Do NOT act like a literal diff tool. Instead of "Changed X to Y", say "Updated course prerequisites" or "Revised contact information" unless the exact value is critical (like a date or amount).
5. IGNORE NOISE: You MUST ignore changes that are purely whitespace, punctuation, special characters (like '|' or '&'), OCR artifacts, or repetitive header/footer text.
6. TABLE & LIST SUMMARIZATION: If a table, list, or large section has many individual changes, summarize the overarching change (e.g., "Page 4: Financial table values updated.").
7. BREVITY: Use sentence fragments. Keep each bullet under 15-20 words.
8. AGGREGATION: If a page has scattered minor text tweaks, group them into a single bullet like "Page 3: Minor phrasing adjustments."
9. NO FLUFF: Output ONLY the markdown headers and bullets. No introduction, no conclusion, no commentary.

EXAMPLE OUTPUT:
### **DELETIONS**
- Pages 7-9: Pages removed.
### **ADDITIONS**
- Page 1: New header block with chairperson details added.
### **MODIFICATIONS**
- Page 2: Academic year changed from **2015-2016** to **2016-2017**.
- Page 4: Revenue table values updated."""

def _clean_text(value):
    if value is None:
        return ''
    return str(value).strip()


def _categorize_changes(changes, is_pdf=False):
    added = []
    removed = []
    modified = []

    def _truncate(t):
        if is_pdf and len(t) > 200:
            return t[:200] + "... [TRUNCATED FOR PDF SUMMARY]"
        return t

    for change in changes:
        if not isinstance(change, dict):
            continue

        change_type = change.get('type')
        section = change.get('section', 'General')
        
        if change_type == 'added':
            text = _clean_text(change.get('text'))
            if text:
                added.append({'text': _truncate(text), 'section': section})
        elif change_type == 'removed':
            text = _clean_text(change.get('text'))
            if text:
                removed.append({'text': _truncate(text), 'section': section})
        elif change_type == 'modified':
            before = _clean_text(change.get('before'))
            after = _clean_text(change.get('after'))
            if before or after:
                import re
                before_norm = re.sub(r'\s+', ' ', before).strip()
                after_norm = re.sub(r'\s+', ' ', after).strip()
                if before_norm != after_norm:
                    modified.append({'before': _truncate(before), 'after': _truncate(after), 'section': section})

    return added, removed, modified


def _build_prompt(added, removed, modified):
    sections = {}
    
    for item in added:
        sec = item['section']
        if sec not in sections: sections[sec] = []
        sections[sec].append(f'ADDED: "{item["text"]}"')
        
    for item in removed:
        sec = item['section']
        if sec not in sections: sections[sec] = []
        sections[sec].append(f'REMOVED: "{item["text"]}"')
        
    for item in modified:
        sec = item['section']
        if sec not in sections: sections[sec] = []
        sections[sec].append(f'MODIFIED: "{item["before"]}" → "{item["after"]}"')

    delta_lines = []
    for sec, changes in sections.items():
        delta_lines.append(f"SECTION: {sec}")
        for c in changes:
            delta_lines.append(f"  {c}")
        delta_lines.append("")

    delta = "\n".join(delta_lines)

    return (
        f"The document was updated with {len(added)} addition(s), "
        f"{len(removed)} removal(s), and {len(modified)} modification(s).\n\n"
        f"Hierarchical Changes:\n{delta}"
    )


def _compute_robust_pdf_diff(old_text, new_text):
    old_pages = re.split(r'(?i)##\s*Page\s+\d+', old_text or "")
    new_pages = re.split(r'(?i)##\s*Page\s+\d+', new_text or "")
    
    if old_pages and not old_pages[0].strip(): old_pages.pop(0)
    if new_pages and not new_pages[0].strip(): new_pages.pop(0)
    
    added, removed, modified = [], [], []
    
    for i in range(max(len(old_pages), len(new_pages))):
        page_num = i + 1
        section = f"Page {page_num}"
        
        old_p = old_pages[i].strip() if i < len(old_pages) else ""
        new_p = new_pages[i].strip() if i < len(new_pages) else ""
        
        if not old_p and not new_p: continue
        
        if not old_p:
            added.append({'text': '[ENTIRE PAGE ADDED]', 'section': section})
            continue
        if not new_p:
            removed.append({'text': '[ENTIRE PAGE REMOVED]', 'section': section})
            continue
            
        old_norm = re.sub(r'\s+', ' ', old_p)
        new_norm = re.sub(r'\s+', ' ', new_p)
        
        if old_norm == new_norm:
            continue
            
        matcher = difflib.SequenceMatcher(None, old_norm.split(), new_norm.split())
        
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'replace':
                old_chunk = " ".join(old_norm.split()[i1:i2])
                new_chunk = " ".join(new_norm.split()[j1:j2])
                modified.append({'before': old_chunk, 'after': new_chunk, 'section': section})
            elif tag == 'delete':
                chunk = " ".join(old_norm.split()[i1:i2])
                removed.append({'text': chunk, 'section': section})
            elif tag == 'insert':
                chunk = " ".join(new_norm.split()[j1:j2])
                added.append({'text': chunk, 'section': section})
                
    return added, removed, modified


@ai_bp.route('/summarize-diff', methods=['POST'])
@token_required
def summarize_diff():
    data = request.get_json(silent=True) or {}
    version_id = data.get('version_id')
    
    if not version_id:
        return jsonify({'error': 'version_id is required'}), 400
        
    version = Version.query.get_or_404(version_id)
    
    # Permission check via document
    denied = require_permission('document', version.document_id, 'ai:diff_summary')
    if denied:
        return denied
        
    is_pdf = version.storage_path and version.storage_path.lower().endswith('.pdf')
    
    if is_pdf:
        previous_version = Version.query.filter(
            Version.document_id == version.document_id,
            Version.version_number < version.version_number,
            Version.status == 'success'
        ).order_by(Version.version_number.desc()).first()
        def _rebuild_text_with_pages(version_obj):
            if not version_obj or not version_obj.extracted_blocks_json:
                return version_obj.extracted_text if version_obj else ""
            try:
                blocks = json.loads(version_obj.extracted_blocks_json)
                pages = {}
                for b in blocks:
                    sec = b.get('section', 'Page 1')
                    match = re.search(r'(?i)(Page\s+\d+)', sec)
                    page_label = match.group(1) if match else 'Page 1'
                    if page_label not in pages: pages[page_label] = []
                    pages[page_label].append(b.get('text', ''))
                
                text_parts = []
                for label, texts in pages.items():
                    text_parts.append(f"## {label}")
                    text_parts.extend(texts)
                return "\n\n".join(text_parts)
            except Exception:
                return version_obj.extracted_text
                
        old_text = _rebuild_text_with_pages(previous_version)
        new_text = _rebuild_text_with_pages(version)
        added, removed, modified = _compute_robust_pdf_diff(old_text, new_text)
    else:
        if not version.diff_json:
            return jsonify({'error': 'No diff available to summarize. Document might not have previous versions.'}), 400
            
        try:
            changes = json.loads(version.diff_json)
        except Exception as e:
            return jsonify({'error': 'Failed to parse diff_json'}), 500
            
        added, removed, modified = _categorize_changes(changes, is_pdf=is_pdf)
        
    if not added and not removed and not modified:
        return jsonify({'summary': 'No structural or content changes detected.'})

    prompt = _build_prompt(added, removed, modified)
        
    api_key = current_app.config.get('OPENROUTER_API_KEY')
        
    try:
        client = openai.OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
        )
        
        instruction = PDF_SYSTEM_INSTRUCTION if is_pdf else SYSTEM_INSTRUCTION
        
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b:free",
            messages=[
                {"role": "system", "content": instruction},
                {"role": "user", "content": prompt}
            ]
        )
        
        summary = response.choices[0].message.content
        if not summary or not str(summary).strip():
            summary = "AI summary generation couldnt be generated. This can happen due to provider rate limits. Please try regenerating in a moment."

        prompt_tokens = response.usage.prompt_tokens if hasattr(response, 'usage') and response.usage else 0
        comp_tokens = response.usage.completion_tokens if hasattr(response, 'usage') and response.usage else 0
        try:
            stats = json.loads(version.stats_json) if version.stats_json else{}
            stats['ai_prompt_tokens'] = prompt_tokens
            stats['ai_completion_tokens'] = comp_tokens
            version.stats_json = json.dumps(stats)
        except Exception:
            pass
        
        is_regenerate = bool(version.ai_summary)
        version.ai_summary = summary
        from models import db
        db.session.commit()
        
        from utils.audit import log_document_action
        action_type = 'AI_REGENERATE' if is_regenerate else 'AI_SUMMARIZE'
        log_document_action(version.document_id, action_type, {'version': version.version_number})
        
        return jsonify({'summary': summary})
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'AI Summarization failed: {str(e)}'}), 500
