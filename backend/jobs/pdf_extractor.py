"""
PDF text extraction using Mistral Document AI OCR.

Uploads the PDF to Mistral, obtains a signed URL, runs OCR with
mistral-ocr-latest, and returns structured blocks compatible with
the existing docx extraction pipeline.
"""

import os
import markdown as md
from mistralai.client import Mistral


def extract_pdf_blocks(filepath, api_key):
    """
    Extract text blocks from a PDF using Mistral Document AI OCR.

    Args:
        filepath: Absolute path to the PDF file on disk.
        api_key:  Mistral API key.

    Returns:
        Tuple of (blocks, html, plain_text) where:
          - blocks: list of dicts matching the docx block schema
                    [{type, text, section}, ...]
          - html:   HTML string generated from the OCR Markdown output
          - plain_text: concatenated plain text from all pages
    """
    if not api_key:
        raise ValueError("MISTRAL_API_KEY is not configured. Cannot process PDF files.")

    client = Mistral(api_key=api_key)

    # 1. Upload the PDF to Mistral
    filename = os.path.basename(filepath)
    with open(filepath, "rb") as f:
        uploaded_file = client.files.upload(
            file={
                "file_name": filename,
                "content": f,
            },
            purpose="ocr",
        )

    # 2. Get a signed URL for the uploaded file
    signed_url_response = client.files.get_signed_url(file_id=uploaded_file.id)

    # 3. Run OCR
    ocr_response = client.ocr.process(
        model="mistral-ocr-latest",
        document={
            "type": "document_url",
            "document_url": signed_url_response.url,
        },
    )

    # 4. Parse the OCR response into structured blocks
    import re

    def clean_image_references(markdown_text):
        pattern = r'!\[(.*?)\]\((.*?)\)'
        
        def repl(match):
            alt = match.group(1) or "Captured Illustration / Figure"
            url = match.group(2) or ""
            
            if url.startswith(('http://', 'https://', 'data:')):
                return match.group(0)
                
            return f"""
<div class="ocr-image-reference font-sans my-6 p-4 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg bg-neutral-50/50 dark:bg-neutral-800/30 flex items-center space-x-3 text-neutral-400 select-none">
  <svg class="w-6 h-6 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
  </svg>
  <span class="font-medium text-sm text-neutral-600 dark:text-neutral-300 text-left">{alt}</span>
</div>
"""
        return re.sub(pattern, repl, markdown_text)

    def strip_image_markdown(text):
        return re.sub(r'!\[(.*?)\]\((.*?)\)', r'[Figure: \1]', text)

    def _normalize_ocr_text(text):
        """Normalize OCR-extracted text to reduce false diffs between runs."""
        if not text:
            return text
        # Merge hyphenated line-break words (e.g. "mon-\nitoring" -> "monitoring")
        text = re.sub(r'(\w)-\s+(\w)', r'\1\2', text)
        # Normalize unicode quotes to ASCII
        text = text.replace('\u2018', "'").replace('\u2019', "'")
        text = text.replace('\u201c', '"').replace('\u201d', '"')
        # Normalize unicode dashes to regular hyphens
        text = text.replace('\u2013', '-').replace('\u2014', '-')
        # Normalize bullet characters
        text = re.sub(r'[\u2022\u2023\u25e6\u2043\u2219]', '-', text)
        # Collapse multiple spaces into one
        text = re.sub(r'[ \t]+', ' ', text)
        # Strip leading/trailing pipe or dash layout artifacts
        text = re.sub(r'^\s*\|\s*', '', text)
        text = re.sub(r'\s*\|\s*$', '', text)
        return text.strip()

    blocks = []
    all_markdown_parts = []
    all_text_parts = []

    # Track current section context dynamically across pages, starting with "Intro"
    current_section_holder = ["Intro"]

    for page in ocr_response.pages:
        page_index = page.index  # 0-based page index
        page_label = f"Page {page_index + 1}"
        page_markdown = page.markdown.strip() if page.markdown else ""

        if not page_markdown:
            continue

        cleaned_markdown = clean_image_references(page_markdown)
        all_markdown_parts.append(f"## {page_label}\n\n{cleaned_markdown}")

        # Parse page Markdown structurally into high-fidelity blocks
        lines = page_markdown.split('\n')
        i = 0
        n = len(lines)

        while i < n:
            line = lines[i].strip()
            if not line:
                i += 1
                continue

            # 1. Heading Detection
            if line.startswith('#'):
                hashes = len(line) - len(line.lstrip('#'))
                if hashes > 0 and hashes < len(line) and line[hashes] == ' ':
                    header_text = line.lstrip('#').strip()
                    # Strip any markdown image references if present
                    header_text = strip_image_markdown(header_text)
                    header_text = _normalize_ocr_text(header_text)
                    current_section_holder[0] = header_text # Update context

                    blocks.append({
                        'type': 'header',
                        'text': header_text,
                        'section': f"{page_label} ({current_section_holder[0]})"
                    })
                    all_text_parts.append(header_text)
                    i += 1
                    continue

            # 2. Table Detection
            if line.startswith('|'):
                table_lines = []
                while i < n and lines[i].strip().startswith('|'):
                    table_lines.append(lines[i].strip())
                    i += 1

                table_data = []
                for t_line in table_lines:
                    # Skip separator lines like |---|---|
                    if re.match(r'^\|[\s\-\|:]+\|$', t_line):
                        continue
                    # Split by pipe and clean
                    row_cells = [cell.strip() for cell in t_line.split('|')]
                    if row_cells and row_cells[0] == '':
                        row_cells.pop(0)
                    if row_cells and row_cells[-1] == '':
                        row_cells.pop()
                    if row_cells:
                        # Clean image references in cells
                        row_cells = [_normalize_ocr_text(strip_image_markdown(c)) for c in row_cells]
                        table_data.append(row_cells)

                if table_data:
                    text_repr = '\n'.join([' | '.join(row) for row in table_data])
                    blocks.append({
                        'type': 'table',
                        'data': table_data,
                        'text': text_repr,
                        'section': f"{page_label} ({current_section_holder[0]})"
                    })
                    all_text_parts.append(text_repr)
                continue

            # 3. Regular Paragraph / Text Blocks
            para_lines = []
            while i < n:
                curr_line = lines[i].strip()
                if not curr_line:
                    break
                if curr_line.startswith('#') or curr_line.startswith('|'):
                    break
                para_lines.append(curr_line)
                i += 1

            if para_lines:
                para_text = ' '.join(para_lines)
                clean_text = strip_image_markdown(para_text)
                clean_text = _normalize_ocr_text(clean_text)
                blocks.append({
                    'type': 'paragraph',
                    'text': clean_text,
                    'section': f"{page_label} ({current_section_holder[0]})"
                })
                all_text_parts.append(clean_text)

    # 5. Convert combined Markdown to HTML
    combined_markdown = "\n\n".join(all_markdown_parts)
    html = md.markdown(combined_markdown, extensions=["tables", "fenced_code"])

    # 6. Build plain text
    plain_text = "\n\n".join(all_text_parts)

    # 7. Clean up: delete the uploaded file from Mistral
    try:
        client.files.delete(file_id=uploaded_file.id)
    except Exception:
        pass  # Non-critical, ignore cleanup failures

    return blocks, html, plain_text
