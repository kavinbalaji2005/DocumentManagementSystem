from flask import Blueprint, request, jsonify, current_app, g
from models import db, Folder, Document, ResourcePermission, GroupPermission, User
from routes.auth import token_required, admin_or_manager_required
from utils.storage import resolve_document_directory
from utils.permissions import (
    require_permission, has_permission,
    get_accessible_folder_ids, get_permissions_for_resource, get_effective_permissions,
    get_group_permissions_for_resource
)

folders_bp = Blueprint('folders', __name__, url_prefix='/folders')

# Constants for validation
MAX_FOLDER_DEPTH = 20
MAX_NAME_LENGTH = 255

def validate_name(name):
    """Validate folder/document name. Returns cleaned name or raises ValueError."""
    if not name or not isinstance(name, str):
        raise ValueError("Name is required and must be a string")
    
    name = name.strip()
    if not name:
        raise ValueError("Name cannot be empty or whitespace only")
    
    if len(name) > MAX_NAME_LENGTH:
        raise ValueError(f"Name too long (max {MAX_NAME_LENGTH} characters)")
    
    # Check for invalid filesystem characters
    invalid_chars = ['/', '\\', '\x00', '\n', '\r']
    for char in invalid_chars:
        if char in name:
            raise ValueError(f"Name contains invalid character: {repr(char)}")
    
    return name

def check_folder_depth(parent_id):
    """Check if adding to this parent would exceed max depth. Returns depth or raises ValueError."""
    depth = 0
    current = Folder.query.get(parent_id) if parent_id else None
    while current:
        depth += 1
        if depth >= MAX_FOLDER_DEPTH:
            raise ValueError(f"Folder hierarchy too deep (max {MAX_FOLDER_DEPTH} levels)")
        current = current.parent
    return depth


def _parse_optional_folder_id(raw_value, field_name):
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
        raise ValueError(f'{field_name} must be an integer, UUID, or null')


def _collect_folder_tree(root_folder):
    folders = []
    documents = []
    stack = [root_folder]

    while stack:
        current = stack.pop()
        folders.append(current)
        documents.extend(current.documents)
        stack.extend(current.children)

    return folders, documents


def _build_folder_path_for_notification(folder):
    """Build a breadcrumb string like 'Home/Engineering/Reports' for notification emails."""
    parts = []
    current = folder
    while current:
        parts.append(current.name)
        current = current.parent
    parts.reverse()
    return 'Home/' + '/'.join(parts) if parts else 'Home'


def _would_create_cycle(folder_id, new_parent_id):
    current = Folder.query.get(new_parent_id)
    while current is not None:
        if current.id == folder_id:
            return True
        current = current.parent
    return False

@folders_bp.route('/root/children', methods=['GET'])
@token_required
def get_root_children():
    folders = Folder.query.filter_by(parent_id=None).all()
    documents = Document.query.filter_by(folder_id=None).all()
    
    user = g.user
    
    # Filter for employees
    if user.role == 'Employee':
        accessible_folder_ids = get_accessible_folder_ids(user, 'document:view')
        if accessible_folder_ids is not None:
            folders = [f for f in folders if f.id in accessible_folder_ids]
            # For root-level documents, check explicit permissions
            documents = [d for d in documents if has_permission(user, 'document', d.id, 'document:view')]
    
    res_folders = []
    for f in folders:
        fd = f.to_dict()
        if user.role == 'Employee':
            if accessible_folder_ids is not None:
                cf_count = sum(1 for child in f.children if child.id in accessible_folder_ids)
            else:
                cf_count = len(f.children)
            cd_count = sum(1 for doc in f.documents if has_permission(user, 'document', doc.id, 'document:view'))
            fd['child_count'] = cf_count + cd_count
        res_folders.append(fd)
    
    return jsonify({
        'folders': res_folders,
        'documents': [d.to_dict() for d in documents],
        'current_folder_permissions': get_effective_permissions(user, 'folder', None) if user.role == 'Employee' else ['folder:create']  # Root has no id
    })

