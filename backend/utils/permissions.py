import json
from flask import g, jsonify
from functools import wraps
from models import db, ResourcePermission, GroupPermission, Folder, Document


def _get_group_privilege_for_resource(user, resource_type, resource_id):
    """
    Check if the user's group has a privilege grant on this resource.
    Returns the set of privileges from the group grant, or empty set.
    """
    if not user.group_id:
        return set()
    
    gp = GroupPermission.query.filter_by(
        group_id=user.group_id,
        resource_type=resource_type,
        resource_id=resource_id
    ).first()
    
    if gp:
        return set(gp.get_privileges())
    return set()


def has_permission(user, resource_type, resource_id, privilege):
    """
    Check if a user has a specific privilege on a resource.
    
    Resolution order:
    1. Employee role is strictly prohibited from folder:delete, document:delete, folder:update, document:update, and folder:create.
    2. Admin and Manager bypass all checks.
    3. For documents: check individual override + group grant, then inherit from parent folder.
    4. For folders: check individual + group grant on this folder, then walk up to parent.
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
        # Grouped employees can only have group-derived privileges.
        if user.group_id:
            group_privs = _get_group_privilege_for_resource(user, 'document', resource_id)
            if group_privs:
                return privilege in group_privs
        else:
            # Ungrouped employees resolve from individual permissions only.
            ind_perm = ResourcePermission.query.filter_by(
                user_id=user.id, resource_type='document', resource_id=resource_id
            ).first()
            if ind_perm:
                return privilege in set(ind_perm.get_privileges())
        
        # Inherit from parent folder
        doc = Document.query.get(resource_id)
        if doc and doc.folder_id is not None:
            return has_permission(user, 'folder', doc.folder_id, privilege)
        # Root-level doc with no explicit permission
        return False

    elif resource_type == 'folder':
        # Grouped employees can only have group-derived privileges.
        if user.group_id:
            group_privs = _get_group_privilege_for_resource(user, 'folder', resource_id)
            if group_privs:
                return privilege in group_privs
        else:
            # Ungrouped employees resolve from individual permissions only.
            ind_perm = ResourcePermission.query.filter_by(
                user_id=user.id, resource_type='folder', resource_id=resource_id
            ).first()
            if ind_perm:
                return privilege in set(ind_perm.get_privileges())
        
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
    Admin/Manager get all privileges. Employees get resolved permissions
    (union of individual + group grants).
    """
    ALL_FOLDER_PRIVS = [
        'folder:create', 'folder:update', 'folder:delete',
        'document:view', 'document:update', 'document:delete', 'document:download',
        'version:view', 'version:create', 'ai:diff_summary'
    ]
    ALL_DOC_PRIVS = [
        'document:view', 'document:download', 'document:update', 'document:delete',
        'version:view', 'version:create', 'ai:diff_summary'
    ]

    if user.role in ('Admin', 'Manager'):
        return ALL_FOLDER_PRIVS if resource_type == 'folder' else ALL_DOC_PRIVS

    is_grouped_employee = user.role == 'Employee' and user.group_id is not None

    if resource_type == 'document':
        if is_grouped_employee:
            group_privs = _get_group_privilege_for_resource(user, 'document', resource_id)
            if group_privs:
                privs = list(group_privs)
            else:
                doc = Document.query.get(resource_id)
                if doc and doc.folder_id is not None:
                    privs = get_effective_permissions(user, 'folder', doc.folder_id)
                else:
                    privs = []
        else:
            ind_perm = ResourcePermission.query.filter_by(
                user_id=user.id, resource_type='document', resource_id=resource_id
            ).first()
            if ind_perm:
                privs = list(set(ind_perm.get_privileges()))
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
        if is_grouped_employee:
            group_privs = _get_group_privilege_for_resource(user, 'folder', resource_id)
            if group_privs:
                privs = list(group_privs)
            else:
                folder = Folder.query.get(resource_id)
                if folder and folder.parent_id is not None:
                    privs = get_effective_permissions(user, 'folder', folder.parent_id)
                else:
                    privs = []
        else:
            ind_perm = ResourcePermission.query.filter_by(
                user_id=user.id, resource_type='folder', resource_id=resource_id
            ).first()
            if ind_perm:
                privs = list(set(ind_perm.get_privileges()))
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
    (directly granted via individual or group permissions, or inherited from ancestors).
    If privilege is 'document:view', also include all ancestor folders of any
    resource (folder or document) the user has access to, so they can navigate down.
    Admin/Manager returns None (meaning all folders are accessible).
    """
    if user.role in ('Admin', 'Manager'):
        return None  # Caller should treat None as "all accessible"

    # Get all folder-level individual grants for this user
    grants = ResourcePermission.query.filter_by(
        user_id=user.id, resource_type='folder'
    ).all()

    # Build set of directly granted folder IDs (individual)
    granted_ids = set()
    for g_perm in grants:
        if privilege in g_perm.get_privileges():
            granted_ids.add(g_perm.resource_id)

    # Also add folder-level group grants
    if user.group_id:
        group_grants = GroupPermission.query.filter_by(
            group_id=user.group_id, resource_type='folder'
        ).all()
        for gp in group_grants:
            if privilege in gp.get_privileges():
                granted_ids.add(gp.resource_id)

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
            
        # Add ancestors of explicitly granted documents (individual)
        doc_grants = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='document'
        ).all()
        for g_perm in doc_grants:
            if 'document:view' in g_perm.get_privileges():
                doc = Document.query.get(g_perm.resource_id)
                if doc and doc.folder_id:
                    _add_ancestor_folder_ids(doc.folder_id, accessible)

        # Add ancestors of group-granted documents
        if user.group_id:
            group_doc_grants = GroupPermission.query.filter_by(
                group_id=user.group_id, resource_type='document'
            ).all()
            for gp in group_doc_grants:
                if 'document:view' in gp.get_privileges():
                    doc = Document.query.get(gp.resource_id)
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
        # Check if there's an explicit individual override on this child
        perm = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='folder', resource_id=child.id
        ).first()
        # Also check group override
        group_privs = _get_group_privilege_for_resource(user, 'folder', child.id)
        
        if perm or group_privs:
            # Explicit override exists — merge individual + group, check privilege
            ind_privs = set(perm.get_privileges()) if perm else set()
            merged = ind_privs | group_privs
            if privilege in merged:
                accessible.add(child.id)
                _collect_descendant_folder_ids(child.id, accessible, user, privilege)
            # If privilege is not in the merged set, skip this subtree (revocation)
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

    # Check documents that have explicit individual permissions
    doc_grants = ResourcePermission.query.filter_by(
        user_id=user.id, resource_type='document'
    ).all()
    for g_perm in doc_grants:
        if privilege in g_perm.get_privileges():
            accessible_docs.add(g_perm.resource_id)

    # Check documents that have group permissions
    if user.group_id:
        group_doc_grants = GroupPermission.query.filter_by(
            group_id=user.group_id, resource_type='document'
        ).all()
        for gp in group_doc_grants:
            if privilege in gp.get_privileges():
                accessible_docs.add(gp.resource_id)

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
        # Check individual
        perm = ResourcePermission.query.filter_by(
            user_id=user.id, resource_type='document', resource_id=doc.id
        ).first()
        if perm and privilege in perm.get_privileges():
            accessible_docs.add(doc.id)
        # Check group
        elif user.group_id:
            gp = GroupPermission.query.filter_by(
                group_id=user.group_id, resource_type='document', resource_id=doc.id
            ).first()
            if gp and privilege in gp.get_privileges():
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


def get_group_permissions_for_resource(resource_type, resource_id):
    """
    Get group permissions for a specific resource (for the Access List Group Privileges tab).
    Returns list of permission dicts per group.
    """
    from models import UserGroup
    groups = UserGroup.query.order_by(UserGroup.name).all()
    perms = []
    for grp in groups:
        gp = GroupPermission.query.filter_by(
            group_id=grp.id,
            resource_type=resource_type,
            resource_id=resource_id
        ).first()
        privs = gp.get_privileges() if gp else []
        perms.append({
            'group_id': grp.id,
            'group_name': grp.name,
            'member_count': grp.members.count(),
            'privileges': privs
        })
    return perms
