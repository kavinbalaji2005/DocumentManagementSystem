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


def _block_text(block):
    if not isinstance(block, dict):
        return ''

    text = block.get('text')
    if text is not None:
        return str(text).replace('\r\n', '\n').strip()

    data = block.get('data')
    if isinstance(data, list):
        rows = []
        for row in data:
            if isinstance(row, list):
                rows.append(' | '.join(str(cell).strip() for cell in row))
            else:
                rows.append(str(row).strip())
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
        paired_count = min(len(old_segment), len(new_segment))

        for idx in range(paired_count):
            old_text = old_segment[idx]
            new_text = new_segment[idx]
            block = new_blocks[j1 + idx]
            inline_html, added_chars, removed_chars = _compute_inline_html_diff(old_text, new_text)
            diff_html_parts.append(f'<p>{inline_html}</p>')
            diff_changes.append({
                'type': 'modified', 
                'before': old_text, 
                'after': new_text,
                'section': block.get('section', 'General')
            })
            stats['modified_blocks'] += 1
            stats['added_chars'] += added_chars
            stats['removed_chars'] += removed_chars

        for idx in range(paired_count, len(old_segment)):
            text = old_segment[idx]
            block = old_blocks[i1 + idx]
            diff_html_parts.append(f'<del>{_render_block_html(text)}</del>')
            diff_changes.append({
                'type': 'removed', 
                'text': text,
                'section': block.get('section', 'General')
            })
            stats['removed_blocks'] += 1
            stats['removed_chars'] += len(text)

        for idx in range(paired_count, len(new_segment)):
            text = new_segment[idx]
            block = new_blocks[j1 + idx]
            diff_html_parts.append(f'<ins>{_render_block_html(text)}</ins>')
            diff_changes.append({
                'type': 'added', 
                'text': text,
                'section': block.get('section', 'General')
            })
            stats['added_blocks'] += 1
            stats['added_chars'] += len(text)

    return ''.join(diff_html_parts), stats, diff_changes

def compute_visual_html_diff(old_html, new_html):
    """
    Computes a visual diff between two HTML strings by tokenizing them into
    tags, words, and whitespace. This preserves the document structure (tables, headers)
    while highlighting text changes.
    """
    import re
    from difflib import SequenceMatcher

    # Normalize newlines
    old_html = (old_html or "").replace('\r\n', '\n')
    new_html = (new_html or "").replace('\r\n', '\n')

    # Tokenize: Tags are one token, non-whitespace text blocks are another, and whitespace is another.
    token_pattern = re.compile(r'(<[^>]+>|[^<>\s]+|\s+)')
    
    old_tokens = token_pattern.findall(old_html)
    new_tokens = token_pattern.findall(new_html)
    
    matcher = SequenceMatcher(a=old_tokens, b=new_tokens, autojunk=False)
    
    result_parts = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            result_parts.extend(new_tokens[j1:j2])
        elif tag == 'insert':
            for token in new_tokens[j1:j2]:
                if token.startswith('<') or not token.strip():
                    result_parts.append(token)
                else:
                    result_parts.append(f'<ins>{token}</ins>')
        elif tag == 'delete':
            for token in old_tokens[i1:i2]:
                if not token.startswith('<') and token.strip():
                    result_parts.append(f'<del>{token}</del>')
        elif tag == 'replace':
            # Delete old text tokens
            for token in old_tokens[i1:i2]:
                if not token.startswith('<') and token.strip():
                    result_parts.append(f'<del>{token}</del>')
            # Insert new tokens, preserving tags and ignoring pure whitespace changes
            for token in new_tokens[j1:j2]:
                if token.startswith('<') or not token.strip():
                    result_parts.append(token)
                else:
                    result_parts.append(f'<ins>{token}</ins>')
                    
    return "".join(result_parts)