@folders_bp.route('/<string:folder_uuid>/children', methods=['GET'])
@token_required
def get_children(folder_uuid):
    # Verify folder exists
    folder = Folder.query.filter_by(uuid=folder_uuid).first_or_404()
    folder_id = folder.id
    
    user = g.user
    
    if user.role == 'Employee':
        accessible_folder_ids = get_accessible_folder_ids(user, 'document:view')
        if accessible_folder_ids is not None and folder_id not in accessible_folder_ids:
            return jsonify({'error': 'You do not have permission to perform this action'}), 403
    else:
        denied = require_permission('folder', folder_id, 'document:view')
        if denied:
            return denied
    
    folders = Folder.query.filter_by(parent_id=folder_id).all()
    documents = Document.query.filter_by(folder_id=folder_id).all()
    
    # Filter for employees
    if user.role == 'Employee':
        if accessible_folder_ids is not None:
            folders = [f for f in folders if f.id in accessible_folder_ids]
            documents = [d for d in documents if has_permission(user, 'document', d.id, 'document:view')]
    
    res_folders = []
    for f in folders:
        fd = f.to_dict()
        if user.role == 'Employee':
            if accessible_folder_ids is not None:
                cf_count = sum(1 for child in f.children if child.id in accessible_folder_ids)
            else:
                cf_count = len(f.children)
            cd_count = sum(1 for doc in f.documents if has_permission(user, 'document', doc.id, 'document:view'))
            fd['child_count'] = cf_count + cd_count
        res_folders.append(fd)
    
    return jsonify({
        'folders': res_folders,
        'documents': [d.to_dict() for d in documents],
        'current_folder_permissions': get_effective_permissions(user, 'folder', folder_id) if user.role == 'Employee' else ['folder:create']
    })

@folders_bp.route('/<string:folder_uuid>/path', methods=['GET'])
@token_required
def get_folder_path(folder_uuid):
    folder = Folder.query.filter_by(uuid=folder_uuid).first_or_404()
    folder_id = folder.id
    
    user = g.user
    if user.role == 'Employee':
        accessible_folder_ids = get_accessible_folder_ids(user, 'document:view')
        if accessible_folder_ids is not None and folder.id not in accessible_folder_ids:
            return jsonify({'error': 'You do not have permission to access this path.'}), 403
            
    path = []
    current = folder
    while current:
        path.append({
            'id': current.id,
            'uuid': current.uuid,
            'name': current.name
        })
        current = current.parent
    path.reverse()
    return jsonify(path)

@folders_bp.route('', methods=['POST'])
@token_required
def create_folder():
    data = request.json
    parent_id = data.get('parent_id') # Can be None for root

    try:
        parent_id = _parse_optional_folder_id(parent_id, 'parent_id')
        name = validate_name(data.get('name'))
        if parent_id:
            check_folder_depth(parent_id)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    # Permission check: need folder:create on parent folder
    if parent_id is not None:
        denied = require_permission('folder', parent_id, 'folder:create')
        if denied:
            return denied
    else:
        # Creating root-level folder — only Admin/Manager
        if g.user.role == 'Employee':
            return jsonify({'error': 'You do not have permission to create root-level folders'}), 403

    new_folder = Folder(name=name, parent_id=parent_id)
    db.session.add(new_folder)
    db.session.commit()
    return jsonify(new_folder.to_dict()), 201

@folders_bp.route('/<string:folder_uuid>', methods=['PATCH'])
@token_required
def update_folder(folder_uuid):
    folder = Folder.query.filter_by(uuid=folder_uuid).first_or_404()
    folder_id = folder.id
    
    # Permission check
    denied = require_permission('folder', folder_id, 'folder:update')
    if denied:
        return denied
    
    data = request.json or {}
    
    if 'name' in data:
        try:
            folder.name = validate_name(data['name'])
            # Check for duplicate names at same level
            existing = Folder.query.filter(
                Folder.parent_id == folder.parent_id,
                Folder.name == folder.name,
                Folder.id != folder.id
            ).first()
            if existing:
                return jsonify({'error': 'A folder with this name already exists at this level'}), 409
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

    if 'parent_id' in data:
        try:
            new_parent_id = _parse_optional_folder_id(data['parent_id'], 'parent_id')
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        if new_parent_id == folder.id:
            return jsonify({'error': 'Folder cannot be its own parent'}), 400

        if new_parent_id is not None:
            new_parent = Folder.query.get(new_parent_id)
            if not new_parent:
                return jsonify({'error': 'Destination folder not found'}), 404

            if _would_create_cycle(folder.id, new_parent_id):
                return jsonify({'error': 'Folder cannot be moved into its own subfolder'}), 400
            
            # Check depth after move
            try:
                check_folder_depth(new_parent_id)
            except ValueError as e:
                return jsonify({'error': str(e)}), 400

        folder.parent_id = new_parent_id

    db.session.commit()
    return jsonify(folder.to_dict())


