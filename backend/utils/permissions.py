import json
from flask import g, jsonify
from functools import wraps
from models import db, ResourcePermission, Folder, Document


def has_permission(user, resource_type, resource_id, privilege):
    """
    Check if a user has a specific privilege on a resource.
    
    Resolution order:
    1. Employee role is strictly prohibited from folder:delete, document:delete, folder:update, document:update, and folder:create.
    2. Admin and Manager bypass all checks.
    3. For documents: check document-level override, then inherit from parent folder.
    4. For folders: check this folder, then walk up to parent.
    5. Default deny for employees with no matching grant.
    """
    if user.role == 'Employee' and privilege in ('folder:delete', 'document:delete', 'folder:update', 'document:update', 'folder:create'):
        return False

    if user.role in ('Admin', 'Manager'):
        return True

    if privilege == 'version:view':
        # "version:view" is implicitly granted if the user has "document:view"
        if has_permission(user, resource_type, resource_id, 'document:view'):
            return True

    if resource_type == 'document':
        # Check document-level override first
        perm = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='document', resource_id=resource_id
        ).first()
        if perm:
            return privilege in perm.get_privileges()
        # Inherit from parent folder
        doc = Document.query.get(resource_id)
        if doc and doc.folder_id is not None:
            return has_permission(user, 'folder', doc.folder_id, privilege)
        # Root-level doc with no explicit permission
        return False

    elif resource_type == 'folder':
        # Check this folder
        perm = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='folder', resource_id=resource_id
        ).first()
        if perm:
            return privilege in perm.get_privileges()
        # Walk up to parent
        folder = Folder.query.get(resource_id)
                
        if folder and folder.parent_id is not None:
            if has_permission(user, 'folder', folder.parent_id, privilege):
                return True
                
        # Root-level folder with no explicit permission
        return False

    return False


def get_effective_permissions(user, resource_type, resource_id):
    """
    Get the effective privilege list for a user on a resource.
    Admin/Manager get all privileges. Employees get resolved permissions.
    """
    ALL_FOLDER_PRIVS = [
        'folder:create', 'folder:update', 'folder:delete',
        'document:view', 'document:create', 'document:update', 'document:delete', 'document:download',
        'version:view', 'version:create'
    ]
    ALL_DOC_PRIVS = [
        'document:view', 'document:download', 'document:update', 'document:delete',
        'version:view', 'version:create'
    ]

    if user.role in ('Admin', 'Manager'):
        return ALL_FOLDER_PRIVS if resource_type == 'folder' else ALL_DOC_PRIVS

    if resource_type == 'document':
        # Check document-level override
        perm = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='document', resource_id=resource_id
        ).first()
        if perm:
            privs = perm.get_privileges()
        else:
            # Inherit from parent folder
            doc = Document.query.get(resource_id)
            if doc and doc.folder_id is not None:
                privs = get_effective_permissions(user, 'folder', doc.folder_id)
            else:
                privs = []
        privs = [p for p in privs if p not in ('folder:delete', 'document:delete', 'folder:update', 'document:update', 'folder:create')]
        if 'document:view' in privs and 'version:view' not in privs:
            privs.append('version:view')
        return privs

    elif resource_type == 'folder':
        perm = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='folder', resource_id=resource_id
        ).first()
        if perm:
            privs = perm.get_privileges()
        else:
            folder = Folder.query.get(resource_id)
            if folder and folder.parent_id is not None:
                privs = get_effective_permissions(user, 'folder', folder.parent_id)
            else:
                privs = []
        privs = [p for p in privs if p not in ('folder:delete', 'document:delete', 'folder:update', 'document:update', 'folder:create')]
        if 'document:view' in privs and 'version:view' not in privs:
            privs.append('version:view')
        return privs

    return []


def require_permission(resource_type, resource_id, privilege):
    """
    Check permission for current user (g.user). Returns 403 response or None.
    Usage:
        denied = require_permission('document', doc_id, 'document:view')
        if denied:
            return denied
    """
    user = getattr(g, 'user', None)
    if not user:
        return jsonify({'error': 'Authentication required'}), 401
    if not has_permission(user, resource_type, resource_id, privilege):
        return jsonify({'error': 'You do not have permission to perform this action'}), 403
    return None


