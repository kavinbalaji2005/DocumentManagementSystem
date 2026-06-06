import os
import shutil
import hashlib
from flask import Blueprint, request, jsonify, current_app, g
from models import db, Folder, Document, Version, ResourcePermission, GroupPermission, User
from routes.auth import token_required, admin_required, admin_or_manager_required
from utils.storage import resolve_document_directory
from utils.audit import log_document_action
from utils.permissions import (
    require_permission, has_permission, get_effective_permissions,
    get_permissions_for_resource, get_group_permissions_for_resource
)
from utils.mail import notify_document_event, notify_document_move

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
    val_str = str(raw_value).strip()
    if len(val_str) == 36 and '-' in val_str:
        f = Folder.query.filter_by(uuid=val_str).first()
        if f:
            return f.id
        raise ValueError(f'Folder with UUID {val_str} not found')
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        raise ValueError('folder_id must be an integer, UUID, or null')

def validate_name(name):
    """Validate document/folder name. Returns cleaned name or raises ValueError."""
    if not name or not isinstance(name, str):
        raise ValueError("Name is required and must be a string")
    
    name = name.strip()
    if not name:
        raise ValueError("Name cannot be empty or whitespace only")
    
    if len(name) > 255:
        raise ValueError("Name too long (max 255 characters)")
    
    # Check for invalid filesystem characters
    invalid_chars = ['/', '\\', '\x00', '\n', '\r']
    for char in invalid_chars:
        if char in name:
            raise ValueError(f"Name contains invalid character: {repr(char)}")
    
    return name

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
    change_note = (request.form.get('change_note') or '').strip()
    
    if document_id:
        # Uploading new version — require version:create
        # Use pessimistic lock to prevent concurrent version number collisions
        val_str = str(document_id).strip()
        if len(val_str) == 36 and '-' in val_str:
            document = Document.query.with_for_update().filter_by(uuid=val_str).first()
            if not document:
                return jsonify({'error': f'Document with UUID {val_str} not found'}), 404
        else:
            try:
                document = Document.query.with_for_update().get(int(document_id))
                if not document:
                    return jsonify({'error': 'Document not found'}), 404
            except (TypeError, ValueError):
                return jsonify({'error': 'document_id must be an integer or UUID'}), 400
                
        denied = require_permission('document', document.id, 'version:create')
        if denied:
            return denied
        if not change_note:
            return jsonify({'error': 'Change note is required for new versions'}), 400
        latest_version = Version.query.filter_by(
            document_id=document.id,
            version_number=document.current_version_number
        ).first()
        if not latest_version:
            latest_version = (
                Version.query.filter_by(document_id=document.id)
                .order_by(Version.version_number.desc())
                .first()
            )
        if latest_version:
            expected_ext = os.path.splitext(latest_version.storage_path)[1].lower()
            if expected_ext and expected_ext != file_ext:
                return jsonify({
                    'error': f'Only {expected_ext} files are allowed for new versions'
                }), 400
        document.current_version_number += 1
    else:
        # Uploading new document — only Admin/Manager allowed
        if g.user.role == 'Employee':
            return jsonify({'error': 'You do not have permission to upload documents'}), 403

        document_name = request.form.get('name') or file.filename
        try:
            document_name = validate_name(document_name)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
        
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
    if change_note:
        version.comment = change_note
    db.session.add(version)
    
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        # Check if it's a unique constraint violation (duplicate name)
        if 'unique' in str(e).lower():
            return jsonify({'error': 'A document with this name already exists in this folder'}), 409
        raise
    
    # Trigger background extraction job
    import threading
    from jobs.extractor import process_version
    app = current_app._get_current_object()
    thread = threading.Thread(target=process_version, args=(app, version.id))
    thread.daemon = True
    thread.start()
    
    if document_id:
        log_document_action(document.id, 'VERSION_UPLOAD', {
            'version': document.current_version_number,
            'change_note': change_note
        })
        # Notify: new version uploaded
        notify_document_event(
            current_app._get_current_object(), document.id,
            'NEW_VERSION_UPLOADED', g.user,
            extra_details={'Version': f'v{document.current_version_number}',
                           'Change Note': change_note or '—'})
    else:
        log_document_action(document.id, 'CREATE', {'name': document.name, 'folder_id': document.folder_id})
        # Notify: document created
        notify_document_event(
            current_app._get_current_object(), document.id,
            'DOCUMENT_CREATED', g.user)
         
    return jsonify(document.to_dict()), 201

@documents_bp.route('/<string:doc_uuid>', methods=['GET'])
@token_required
def get_document(doc_uuid):
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    doc_id = document.id
    
    # Permission check
    denied = require_permission('document', doc_id, 'document:view')
    if denied:
        return denied
    
    result = document.to_dict()
    # Include effective permissions for the current user
    result['effective_permissions'] = get_effective_permissions(g.user, 'document', doc_id)
    return jsonify(result)

