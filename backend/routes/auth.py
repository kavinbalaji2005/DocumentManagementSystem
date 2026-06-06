from flask import Blueprint, request, jsonify, current_app, g
from models import db, User, AuditLog, ResourcePermission
import jwt
from datetime import datetime, timedelta, timezone
from functools import wraps
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
import re

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

EMAIL_RE = re.compile(r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')


def _normalize_email(value):
    if value is None:
        return None
    normalized = str(value).strip().lower()
    return normalized if normalized else None


def _is_valid_email(value):
    if not value or len(value) > 255:
        return False
    return bool(EMAIL_RE.match(value))

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        auth_header = request.headers.get('Authorization')
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split(' ')[1]
            
        if not token:
            return jsonify({'error': 'Token is missing!'}), 401
            
        try:
            data = jwt.decode(token, current_app.config['JWT_SECRET_KEY'], algorithms=["HS256"])
            current_user = User.query.get(data['user_id'])
            if not current_user:
                return jsonify({'error': 'User not found!'}), 401
            g.user = current_user
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired!'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Token is invalid!'}), 401
            
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if getattr(g, 'user', None) is None or g.user.role != 'Admin':
            return jsonify({'error': 'Admin privileges required!'}), 403
        return f(*args, **kwargs)
    return decorated

def admin_or_manager_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if getattr(g, 'user', None) is None or g.user.role not in ('Admin', 'Manager'):
            return jsonify({'error': 'Admin or Manager privileges required!'}), 403
        return f(*args, **kwargs)
    return decorated

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    identifier = (data.get('identifier') or data.get('employee_id') or '').strip() if data else ''
    if not data or not identifier or not data.get('password'):
        return jsonify({'error': 'Must provide employee ID or email and password'}), 400

    if '@' in identifier:
        user = User.query.filter(func.lower(User.email) == identifier.lower()).first()
    else:
        user = User.query.filter_by(employee_id=identifier).first()
    
    if not user or not user.check_password(data['password']):
        return jsonify({'error': 'Invalid credentials'}), 401
        
    token = jwt.encode({
        'user_id': user.id,
        'exp': datetime.now(timezone(timedelta(hours=5, minutes=30))) + timedelta(hours=12)
    }, current_app.config['JWT_SECRET_KEY'], algorithm="HS256")
    
    return jsonify({
        'token': token,
        'user': user.to_dict()
    })

@auth_bp.route('/me', methods=['GET'])
@token_required
def get_me():
    return jsonify(g.user.to_dict())

@auth_bp.route('/users', methods=['GET'])
@token_required
@admin_or_manager_required
def get_users():
    users = User.query.all()
    return jsonify([u.to_dict() for u in users])

@auth_bp.route('/users', methods=['POST'])
@token_required
@admin_required
def create_user():
    data = request.get_json() or {}
    if not data.get('employee_id') or not data.get('password') or not data.get('role'):
        return jsonify({'error': 'Must provide employee_id, password, and role'}), 400

    email = _normalize_email(data.get('email'))
    if not email:
        return jsonify({'error': 'Email is required'}), 400
    if not _is_valid_email(email):
        return jsonify({'error': 'Invalid email address'}), 400
        
    if User.query.filter_by(employee_id=data['employee_id']).first():
        return jsonify({'error': 'Employee ID already exists'}), 400

    if User.query.filter(func.lower(User.email) == email).first():
        return jsonify({'error': 'Email already exists'}), 400
        
    if data['role'] not in ['Admin', 'Manager', 'Employee']:
        return jsonify({'error': 'Invalid role'}), 400
        
    new_user = User(
        employee_id=data['employee_id'],
        email=email,
        role=data['role']
    )
    new_user.set_password(data['password'])
    
    db.session.add(new_user)
    db.session.commit()
    
    return jsonify(new_user.to_dict()), 201

@auth_bp.route('/users/<int:user_id>', methods=['PATCH'])
@token_required
@admin_required
def update_user(user_id):
    user = User.query.get_or_404(user_id)
    data = request.get_json() or {}
    
    if 'role' in data:
        if data['role'] not in ['Admin', 'Manager', 'Employee']:
            return jsonify({'error': 'Invalid role'}), 400
        user.role = data['role']
        
    if 'password' in data and data['password']:
        user.set_password(data['password'])

    if 'email' in data:
        email = _normalize_email(data.get('email'))

        default_admin_id = current_app.config.get('DEFAULT_ADMIN_ID', 'ELV0001')
        if user.employee_id == default_admin_id and email is None:
            user.email = None
        else:
            if not email:
                return jsonify({'error': 'Email is required'}), 400
            if not _is_valid_email(email):
                return jsonify({'error': 'Invalid email address'}), 400

            existing = User.query.filter(
                func.lower(User.email) == email,
                User.id != user.id
            ).first()
            if existing:
                return jsonify({'error': 'Email already exists'}), 400

            user.email = email
        
    db.session.commit()
    return jsonify(user.to_dict())

@auth_bp.route('/users/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_user(user_id):
    if g.user.id == user_id:
        return jsonify({'error': 'Cannot delete yourself'}), 400

    user = User.query.get_or_404(user_id)

    try:
        # Defensive cleanup for DBs/schemas where FK ON DELETE rules may not be active.
        ResourcePermission.query.filter_by(user_id=user.id).delete(synchronize_session=False)
        AuditLog.query.filter_by(user_id=user.id).update({'user_id': None}, synchronize_session=False)

        db.session.delete(user)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({'error': 'Unable to delete user due to related records'}), 409
    except Exception:
        db.session.rollback()
        current_app.logger.exception('Failed to delete user %s', user_id)
        return jsonify({'error': 'Failed to delete user'}), 500

    return jsonify({'message': 'User deleted'})

@auth_bp.route('/change-password', methods=['POST'])
@token_required
def change_password():
    default_admin_id = current_app.config.get('DEFAULT_ADMIN_ID', 'ELV0001')
    if g.user.employee_id == default_admin_id:
        return jsonify({'error': 'Default admin account password cannot be changed here'}), 403
        
    data = request.get_json()
    if not data or not data.get('current_password') or not data.get('new_password'):
        return jsonify({'error': 'Must provide current_password and new_password'}), 400
        
    if data['current_password'] == data['new_password']:
        return jsonify({'error': 'New password cannot be the same as current password'}), 400
        
    if not g.user.check_password(data['current_password']):
        return jsonify({'error': 'Incorrect current password'}), 400
        
    g.user.set_password(data['new_password'])
    db.session.commit()
    
    return jsonify({'message': 'Password updated successfully'})

@auth_bp.route('/change-email', methods=['POST'])
@token_required
def change_email():
    default_admin_id = current_app.config.get('DEFAULT_ADMIN_ID', 'ELV0001')
    if g.user.employee_id == default_admin_id:
        return jsonify({'error': 'Default admin account email cannot be changed here'}), 403
        
    data = request.get_json()
    if not data or not data.get('email'):
        return jsonify({'error': 'Email is required'}), 400
        
    email = _normalize_email(data.get('email'))
    if not email:
        return jsonify({'error': 'Email is required'}), 400
        
    if not _is_valid_email(email):
        return jsonify({'error': 'Invalid email address'}), 400
        
    existing = User.query.filter(
        func.lower(User.email) == email,
        User.id != g.user.id
    ).first()
    if existing:
        return jsonify({'error': 'Email already exists'}), 400
        
    g.user.email = email
    db.session.commit()
    
    return jsonify({
        'message': 'Email updated successfully',
        'user': g.user.to_dict()
    })
