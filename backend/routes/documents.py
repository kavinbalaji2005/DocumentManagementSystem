import os
import shutil
import hashlib
from flask import Blueprint, request, jsonify, current_app
from models import db, Folder, Document, Version
from utils.storage import resolve_document_directory
from utils.observability import log_event

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
    log_event(
        current_app.logger,
        "upload_received",
        filename=file.filename,
        folder_id=folder_id,
        document_id=document_id
    )
    
    if document_id:
        document = Document.query.get_or_404(int(document_id))
        document.current_version_number += 1
    else:
        document_name = request.form.get('name') or file.filename
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
        log_event(
            current_app.logger,
            "upload_checksum_failed",
            level="error",
            document_id=document.id,
            version_number=document.current_version_number,
            expected_hash=file_hash,
            actual_hash=verified_hash
        )
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
    log_event(
        current_app.logger,
        "upload_saved",
        document_id=document.id,
        version_id=version.id,
        version_number=version.version_number,
        file_size=file_size,
        file_hash=file_hash
    )
    
    # Trigger background extraction job
    import threading
    from jobs.extractor import process_version
    app = current_app._get_current_object()
    thread = threading.Thread(target=process_version, args=(app, version.id))
    thread.daemon = True
    thread.start()
    log_event(current_app.logger, "extract_job_enqueued", version_id=version.id, document_id=document.id)
         
    return jsonify(document.to_dict()), 201

@documents_bp.route('/<int:doc_id>', methods=['GET'])
def get_document(doc_id):
    document = Document.query.get_or_404(doc_id)
    return jsonify(document.to_dict())

@documents_bp.route('/<int:doc_id>', methods=['PATCH'])
def update_document(doc_id):
    document = Document.query.get_or_404(doc_id)
    data = request.json or {}
    
    if 'name' in data:
        document.name = data['name']

    if 'folder_id' in data:
        try:
            new_folder_id = _parse_optional_folder_id(data['folder_id'])
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        if new_folder_id is not None and not Folder.query.get(new_folder_id):
            return jsonify({'error': 'Destination folder not found'}), 404

        previous_folder_id = document.folder_id
        document.folder_id = new_folder_id
        if previous_folder_id != new_folder_id:
            log_event(
                current_app.logger,
                "document_moved",
                document_id=document.id,
                from_folder_id=previous_folder_id,
                to_folder_id=new_folder_id
            )
         
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
        log_event(current_app.logger, "document_storage_deleted", document_id=document.id, path=doc_dir)
         
    db.session.delete(document)
    db.session.commit()
    log_event(current_app.logger, "document_deleted", document_id=document.id)
    return jsonify({'message': 'Document deleted successfully'})

@documents_bp.route('/<int:doc_id>/versions', methods=['GET'])
def get_versions(doc_id):
    document = Document.query.get_or_404(doc_id)
    versions = Version.query.filter_by(document_id=doc_id).order_by(Version.version_number.desc()).all()
    return jsonify([v.to_dict() for v in versions])