@documents_bp.route('/<string:doc_uuid>', methods=['PATCH'])
@token_required
def update_document(doc_uuid):
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    doc_id = document.id
    
    # Permission check
    denied = require_permission('document', doc_id, 'document:update')
    if denied:
        return denied
    
    data = request.json or {}
    new_name = document.name
    
    if 'name' in data:
        try:
            new_name = validate_name(data['name'])
            # Preserve extension if needed
            import os
            old_ext = os.path.splitext(document.name)[1]
            if old_ext:
                new_ext = os.path.splitext(new_name)[1]
                if not new_ext:
                    new_name += old_ext
        except ValueError as e:
            return jsonify({'error': str(e)}), 400
    
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
    old_folder_id = document.folder_id
    folder_moved = False
    if 'name' in data and new_name != document.name:
        changes['name'] = {'old': document.name, 'new': new_name}
        document.name = new_name
    if 'folder_id' in data and new_folder_id != document.folder_id:
        changes['folder_id'] = {'old': document.folder_id, 'new': new_folder_id}
        folder_moved = True
        document.folder_id = new_folder_id
        
        # When a document is moved to a new folder, remove its explicit permissions
        # so it inherits from the new folder. This ensures future changes to the
        # new folder's permissions will affect this document.
        ResourcePermission.query.filter_by(
            resource_type='document',
            resource_id=doc_id
        ).delete()
         
    db.session.commit()
    
    if changes:
        log_document_action(document.id, 'UPDATE', changes)

    # Notify: document moved (separate notifications for old & new audiences)
    if folder_moved:
        notify_document_move(
            current_app._get_current_object(), document.id, g.user,
            old_folder_id, new_folder_id)
        
    return jsonify(document.to_dict())

@documents_bp.route('/<string:doc_uuid>', methods=['DELETE'])
@token_required
def delete_document(doc_uuid):
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    doc_id = document.id
    
    # Permission check
    denied = require_permission('document', doc_id, 'document:delete')
    if denied:
        return denied
    
    # Resolve recipients BEFORE deletion (document still exists in DB)
    from utils.mail import get_document_recipients
    doc_name = document.name
    doc_folder_id = document.folder_id
    recipients = get_document_recipients(
        document, exclude_user_id=g.user.id if g.user else None)
    
    # Delete physical files
    storage_root = current_app.config['STORAGE_ROOT']
    doc_dir = resolve_document_directory(storage_root, document.id)
    if os.path.exists(doc_dir):
        shutil.rmtree(doc_dir)
         
    db.session.delete(document)
    db.session.commit()

    # Notify: document deleted (use pre-resolved recipients since doc is gone)
    if recipients:
        notify_document_event(
            current_app._get_current_object(), doc_id,
            'DOCUMENT_DELETED', g.user,
            extra_details={'document_name': doc_name, 'folder_id': doc_folder_id},
            recipient_override=recipients)

    return jsonify({'message': 'Document deleted successfully'})

@documents_bp.route('/<string:doc_uuid>/versions', methods=['GET'])
@token_required
def get_versions(doc_uuid):
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    doc_id = document.id
    
    # Permission check
    denied = require_permission('document', doc_id, 'version:view')
    if denied:
        return denied
    
    versions = Version.query.filter_by(document_id=doc_id).order_by(Version.version_number.desc()).all()
    return jsonify([v.to_dict() for v in versions])

@documents_bp.route('/<string:doc_uuid>/audit', methods=['GET'])
@token_required
@admin_required
def get_audit_log(doc_uuid):
    from models import AuditLog
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    logs = AuditLog.query.filter_by(document_id=document.id).order_by(AuditLog.created_at.desc()).all()
    return jsonify([log.to_dict() for log in logs])

@documents_bp.route('/<string:doc_uuid>/audit/export', methods=['POST'])
@token_required
@admin_required
def log_audit_export(doc_uuid):
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    from utils.audit import log_document_action
    log_document_action(document.id, 'EXPORT_AUDIT')
    return jsonify({'status': 'success'})


# ─── Permission Management Endpoints ─────────────────────────────

@documents_bp.route('/<string:doc_uuid>/permissions', methods=['GET'])
@token_required
@admin_or_manager_required
def get_document_permissions(doc_uuid):
    """Get all user permissions for a document (Admin/Manager only)."""
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    perms = get_permissions_for_resource('document', document.id)
    return jsonify(perms)

