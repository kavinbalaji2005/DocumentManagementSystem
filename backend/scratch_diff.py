import difflib
import re

def robust_text_diff(old_text, new_text):
    # Split by pages
    old_pages = re.split(r'(?i)##\s*Page\s+\d+', old_text)
    new_pages = re.split(r'(?i)##\s*Page\s+\d+', new_text)
    
    # Remove the first empty split if exists
    if old_pages and not old_pages[0].strip(): old_pages.pop(0)
    if new_pages and not new_pages[0].strip(): new_pages.pop(0)
    
    changes = []
    
    for i in range(max(len(old_pages), len(new_pages))):
        page_num = i + 1
        section = f"Page {page_num}"
        
        old_p = old_pages[i].strip() if i < len(old_pages) else ""
        new_p = new_pages[i].strip() if i < len(new_pages) else ""
        
        if not old_p and not new_p: continue
        
        if not old_p:
            changes.append({'type': 'added', 'text': new_p, 'section': section})
            continue
        if not new_p:
            changes.append({'type': 'removed', 'text': old_p, 'section': section})
            continue
            
        # Compare page text
        # Normalize whitespace
        old_norm = re.sub(r'\s+', ' ', old_p)
        new_norm = re.sub(r'\s+', ' ', new_p)
        
        if old_norm == new_norm:
            continue
            
        # Find differences
        matcher = difflib.SequenceMatcher(None, old_norm.split(), new_norm.split())
        
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'replace':
                old_chunk = " ".join(old_norm.split()[i1:i2])
                new_chunk = " ".join(new_norm.split()[j1:j2])
                changes.append({'type': 'modified', 'before': old_chunk, 'after': new_chunk, 'section': section})
            elif tag == 'delete':
                chunk = " ".join(old_norm.split()[i1:i2])
                changes.append({'type': 'removed', 'text': chunk, 'section': section})
            elif tag == 'insert':
                chunk = " ".join(new_norm.split()[j1:j2])
                changes.append({'type': 'added', 'text': chunk, 'section': section})
                
    return changes
