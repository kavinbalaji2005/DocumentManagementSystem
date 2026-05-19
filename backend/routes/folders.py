from flask import Blueprint, request, jsonify, current_app, g
from models import db, Folder, Document, ResourcePermission
from routes.auth import token_required, admin_or_manager_required
from utils.storage import resolve_document_directory
from utils.permissions import (
    require_permission, has_permission,
    get_accessible_folder_ids, get_permissions_for_resource, get_effective_permissions
)

folders_bp = Blueprint('folders', __name__, url_prefix='/folders')


def _parse_optional_folder_id(raw_value, field_name):
    if raw_value is None or raw_value == '' or raw_value == 'null' or raw_value == 'None':
        return None
    try:
        return int(raw_value)
    except (TypeError, ValueError):
        raise ValueError(f'{field_name} must be an integer or null')


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
        'current_folder_permissions': get_effective_permissions(user, 'folder', None) if user.role == 'Employee' else ['folder:create', 'document:create']  # Root has no id
    })

@folders_bp.route('/<int:folder_id>/children', methods=['GET'])
@token_required
def get_children(folder_id):
    # Verify folder exists
    folder = Folder.query.get_or_404(folder_id)
    
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
        'current_folder_permissions': get_effective_permissions(user, 'folder', folder_id) if user.role == 'Employee' else ['folder:create', 'document:create']
    })

@folders_bp.route('/<int:folder_id>/path', methods=['GET'])
@token_required
def get_folder_path(folder_id):
    folder = Folder.query.get_or_404(folder_id)
    
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
            'name': current.name
        })
        current = current.parent
    path.reverse()
    return jsonify(path)

@folders_bp.route('', methods=['POST'])
@token_required
def create_folder():
    data = request.json
    name = data.get('name')
    parent_id = data.get('parent_id') # Can be None for root

    if not name:
        return jsonify({'error': 'Name is required'}), 400

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

@folders_bp.route('/<int:folder_id>', methods=['PATCH'])
@token_required
def update_folder(folder_id):
    folder = Folder.query.get_or_404(folder_id)
    
    # Permission check
    denied = require_permission('folder', folder_id, 'folder:update')
    if denied:
        return denied
    
    data = request.json or {}
    
    if 'name' in data:
        folder.name = data['name']

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

        folder.parent_id = new_parent_id

    db.session.commit()
    return jsonify(folder.to_dict())


@folders_bp.route('/<int:folder_id>/delete-preview', methods=['GET'])
@token_required
def get_delete_preview(folder_id):
    folder = Folder.query.get_or_404(folder_id)
    
    # Permission check
    denied = require_permission('folder', folder_id, 'folder:delete')
    if denied:
        return denied
    
    folders, documents = _collect_folder_tree(folder)
    subfolder_count = max(len(folders) - 1, 0)

    payload = {
        'folder_id': folder.id,
        'folder_name': folder.name,
        'subfolder_count': subfolder_count,
        'document_count': len(documents),
    }
    return jsonify(payload)

@folders_bp.route('/<int:folder_id>', methods=['DELETE'])
@token_required
def delete_folder(folder_id):
    folder = Folder.query.get_or_404(folder_id)
    
    # Permission check
    denied = require_permission('folder', folder_id, 'folder:delete')
    if denied:
        return denied
    
    import os
    import shutil
        
    _, all_docs = _collect_folder_tree(folder)
    
    storage_root = current_app.config['STORAGE_ROOT']
    
    for doc in all_docs:
        doc_dir = resolve_document_directory(storage_root, doc.id)
        if os.path.exists(doc_dir):
            shutil.rmtree(doc_dir)

    db.session.delete(folder)
    db.session.commit()
    
    return jsonify({'message': 'Folder deleted successfully'})


# ─── Permission Management Endpoints ─────────────────────────────

@folders_bp.route('/<int:folder_id>/permissions', methods=['GET'])
@token_required
@admin_or_manager_required
def get_folder_permissions(folder_id):
    """Get all user permissions for a folder (Admin/Manager only)."""
    Folder.query.get_or_404(folder_id)
    perms = get_permissions_for_resource('folder', folder_id)
    return jsonify(perms)

@folders_bp.route('/<int:folder_id>/permissions', methods=['PUT'])
@token_required
@admin_or_manager_required
def set_folder_permissions(folder_id):
    """
    Bulk-set permissions for a folder (Admin/Manager only).
    Body: { "permissions": [{ "user_id": 1, "privileges": ["folder:view", ...] }, ...] }
    """
    Folder.query.get_or_404(folder_id)
    data = request.get_json() or {}
    permissions = data.get('permissions', [])
    
    for entry in permissions:
        user_id = entry.get('user_id')
        privileges = entry.get('privileges', [])
        
        if not user_id:
            continue
        
        existing = ResourcePermission.query.filter_by(
            user_id=user_id, resource_type='folder', resource_id=folder_id
        ).first()
        
        if existing:
            existing.set_privileges(privileges)
        else:
            new_perm = ResourcePermission(
                user_id=user_id,
                resource_type='folder',
                resource_id=folder_id
            )
            new_perm.set_privileges(privileges)
            db.session.add(new_perm)
    
    db.session.commit()
    return jsonify({'status': 'success'})
