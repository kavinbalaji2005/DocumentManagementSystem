import os
import shutil
import hashlib
from flask import Blueprint, request, jsonify, current_app, g
from models import db, Folder, Document, Version, ResourcePermission
from routes.auth import token_required, admin_required, admin_or_manager_required
from utils.storage import resolve_document_directory
from utils.audit import log_document_action
from utils.permissions import (
    require_permission, has_permission, get_effective_permissions,
    get_permissions_for_resource
)

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
@token_required
def upload_document():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
        
    if not file.filename.lower().endswith('.docx') and not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Only .docx and .pdf files are supported'}), 400
    
    # Validate MIME type
    allowed_mimes = {
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/pdf',
    }
    if file.content_type and file.content_type not in allowed_mimes:
        return jsonify({'error': f'Unsupported file type: {file.content_type}. Only .docx and .pdf files are accepted.'}), 400
    
    # Determine file extension
    file_ext = '.pdf' if file.filename.lower().endswith('.pdf') else '.docx'
    
    try:
        folder_id = _parse_optional_folder_id(request.form.get('folder_id'))
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if folder_id is not None and not Folder.query.get(folder_id):
        return jsonify({'error': 'Destination folder not found'}), 404
            
    document_id = request.form.get('document_id')
    
    if document_id:
        # Uploading new version — require version:create
        document = Document.query.get_or_404(int(document_id))
        denied = require_permission('document', document.id, 'version:create')
        if denied:
            return denied
        document.current_version_number += 1
    else:
        # Uploading new document — require document:create on folder
        if folder_id is not None:
            denied = require_permission('folder', folder_id, 'document:create')
            if denied:
                return denied
        else:
            # Root-level upload — only Admin/Manager
            if g.user.role == 'Employee':
                return jsonify({'error': 'You do not have permission to upload to root level'}), 403

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
    
    temp_path = os.path.join(doc_dir, f'temp{file_ext}')
    file.save(temp_path)
    
    file_hash = compute_sha256(temp_path)
    file_size = os.path.getsize(temp_path)
    
    filename = f"v{document.current_version_number}_{file_hash[:8]}{file_ext}"
    final_path = os.path.join(doc_dir, filename)
    os.replace(temp_path, final_path)
    verified_hash = compute_sha256(final_path)
    if verified_hash != file_hash:
        os.remove(final_path)
        return jsonify({'error': 'Checksum verification failed after writing file.'}), 500
    
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
    
    if document_id:
        log_document_action(document.id, 'VERSION_UPLOAD', {'version': document.current_version_number})
    else:
        log_document_action(document.id, 'CREATE', {'name': document.name, 'folder_id': document.folder_id})
         
    return jsonify(document.to_dict()), 201

@documents_bp.route('/<int:doc_id>', methods=['GET'])
@token_required
def get_document(doc_id):
    document = Document.query.get_or_404(doc_id)
    
    # Permission check
    denied = require_permission('document', doc_id, 'document:view')
    if denied:
        return denied
    
    result = document.to_dict()
    # Include effective permissions for the current user
    result['effective_permissions'] = get_effective_permissions(g.user, 'document', doc_id)
    return jsonify(result)

@documents_bp.route('/<int:doc_id>', methods=['PATCH'])
@token_required
def update_document(doc_id):
    document = Document.query.get_or_404(doc_id)
    
    # Permission check
    denied = require_permission('document', doc_id, 'document:update')
    if denied:
        return denied
    
    data = request.json or {}
    new_name = data.get('name', document.name)
    
    if new_name != document.name:
        import os
        old_ext = os.path.splitext(document.name)[1]
        if old_ext:
            new_ext = os.path.splitext(new_name)[1]
            if not new_ext:
                new_name += old_ext
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

    changes = {}
    if 'name' in data and new_name != document.name:
        changes['name'] = {'old': document.name, 'new': new_name}
        document.name = new_name
    if 'folder_id' in data and new_folder_id != document.folder_id:
        changes['folder_id'] = {'old': document.folder_id, 'new': new_folder_id}
        document.folder_id = new_folder_id
         
    db.session.commit()
    
    if changes:
        log_document_action(document.id, 'UPDATE', changes)
        
    return jsonify(document.to_dict())

@documents_bp.route('/<int:doc_id>', methods=['DELETE'])
@token_required
def delete_document(doc_id):
    document = Document.query.get_or_404(doc_id)
    
    # Permission check
    denied = require_permission('document', doc_id, 'document:delete')
    if denied:
        return denied
    
    # Delete physical files
    storage_root = current_app.config['STORAGE_ROOT']
    doc_dir = resolve_document_directory(storage_root, document.id)
    if os.path.exists(doc_dir):
        shutil.rmtree(doc_dir)
         
    db.session.delete(document)
    db.session.commit()
    return jsonify({'message': 'Document deleted successfully'})

@documents_bp.route('/<int:doc_id>/versions', methods=['GET'])
@token_required
def get_versions(doc_id):
    document = Document.query.get_or_404(doc_id)
    
    # Permission check
    denied = require_permission('document', doc_id, 'version:view')
    if denied:
        return denied
    
    versions = Version.query.filter_by(document_id=doc_id).order_by(Version.version_number.desc()).all()
    return jsonify([v.to_dict() for v in versions])

@documents_bp.route('/<int:doc_id>/audit', methods=['GET'])
@token_required
@admin_required
def get_audit_log(doc_id):
    from models import AuditLog
    document = Document.query.get_or_404(doc_id)
    logs = AuditLog.query.filter_by(document_id=doc_id).order_by(AuditLog.created_at.desc()).all()
    return jsonify([log.to_dict() for log in logs])

@documents_bp.route('/<int:doc_id>/audit/export', methods=['POST'])
@token_required
@admin_required
def log_audit_export(doc_id):
    document = Document.query.get_or_404(doc_id)
    from utils.audit import log_document_action
    log_document_action(document.id, 'EXPORT_AUDIT')
    return jsonify({'status': 'success'})


# ─── Permission Management Endpoints ─────────────────────────────

@documents_bp.route('/<int:doc_id>/permissions', methods=['GET'])
@token_required
@admin_or_manager_required
def get_document_permissions(doc_id):
    """Get all user permissions for a document (Admin/Manager only)."""
    Document.query.get_or_404(doc_id)
    perms = get_permissions_for_resource('document', doc_id)
    return jsonify(perms)

@documents_bp.route('/<int:doc_id>/permissions', methods=['PUT'])
@token_required
@admin_or_manager_required
def set_document_permissions(doc_id):
    """
    Bulk-set permissions for a document (Admin/Manager only).
    Body: { "permissions": [{ "user_id": 1, "privileges": ["document:view", ...] }, ...] }
    """
    Document.query.get_or_404(doc_id)
    data = request.get_json() or {}
    permissions = data.get('permissions', [])
    
    for entry in permissions:
        user_id = entry.get('user_id')
        privileges = entry.get('privileges', [])
        
        if not user_id:
            continue
        
        existing = ResourcePermission.query.filter_by(
            user_id=user_id, resource_type='document', resource_id=doc_id
        ).first()
        
        if existing:
            existing.set_privileges(privileges)
        else:
            new_perm = ResourcePermission(
                user_id=user_id,
                resource_type='document',
                resource_id=doc_id
            )
            new_perm.set_privileges(privileges)
            db.session.add(new_perm)
    
    db.session.commit()
    return jsonify({'status': 'success'})