def get_accessible_folder_ids(user, privilege='document:view'):
    """
    For an employee, return the set of all folder IDs they can access
    (directly granted or inherited from ancestors).
    If privilege is 'document:view', also include all ancestor folders of any
    resource (folder or document) the user has access to, so they can navigate down.
    Admin/Manager returns None (meaning all folders are accessible).
    """
    if user.role in ('Admin', 'Manager'):
        return None  # Caller should treat None as "all accessible"

    # Get all folder-level grants for this user
    grants = ResourcePermission.query.filter_by(
        user_id=user.id, resource_type='folder'
    ).all()

    # Build set of directly granted folder IDs
    granted_ids = set()
    for g_perm in grants:
        if privilege in g_perm.get_privileges():
            granted_ids.add(g_perm.resource_id)

    # For each granted folder, add all descendant folder IDs
    accessible = set()
    for fid in granted_ids:
        accessible.add(fid)
        _collect_descendant_folder_ids(fid, accessible, user, privilege)

    # If asking for view access, also we must be able to navigate to any explicitly granted item
    if privilege == 'document:view':
        # Add ancestors of already accessible folders
        for fid in list(accessible):
            _add_ancestor_folder_ids(fid, accessible)
            
        # Add ancestors of explicitly granted documents
        doc_grants = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='document'
        ).all()
        for g_perm in doc_grants:
            if 'document:view' in g_perm.get_privileges():
                doc = Document.query.get(g_perm.resource_id)
                if doc and doc.folder_id:
                    _add_ancestor_folder_ids(doc.folder_id, accessible)

    return accessible


def _add_ancestor_folder_ids(folder_id, accessible):
    current = Folder.query.get(folder_id)
    while current:
        accessible.add(current.id)
        current = current.parent


def _collect_descendant_folder_ids(folder_id, accessible, user, privilege):
    """Recursively collect child folder IDs, stopping at explicit denials."""
    children = Folder.query.filter_by(parent_id=folder_id).all()
    for child in children:
        # Check if there's an explicit override on this child
        perm = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='folder', resource_id=child.id
        ).first()
        if perm:
            # Explicit override exists — only include if privilege is present
            if privilege in perm.get_privileges():
                accessible.add(child.id)
                _collect_descendant_folder_ids(child.id, accessible, user, privilege)
            # If privilege is not in the override, skip this subtree (revocation)
        else:
            # No override — inherits from parent (which is accessible)
            accessible.add(child.id)
            _collect_descendant_folder_ids(child.id, accessible, user, privilege)


def get_accessible_document_ids(user, privilege='document:view'):
    """
    For an employee, return the set of all document IDs they can access.
    Admin/Manager returns None (meaning all documents are accessible).
    """
    if user.role in ('Admin', 'Manager'):
        return None

    accessible_folders = get_accessible_folder_ids(user, 'document:view')
    if accessible_folders is None:
        return None

    # Documents in accessible folders (inheriting folder permissions)
    accessible_docs = set()

    # Check documents that have explicit permissions
    doc_grants = ResourcePermission.query.filter_by(
        user_id=user.id, resource_type='document'
    ).all()
    for g_perm in doc_grants:
        if privilege in g_perm.get_privileges():
            accessible_docs.add(g_perm.resource_id)

    # Documents in accessible folders inherit folder permissions
    if accessible_folders:
        docs_in_folders = Document.query.filter(
            Document.folder_id.in_(accessible_folders)
        ).all()
        for doc in docs_in_folders:
            # Check that the folder's effective permissions include this privilege
            if has_permission(user, 'document', doc.id, privilege):
                accessible_docs.add(doc.id)

    # Root-level documents (folder_id=None) need explicit permissions
    root_docs = Document.query.filter_by(folder_id=None).all()
    for doc in root_docs:
        perm = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='document', resource_id=doc.id
        ).first()
        if perm and privilege in perm.get_privileges():
            accessible_docs.add(doc.id)

    return accessible_docs


def get_permissions_for_resource(resource_type, resource_id):
    """
    Get effective user permissions for a specific resource (for the Access List UI).
    Returns list of permission dicts, built by evaluating effective permissions for all employees.
    """
    from models import User
    employees = User.query.filter_by(role='Employee').all()
    perms = []
    for emp in employees:
        privs = get_effective_permissions(emp, resource_type, resource_id)
        if privs:
            perms.append({
                'user_id': emp.id,
                'privileges': privs
            })
    return perms
