import json
from flask import Blueprint, request, jsonify, current_app
from google import genai
from google.genai import types
from models import Version
from utils.observability import log_event

ai_bp = Blueprint('ai', __name__, url_prefix='/ai')

SYSTEM_INSTRUCTION = """You are a Senior Document Analyst. You will receive a list of changes grouped by their document SECTION.

Your task is to provide a clean, high-level summary of only the most significant changes.

MARKDOWN STRUCTURE:
### **DELETIONS**
- [Concise bullet]
### **ADDITIONS**
- [Concise bullet]
### **MODIFICATIONS**
- [Concise bullet]

RULES:
- **Use Section Context**: If a change is in a specific section, mention it if relevant.
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
    # Group by section for hierarchical context
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
def summarize_diff():
    data = request.get_json(silent=True) or {}
    version_id = data.get('version_id')
    
    if not version_id:
        return jsonify({'error': 'version_id is required'}), 400
        
    version = Version.query.get_or_404(version_id)
    log_event(current_app.logger, "ai_summary_requested", version_id=version.id, document_id=version.document_id)
    
    if not version.diff_json:
        return jsonify({'error': 'No diff available to summarize. Document might not have previous versions.'}), 400
        
    try:
        changes = json.loads(version.diff_json)
    except Exception as e:
        log_event(current_app.logger, "ai_summary_failed", level="error", version_id=version.id, error=str(e))
        return jsonify({'error': 'Failed to parse diff_json'}), 500

    added, removed, modified = _categorize_changes(changes)
    if not added and not removed and not modified:
        log_event(current_app.logger, "ai_summary_skipped", version_id=version.id, reason="no_meaningful_changes")
        return jsonify({'summary': 'No meaningful changes detected.'})

    prompt = _build_prompt(added, removed, modified)
    log_event(
        current_app.logger,
        "ai_summary_prompt_built",
        version_id=version.id,
        added_count=len(added),
        removed_count=len(removed),
        modified_count=len(modified),
        prompt_chars=len(prompt)
    )
        
    api_key = current_app.config.get('GEMINI_API_KEY')
    if not api_key:
        log_event(current_app.logger, "ai_summary_skipped", version_id=version.id, reason="missing_api_key")
        return jsonify({'summary': 'AI Summarization is not configured (missing GEMINI_API_KEY).'})
        
    try:
        client = genai.Client(api_key=api_key)
        
        response = client.models.generate_content(
            model='gemini-3-flash-preview',
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
            )
        )
        
        summary = response.text
        if not summary or not str(summary).strip():
            summary = "AI summary generation resulted in an empty response. This can happen if the changes are too subtle for the model or due to provider rate limits. Please try regenerating in a moment."
        
        # Save summary to DB
        version.ai_summary = summary
        from models import db
        db.session.commit()
        log_event(current_app.logger, "ai_summary_generated", version_id=version.id, summary_chars=len(summary or ""))
        
        return jsonify({'summary': summary})
        
    except Exception as e:
        log_event(current_app.logger, "ai_summary_failed", level="error", version_id=version.id, error=str(e))
        return jsonify({'error': f'AI Summarization failed: {str(e)}'}), 500
