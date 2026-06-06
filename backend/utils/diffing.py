import json
from difflib import SequenceMatcher
from html import escape
from diff_match_patch import diff_match_patch


def coerce_blocks(blocks_json=None, extracted_text=None):
    if blocks_json:
        try:
            parsed = json.loads(blocks_json)
            if isinstance(parsed, list):
                return parsed
        except (TypeError, ValueError, json.JSONDecodeError):
            pass

    if extracted_text:
        paragraphs = [segment for segment in extracted_text.split('\n\n') if segment.strip()]
        return [{'type': 'paragraph', 'text': paragraph} for paragraph in paragraphs]

    return []


import re

def _strip_layout_artifacts(text):
    if not text:
        return text
    text = str(text)
    # Strip leading vertical pipe
    text = re.sub(r'^\s*\|\s*', '', text)
    # Strip trailing dash, hyphen, or pipe
    text = re.sub(r'\s*[-\|]\s*$', '', text)
    return text.strip()

def _block_text(block):
    if not isinstance(block, dict):
        return ''

    text = block.get('text')
    if text is not None:
        val = str(text).replace('\r\n', '\n').strip()
        return _strip_layout_artifacts(val)

    data = block.get('data')
    if isinstance(data, list):
        rows = []
        for row in data:
            if isinstance(row, list):
                rows.append(' | '.join(_strip_layout_artifacts(cell) for cell in row))
            else:
                rows.append(_strip_layout_artifacts(row))
        return '\n'.join(rows)

    return ''


def _render_block_html(text):
    safe_text = escape(text).replace('\n', '<br>')
    return f'<p>{safe_text}</p>'


def _compute_inline_html_diff(old_text, new_text):
    dmp = diff_match_patch()
    diffs = dmp.diff_main(old_text, new_text)
    dmp.diff_cleanupSemantic(diffs)

    html_parts = []
    added_chars = 0
    removed_chars = 0

    for operation, text in diffs:
        safe_text = escape(text).replace('\n', '<br>')
        if operation == 1:
            html_parts.append(f'<ins>{safe_text}</ins>')
            added_chars += len(text)
        elif operation == -1:
            html_parts.append(f'<del>{safe_text}</del>')
            removed_chars += len(text)
        else:
            html_parts.append(safe_text)

    return ''.join(html_parts), added_chars, removed_chars


def compute_block_diff(old_blocks, new_blocks):
    old_texts = [_block_text(block) for block in old_blocks]
    new_texts = [_block_text(block) for block in new_blocks]

    matcher = SequenceMatcher(a=old_texts, b=new_texts, autojunk=False)

    stats = {
        'added_chars': 0,
        'removed_chars': 0,
        'added_blocks': 0,
        'removed_blocks': 0,
        'modified_blocks': 0,
    }
    diff_html_parts = []
    diff_changes = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            for text in new_texts[j1:j2]:
                diff_html_parts.append(_render_block_html(text))
            continue

        if tag == 'delete':
            for idx, text in enumerate(old_texts[i1:i2]):
                block = old_blocks[i1 + idx]
                diff_html_parts.append(f'<del>{_render_block_html(text)}</del>')
                
                if text.strip():
                    diff_changes.append({
                        'type': 'removed', 
                        'text': text,
                        'section': block.get('section', 'General')
                    })
                stats['removed_blocks'] += 1
                stats['removed_chars'] += len(text)
            continue

        if tag == 'insert':
            for idx, text in enumerate(new_texts[j1:j2]):
                block = new_blocks[j1 + idx]
                diff_html_parts.append(f'<ins>{_render_block_html(text)}</ins>')
                
                if text.strip():
                    diff_changes.append({
                        'type': 'added', 
                        'text': text,
                        'section': block.get('section', 'General')
                    })
                stats['added_blocks'] += 1
                stats['added_chars'] += len(text)
            continue

        # replace
        old_segment = old_texts[i1:i2]
        new_segment = new_texts[j1:j2]
        
        old_text_joined = "\n".join(old_segment)
        new_text_joined = "\n".join(new_segment)
        
        inline_html, added_chars, removed_chars = _compute_inline_html_diff(old_text_joined, new_text_joined)
        diff_html_parts.append(f'<p>{inline_html}</p>')
        
        import re
        old_norm = re.sub(r'\s+', ' ', old_text_joined).strip()
        new_norm = re.sub(r'\s+', ' ', new_text_joined).strip()
        
        if old_norm != new_norm:
            block = new_blocks[j1] if j1 < len(new_blocks) else old_blocks[i1]
            diff_changes.append({
                'type': 'modified', 
                'before': old_text_joined, 
                'after': new_text_joined,
                'section': block.get('section', 'General')
            })
            
        stats['modified_blocks'] += max(len(old_segment), len(new_segment))
        stats['added_chars'] += added_chars
        stats['removed_chars'] += removed_chars

    return ''.join(diff_html_parts), stats, diff_changes