@folders_bp.route('/<string:folder_uuid>/delete-preview', methods=['GET'])
@token_required
def get_delete_preview(folder_uuid):
    folder = Folder.query.filter_by(uuid=folder_uuid).first_or_404()
    folder_id = folder.id
    
    # Permission check
    denied = require_permission('folder', folder_id, 'folder:delete')
    if denied:
        return denied
    
    folders, documents = _collect_folder_tree(folder)
    subfolder_count = max(len(folders) - 1, 0)

    payload = {
        'folder_id': folder.id,
        'folder_uuid': folder.uuid,
        'folder_name': folder.name,
        'subfolder_count': subfolder_count,
        'document_count': len(documents),
    }
    return jsonify(payload)

@folders_bp.route('/<string:folder_uuid>', methods=['DELETE'])
@token_required
def delete_folder(folder_uuid):
    folder = Folder.query.filter_by(uuid=folder_uuid).first_or_404()
    folder_id = folder.id
    
    # Permission check
    denied = require_permission('folder', folder_id, 'folder:delete')
    if denied:
        return denied
    
    import os
    import shutil
        
    _, all_docs = _collect_folder_tree(folder)

    # --- Pre-deletion: collect data for notifications ---
    folder_name = folder.name
    folder_path = _build_folder_path_for_notification(folder)
    doc_names = [doc.name for doc in all_docs]

    # Collect all unique recipients across all documents in this folder tree
    all_recipients = set()
    if all_docs:
        from utils.mail import get_document_recipients
        actor_id = g.user.id if g.user else None
        for doc in all_docs:
            recipients = get_document_recipients(doc, exclude_user_id=actor_id)
            all_recipients.update(recipients)
    
    storage_root = current_app.config['STORAGE_ROOT']
    
    for doc in all_docs:
        doc_dir = resolve_document_directory(storage_root, doc.id)
        if os.path.exists(doc_dir):
            shutil.rmtree(doc_dir)

    db.session.delete(folder)
    db.session.commit()

    # --- Post-deletion: send batched notification ---
    if all_recipients and doc_names:
        from utils.mail import notify_folder_deleted
        notify_folder_deleted(
            current_app._get_current_object(), g.user,
            folder_name, folder_path, doc_names, list(all_recipients))
    
    return jsonify({'message': 'Folder deleted successfully'})


# ─── Permission Management Endpoints ─────────────────────────────

@folders_bp.route('/<string:folder_uuid>/permissions', methods=['GET'])
@token_required
@admin_or_manager_required
def get_folder_permissions(folder_uuid):
    """Get all user permissions for a folder (Admin/Manager only)."""
    folder = Folder.query.filter_by(uuid=folder_uuid).first_or_404()
    perms = get_permissions_for_resource('folder', folder.id)
    return jsonify(perms)

def _apply_permissions_recursively(folder_id, user_id, privileges):
    """
    Recursively apply permissions to a folder and its child folders only.
    Documents do NOT get explicit permissions - they inherit from their parent folder.
    This ensures documents automatically get new folder's permissions when moved.
    """
    folder = Folder.query.get(folder_id)
    if not folder:
        return
    
    # Apply to the folder itself
    existing_folder = ResourcePermission.query.filter_by(
        user_id=user_id, resource_type='folder', resource_id=folder_id
    ).first()
    
    if privileges:
        # If privileges is not empty, create or update the permission
        if existing_folder:
            existing_folder.set_privileges(privileges)
        else:
            new_perm = ResourcePermission(
                user_id=user_id,
                resource_type='folder',
                resource_id=folder_id
            )
            new_perm.set_privileges(privileges)
            db.session.add(new_perm)
    else:
        # If privileges is empty, delete the permission row (semantic clarity)
        if existing_folder:
            db.session.delete(existing_folder)
    
    # Remove explicit document permissions in this folder to force inheritance
    # Documents will now inherit from this folder's permissions
    doc_ids = [doc.id for doc in folder.documents]
    if doc_ids:
        ResourcePermission.query.filter_by(
            user_id=user_id, resource_type='document'
        ).filter(ResourcePermission.resource_id.in_(doc_ids)).delete()
    
    # Recursively apply to all child folders only
    for child_folder in folder.children:
        _apply_permissions_recursively(child_folder.id, user_id, privileges)