@documents_bp.route('/<string:doc_uuid>/permissions', methods=['PUT'])
@token_required
@admin_or_manager_required
def set_document_permissions(doc_uuid):
    """
    Bulk-set permissions for a document (Admin/Manager only).
    Body: { "permissions": [{ "user_id": 1, "privileges": ["document:view", ...] }, ...] }
    """
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    doc_id = document.id
    data = request.get_json() or {}
    permissions = data.get('permissions', [])

    grouped_assignees = []
    for entry in permissions:
        user_id = entry.get('user_id')
        if not user_id:
            continue
        user = User.query.get(user_id)
        if user and user.role == 'Employee' and user.group_id is not None:
            grouped_assignees.append(user.employee_id)

    if grouped_assignees:
        return jsonify({
            'error': 'Grouped employees cannot have individual privileges',
            'employees': grouped_assignees
        }), 400
    
    notifications_to_send = []
    for entry in permissions:
        user_id = entry.get('user_id')
        privileges = entry.get('privileges', [])
        
        if not user_id:
            continue
        
        existing = ResourcePermission.query.filter_by(
            user_id=user_id, resource_type='document', resource_id=doc_id
        ).first()
        
        old_privs = set(existing.get_privileges()) if existing else set()
        new_privs = set(privileges)
        
        given = new_privs - old_privs
        taken = old_privs - new_privs
        
        if given or taken:
            notifications_to_send.append((user_id, list(given), list(taken)))
        
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
    
    if notifications_to_send:
        from utils.mail import notify_user_permission_change
        for target_user_id, given, taken in notifications_to_send:
            notify_user_permission_change(
                current_app._get_current_object(), doc_id, g.user,
                target_user_id, given, taken)
    
    return jsonify({'status': 'success'})


@documents_bp.route('/<string:doc_uuid>/group-permissions', methods=['GET'])
@token_required
@admin_or_manager_required
def get_document_group_permissions(doc_uuid):
    """Get group permissions for a document (Admin/Manager only)."""
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    perms = get_group_permissions_for_resource('document', document.id)
    return jsonify(perms)


@documents_bp.route('/<string:doc_uuid>/group-permissions', methods=['PUT'])
@token_required
@admin_or_manager_required
def set_document_group_permissions(doc_uuid):
    """
    Bulk-set group permissions for a document (Admin/Manager only).
    When a privilege is removed from a group, it is also removed from individual
    ResourcePermission rows for all group members on this document.
    Body: { "permissions": [{ "group_id": 1, "privileges": ["document:view", ...] }, ...] }
    """
    from models import UserGroup
    document = Document.query.filter_by(uuid=doc_uuid).first_or_404()
    doc_id = document.id
    data = request.get_json() or {}
    permissions = data.get('permissions', [])
    notifications_to_send = []

    for entry in permissions:
        gid = entry.get('group_id')
        new_privileges = set(entry.get('privileges', []))

        if not gid:
            continue

        group = UserGroup.query.get(gid)
        if not group:
            continue

        # Get old privileges to detect removals
        old_gp = GroupPermission.query.filter_by(
            group_id=gid, resource_type='document', resource_id=doc_id
        ).first()
        old_privileges = set(old_gp.get_privileges()) if old_gp else set()

        given = new_privileges - old_privileges
        taken = old_privileges - new_privileges

        if given or taken:
            notifications_to_send.append((gid, list(given), list(taken)))

        # Detect removed privileges and cascade to individual permissions
        removed_privs = old_privileges - new_privileges
        if removed_privs:
            members = group.members.all()
            for member in members:
                ind_perm = ResourcePermission.query.filter_by(
                    user_id=member.id, resource_type='document', resource_id=doc_id
                ).first()
                if ind_perm:
                    current = set(ind_perm.get_privileges())
                    remaining = current - removed_privs
                    if 'document:view' not in remaining:
                        remaining = set()
                    
                    if remaining:
                        ind_perm.set_privileges(list(remaining))
                    else:
                        db.session.delete(ind_perm)

        # Apply group permission
        existing = GroupPermission.query.filter_by(
            group_id=gid, resource_type='document', resource_id=doc_id
        ).first()

        if new_privileges:
            if existing:
                existing.set_privileges(list(new_privileges))
            else:
                new_perm = GroupPermission(
                    group_id=gid,
                    resource_type='document',
                    resource_id=doc_id
                )
                new_perm.set_privileges(list(new_privileges))
                db.session.add(new_perm)
        else:
            if existing:
                db.session.delete(existing)

    db.session.commit()

    if notifications_to_send:
        from utils.mail import notify_group_permission_change
        for target_group_id, given, taken in notifications_to_send:
            notify_group_permission_change(
                current_app._get_current_object(), doc_id, g.user,
                target_group_id, given, taken)

    return jsonify({'status': 'success'})
