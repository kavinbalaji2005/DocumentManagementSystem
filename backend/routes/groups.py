from flask import Blueprint, request, jsonify, g
from models import db, User, UserGroup, GroupPermission, ResourcePermission
from routes.auth import token_required, admin_required, admin_or_manager_required
import json

groups_bp = Blueprint('groups', __name__, url_prefix='/groups')


def _clear_individual_permissions_for_user(user_id):
    ResourcePermission.query.filter_by(user_id=user_id).delete(synchronize_session=False)


# ─── Group CRUD ───────────────────────────────────────────────────

@groups_bp.route('', methods=['GET'])
@token_required
@admin_or_manager_required
def get_groups():
    """List all groups with member count."""
    groups = UserGroup.query.order_by(UserGroup.name).all()
    return jsonify([g_obj.to_dict() for g_obj in groups])


@groups_bp.route('', methods=['POST'])
@token_required
@admin_required
def create_group():
    """Create a new group."""
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Group name is required'}), 400

    name = data['name'].strip()
    if not name:
        return jsonify({'error': 'Group name cannot be empty'}), 400

    if len(name) > 100:
        return jsonify({'error': 'Group name too long (max 100 characters)'}), 400

    if UserGroup.query.filter_by(name=name).first():
        return jsonify({'error': 'A group with this name already exists'}), 409

    group = UserGroup(
        name=name,
        description=(data.get('description') or '').strip() or None
    )
    db.session.add(group)
    db.session.commit()

    return jsonify(group.to_dict()), 201


@groups_bp.route('/<int:group_id>', methods=['PATCH'])
@token_required
@admin_required
def update_group(group_id):
    """Update group name/description."""
    group = UserGroup.query.get_or_404(group_id)
    data = request.get_json() or {}

    if 'name' in data:
        name = data['name'].strip()
        if not name:
            return jsonify({'error': 'Group name cannot be empty'}), 400
        if len(name) > 100:
            return jsonify({'error': 'Group name too long (max 100 characters)'}), 400
        existing = UserGroup.query.filter(
            UserGroup.name == name, UserGroup.id != group_id
        ).first()
        if existing:
            return jsonify({'error': 'A group with this name already exists'}), 409
        group.name = name

    if 'description' in data:
        group.description = (data['description'] or '').strip() or None

    db.session.commit()
    return jsonify(group.to_dict())


