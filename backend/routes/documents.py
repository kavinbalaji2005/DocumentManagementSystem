import os
import shutil
import hashlib
from flask import Blueprint, request, jsonify, current_app
from models import db, Folder, Document, Version
from utils.storage import resolve_document_directory

documents_bp = Blueprint('documents', __name__, url_prefix='/documents')

def compute_sha256(filepath):
    sha256_hash = hashlib.sha256()
    with open(filepath, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def _parse_optional_folder_id(raw_value):
    if raw_value is None or raw_value == '' or raw_value == 'null' or raw_value == 'None':
        return None
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        raise ValueError('folder_id must be an integer or null')

@documents_bp.route('/upload', methods=['POST'])
def upload_document():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    if not file.filename.lower().endswith('.docx'):
        return jsonify({'error': 'Only .docx files are supported'}), 400
        
    # Check file size (enforced by Flask MAX_CONTENT_LENGTH, but we can do a quick check if needed)
    
    try:
        folder_id = _parse_optional_folder_id(request.form.get('folder_id'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if folder_id is not None and not Folder.query.get(folder_id):
        return jsonify({'error': 'Destination folder not found'}), 404
            
    document_id = request.form.get('document_id')
    
    if document_id:
        document = Document.query.get_or_404(int(document_id))
        document.current_version_number += 1
    else:
        document_name = request.form.get('name') or file.filename
        
        # Enforce unique document name within the target folder
        existing = Document.query.filter_by(folder_id=folder_id, name=document_name).first()
        if existing:
            return jsonify({'error': f'A document named "{document_name}" already exists in this folder.'}), 409
            
        document = Document(name=document_name, folder_id=folder_id, current_version_number=1)
        db.session.add(document)
        db.session.flush() # Get document.id
        
    # Save file
    storage_root = current_app.config['STORAGE_ROOT']
    doc_dir = resolve_document_directory(storage_root, document.id)
    os.makedirs(doc_dir, exist_ok=True)
    
    # We don't have the hash yet, save temp file
    temp_path = os.path.join(doc_dir, 'temp.docx')
    file.save(temp_path)
    
    file_hash = compute_sha256(temp_path)
    file_size = os.path.getsize(temp_path)
    
    filename = f"v{document.current_version_number}_{file_hash[:8]}.docx"
    final_path = os.path.join(doc_dir, filename)
    os.replace(temp_path, final_path)
    verified_hash = compute_sha256(final_path)
    if verified_hash != file_hash:
        os.remove(final_path)
        return jsonify({'error': 'Checksum verification failed after writing file.'}), 500
    
    # Relative path for DB
    storage_path = f"documents/{document.id}/{filename}"
    
    version = Version(
        document_id=document.id,
        version_number=document.current_version_number,
        storage_path=storage_path,
        file_hash=file_hash,
        file_size=file_size,
        status='pending'
    )
    db.session.add(version)
    db.session.commit()
    
    # Trigger background extraction job
    import threading
    from jobs.extractor import process_version
    app = current_app._get_current_object()
    thread = threading.Thread(target=process_version, args=(app, version.id))
    thread.daemon = True
    thread.start()
         
    return jsonify(document.to_dict()), 201

@documents_bp.route('/<int:doc_id>', methods=['GET'])
def get_document(doc_id):
    document = Document.query.get_or_404(doc_id)
    return jsonify(document.to_dict())

@documents_bp.route('/<int:doc_id>', methods=['PATCH'])
def update_document(doc_id):
    document = Document.query.get_or_404(doc_id)
    data = request.json or {}
    new_name = data.get('name', document.name)
    new_folder_id = document.folder_id

    if 'folder_id' in data:
        try:
            new_folder_id = _parse_optional_folder_id(data['folder_id'])
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        if new_folder_id is not None and not Folder.query.get(new_folder_id):
            return jsonify({'error': 'Destination folder not found'}), 404

    # Enforce unique document name within the target folder
    if new_name != document.name or new_folder_id != document.folder_id:
        existing = Document.query.filter_by(folder_id=new_folder_id, name=new_name).first()
        if existing and existing.id != document.id:
            return jsonify({'error': f'A document named "{new_name}" already exists in the target folder.'}), 409

    if 'name' in data:
        document.name = new_name
    if 'folder_id' in data:
        document.folder_id = new_folder_id
         
    db.session.commit()
    return jsonify(document.to_dict())

@documents_bp.route('/<int:doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    document = Document.query.get_or_404(doc_id)
    
    # Delete physical files
    storage_root = current_app.config['STORAGE_ROOT']
    doc_dir = resolve_document_directory(storage_root, document.id)
    if os.path.exists(doc_dir):
        shutil.rmtree(doc_dir)
         
    db.session.delete(document)
    db.session.commit()
    return jsonify({'message': 'Document deleted successfully'})

@documents_bp.route('/<int:doc_id>/versions', methods=['GET'])
def get_versions(doc_id):
    document = Document.query.get_or_404(doc_id)
    versions = Version.query.filter_by(document_id=doc_id).order_by(Version.version_number.desc()).all()
    return jsonify([v.to_dict() for v in versions])
