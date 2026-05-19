import json
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
- **Extreme Brevity**: Use sentence fragments.
- **Formatting**: Use the exact headers shown above. Omit a header if its category has no major changes.
- **Delta**: For modifications, use the format: "**Old Value** → **New Value**".
- **Direct Output**: No preamble and no sign-off. Jump straight to the headers."""

def _clean_text(value):
    if value is None:
        return ''
    return str(value).strip()


def _categorize_changes(changes):
    added = []
    removed = []
    modified = []

    for change in changes:
        if not isinstance(change, dict):
            continue

        change_type = change.get('type')
        section = change.get('section', 'General')
        
        if change_type == 'added':
            text = _clean_text(change.get('text'))
            if text:
                added.append({'text': text, 'section': section})
        elif change_type == 'removed':
            text = _clean_text(change.get('text'))
            if text:
                removed.append({'text': text, 'section': section})
        elif change_type == 'modified':
            before = _clean_text(change.get('before'))
            after = _clean_text(change.get('after'))
            if before or after:
                modified.append({'before': before, 'after': after, 'section': section})

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


@ai_bp.route('/summarize-diff', methods=['POST'])
@token_required
def summarize_diff():
    data = request.get_json(silent=True) or {}
    version_id = data.get('version_id')
    
    if not version_id:
        return jsonify({'error': 'version_id is required'}), 400
        
    version = Version.query.get_or_404(version_id)
    
    # Permission check via document
    denied = require_permission('document', version.document_id, 'version:view')
    if denied:
        return denied
    
    if not version.diff_json:
        return jsonify({'error': 'No diff available to summarize. Document might not have previous versions.'}), 400
        
    try:
        changes = json.loads(version.diff_json)
    except Exception as e:
        return jsonify({'error': 'Failed to parse diff_json'}), 500

    added, removed, modified = _categorize_changes(changes)
    if not added and not removed and not modified:
        return jsonify({'summary': 'No meaningful changes detected.'})

    prompt = _build_prompt(added, removed, modified)
        
    api_key = current_app.config.get('OPENROUTER_API_KEY')
        
    try:
        client = openai.OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key,
        )
        
        response = client.chat.completions.create(
            model="openai/gpt-oss-120b:free",
            messages=[
                {"role": "system", "content": SYSTEM_INSTRUCTION},
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
        
        version.ai_summary = summary
        from models import db
        db.session.commit()
        
        from utils.audit import log_document_action
        log_document_action(version.document_id, 'AI_SUMMARIZE', {'version': version.version_number})
        
        return jsonify({'summary': summary})
        
    except Exception as e:
        return jsonify({'error': f'AI Summarization failed: {str(e)}'}), 500