@folders_bp.route('/<string:folder_uuid>/permissions', methods=['PUT'])
@token_required
@admin_or_manager_required
def set_folder_permissions(folder_uuid):
    """
    Bulk-set permissions for a folder (Admin/Manager only).
    Permissions cascade to all child folders (but NOT to documents - they inherit).
    Body: { "permissions": [{ "user_id": 1, "privileges": ["folder:view", ...] }, ...] }
    """
    folder = Folder.query.filter_by(uuid=folder_uuid).first_or_404()
    folder_id = folder.id
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
    
    try:
        for entry in permissions:
            user_id = entry.get('user_id')
            privileges = entry.get('privileges', [])
            
            if not user_id:
                continue
            
            # Apply permissions recursively to this folder and all child folders
            # Documents inherit from their folder, not explicitly set
            _apply_permissions_recursively(folder_id, user_id, privileges)
        
        db.session.commit()
        return jsonify({'status': 'success'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Failed to update permissions: {str(e)}'}), 500


@folders_bp.route('/<string:folder_uuid>/group-permissions', methods=['GET'])
@token_required
@admin_or_manager_required
def get_folder_group_permissions(folder_uuid):
    """Get group permissions for a folder (Admin/Manager only)."""
    folder = Folder.query.filter_by(uuid=folder_uuid).first_or_404()
    perms = get_group_permissions_for_resource('folder', folder.id)
    return jsonify(perms)


def _apply_group_permissions_recursively(folder_id, group_id, privileges):
    """
    Recursively apply group permissions to a folder and its child folders.
    Documents inherit from their parent folder.
    """
    folder = Folder.query.get(folder_id)
    if not folder:
        return

    # Apply to the folder itself
    existing = GroupPermission.query.filter_by(
        group_id=group_id, resource_type='folder', resource_id=folder_id
    ).first()

    if privileges:
        if existing:
            existing.set_privileges(privileges)
        else:
            new_perm = GroupPermission(
                group_id=group_id,
                resource_type='folder',
                resource_id=folder_id
            )
            new_perm.set_privileges(privileges)
            db.session.add(new_perm)
    else:
        if existing:
            db.session.delete(existing)

    # Remove explicit group document permissions in this folder to force inheritance
    doc_ids = [doc.id for doc in folder.documents]
    if doc_ids:
        GroupPermission.query.filter_by(
            group_id=group_id, resource_type='document'
        ).filter(GroupPermission.resource_id.in_(doc_ids)).delete()

    # Recursively apply to all child folders
    for child_folder in folder.children:
        _apply_group_permissions_recursively(child_folder.id, group_id, privileges)


@folders_bp.route('/<string:folder_uuid>/group-permissions', methods=['PUT'])
@token_required
@admin_or_manager_required
def set_folder_group_permissions(folder_uuid):
    """
    Bulk-set group permissions for a folder (Admin/Manager only).
    Permissions cascade to all child folders.
    When a privilege is removed from a group, it is also removed from individual
    ResourcePermission rows for all group members on the same resource tree.
    Body: { "permissions": [{ "group_id": 1, "privileges": ["document:view", ...] }, ...] }
    """
    from models import UserGroup
    folder = Folder.query.filter_by(uuid=folder_uuid).first_or_404()
    folder_id = folder.id
    data = request.get_json() or {}
    permissions = data.get('permissions', [])

    try:
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
                group_id=gid, resource_type='folder', resource_id=folder_id
            ).first()
            old_privileges = set(old_gp.get_privileges()) if old_gp else set()

            # Detect removed privileges
            removed_privs = old_privileges - new_privileges

            # If privileges were removed, cascade removal to individual permissions
            if removed_privs:
                members = group.members.all()
                _cascade_revoke_folder_tree(folder_id, members, removed_privs)

            # Apply group permissions recursively
            _apply_group_permissions_recursively(folder_id, gid, list(new_privileges))

        db.session.commit()
        return jsonify({'status': 'success'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': f'Failed to update group permissions: {str(e)}'}), 500


def _cascade_revoke_folder_tree(folder_id, members, removed_privs):
    """
    For each member, remove the specified privileges from their individual
    ResourcePermission on this folder and all descendant folders/documents.
    """
    folder = Folder.query.get(folder_id)
    if not folder:
        return

    for member in members:
        # Revoke from folder permission
        _revoke_privs_from_individual(member.id, 'folder', folder_id, removed_privs)

        # Revoke from documents in this folder
        for doc in folder.documents:
            _revoke_privs_from_individual(member.id, 'document', doc.id, removed_privs)

    # Recurse into child folders
    for child in folder.children:
        _cascade_revoke_folder_tree(child.id, members, removed_privs)


def _revoke_privs_from_individual(user_id, resource_type, resource_id, privs_to_remove):
    """Remove specific privileges from an individual ResourcePermission row."""
    perm = ResourcePermission.query.filter_by(
        user_id=user_id, resource_type=resource_type, resource_id=resource_id
    ).first()
    if not perm:
        return

    current = set(perm.get_privileges())
    remaining = current - privs_to_remove
    if 'document:view' not in remaining:
        remaining = set()

    if remaining:
        perm.set_privileges(list(remaining))
    else:
        db.session.delete(perm)