@groups_bp.route('/<int:group_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_group(group_id):
    """
    Delete a group. Members become ungrouped.
    Group privileges are revoked from individual ResourcePermission rows,
    but extra individual privileges are retained.
    """
    group = UserGroup.query.get_or_404(group_id)

    # Get all members before deletion
    members = group.members.all()

    # Get all group permission grants to know what to revoke
    group_perms = GroupPermission.query.filter_by(group_id=group_id).all()

    # For each member, revoke group-derived privileges from individual permissions
    for member in members:
        _revoke_group_privileges_from_user(member, group_perms)
        member.group_id = None

    db.session.delete(group)
    db.session.commit()

    return jsonify({'message': 'Group deleted successfully'})


# ─── Member Management ───────────────────────────────────────────

@groups_bp.route('/<int:group_id>/members', methods=['GET'])
@token_required
@admin_or_manager_required
def get_group_members(group_id):
    """List members of a group."""
    group = UserGroup.query.get_or_404(group_id)
    members = group.members.order_by(User.employee_id).all()
    return jsonify([m.to_dict() for m in members])


@groups_bp.route('/<int:group_id>/members', methods=['POST'])
@token_required
@admin_required
def add_group_members(group_id):
    """
    Add employees to a group.
    If an employee is already in another group, they are transferred
    (old group privileges revoked, new group privileges take effect).
    Only employees can be assigned to groups.
    """
    group = UserGroup.query.get_or_404(group_id)
    data = request.get_json()
    if not data or not data.get('user_ids'):
        return jsonify({'error': 'user_ids is required'}), 400

    user_ids = data['user_ids']
    if not isinstance(user_ids, list):
        user_ids = [user_ids]

    added = []
    errors = []

    for uid in user_ids:
        user = User.query.get(uid)
        if not user:
            errors.append(f'User {uid} not found')
            continue
        if user.role != 'Employee':
            errors.append(f'{user.employee_id} is not an Employee (role: {user.role})')
            continue
        if user.group_id == group_id:
            # Already in this group
            added.append(user.employee_id)
            continue

        # If in another group, revoke old group privileges
        if user.group_id is not None:
            old_group_perms = GroupPermission.query.filter_by(
                group_id=user.group_id
            ).all()
            _revoke_group_privileges_from_user(user, old_group_perms)

        # Grouped employees can only have group privileges.
        _clear_individual_permissions_for_user(user.id)
        user.group_id = group_id
        added.append(user.employee_id)

    db.session.commit()

    result = {'added': added}
    if errors:
        result['errors'] = errors

    return jsonify(result)


@groups_bp.route('/<int:group_id>/members/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def remove_group_member(group_id, user_id):
    """Remove an employee from a group. Revokes group privileges."""
    group = UserGroup.query.get_or_404(group_id)
    user = User.query.get_or_404(user_id)

    if user.group_id != group_id:
        return jsonify({'error': 'User is not a member of this group'}), 400

    # Revoke group-derived privileges
    group_perms = GroupPermission.query.filter_by(group_id=group_id).all()
    _revoke_group_privileges_from_user(user, group_perms)

    user.group_id = None
    db.session.commit()

    return jsonify({'message': 'Member removed from group'})


@groups_bp.route('/transfer', methods=['POST'])
@token_required
@admin_required
def transfer_member():
    """
    Transfer an employee between groups.
    Revokes old group privileges and new group privileges take effect automatically.
    Body: { "user_id": int, "to_group_id": int }
    """
    data = request.get_json()
    if not data or not data.get('user_id') or not data.get('to_group_id'):
        return jsonify({'error': 'user_id and to_group_id are required'}), 400

    user = User.query.get_or_404(data['user_id'])
    to_group = UserGroup.query.get_or_404(data['to_group_id'])

    if user.role != 'Employee':
        return jsonify({'error': 'Only employees can be assigned to groups'}), 400

    if user.group_id == to_group.id:
        return jsonify({'message': 'User is already in the target group'})

    # Revoke old group privileges if user was in a group
    if user.group_id is not None:
        old_group_perms = GroupPermission.query.filter_by(
            group_id=user.group_id
        ).all()
        _revoke_group_privileges_from_user(user, old_group_perms)

    # Grouped employees can only have group privileges.
    _clear_individual_permissions_for_user(user.id)
    user.group_id = to_group.id
    db.session.commit()

    return jsonify({
        'message': f'Employee transferred to {to_group.name}',
        'user': user.to_dict()
    })


# ─── Ungrouped Employees ─────────────────────────────────────────

@groups_bp.route('/ungrouped', methods=['GET'])
@token_required
@admin_or_manager_required
def get_ungrouped_employees():
    """List employees that are not in any group."""
    employees = User.query.filter_by(role='Employee', group_id=None).order_by(User.employee_id).all()
    return jsonify([e.to_dict() for e in employees])


# ─── Helper: Revoke Group Privileges ─────────────────────────────

def _revoke_group_privileges_from_user(user, group_perms):
    """
    For each GroupPermission, find the user's individual ResourcePermission
    on the same resource and remove the group-granted privileges.
    If the individual ResourcePermission becomes empty, delete it.
    Extra individual privileges not in the group grant are retained.
    """
    for gp in group_perms:
        ind_perm = ResourcePermission.query.filter_by(
            user_id=user.id,
            resource_type=gp.resource_type,
            resource_id=gp.resource_id
        ).first()

        if not ind_perm:
            continue

        group_privs = set(gp.get_privileges())
        ind_privs = set(ind_perm.get_privileges())

        # Remove group-granted privileges from individual
        remaining = ind_privs - group_privs
        if 'document:view' not in remaining:
            remaining = set()

        if remaining:
            ind_perm.set_privileges(list(remaining))
        else:
            db.session.delete(ind_perm)
