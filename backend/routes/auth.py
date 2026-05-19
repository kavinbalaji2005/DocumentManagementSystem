from flask import Blueprint, request, jsonify, current_app, g
from models import db, User
import jwt
from datetime import datetime, timedelta, timezone
from functools import wraps

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

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
    if not data or not data.get('employee_id') or not data.get('password'):
        return jsonify({'error': 'Must provide employee_id and password'}), 400
        
    user = User.query.filter_by(employee_id=data['employee_id']).first()
    
    if not user or not user.check_password(data['password']):
        return jsonify({'error': 'Invalid credentials'}), 401
        
    token = jwt.encode({
        'user_id': user.id,
        'exp': datetime.now(timezone.utc) + timedelta(hours=12)
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
    data = request.get_json()
    if not data or not data.get('employee_id') or not data.get('password') or not data.get('role'):
        return jsonify({'error': 'Must provide employee_id, password, and role'}), 400
        
    if User.query.filter_by(employee_id=data['employee_id']).first():
        return jsonify({'error': 'Employee ID already exists'}), 400
        
    if data['role'] not in ['Admin', 'Manager', 'Employee']:
        return jsonify({'error': 'Invalid role'}), 400
        
    new_user = User(
        employee_id=data['employee_id'],
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
    data = request.get_json()
    
    if 'role' in data:
        if data['role'] not in ['Admin', 'Manager', 'Employee']:
            return jsonify({'error': 'Invalid role'}), 400
        user.role = data['role']
        
    if 'password' in data and data['password']:
        user.set_password(data['password'])
        
    db.session.commit()
    return jsonify(user.to_dict())

@auth_bp.route('/users/<int:user_id>', methods=['DELETE'])
@token_required
@admin_required
def delete_user(user_id):
    if g.user.id == user_id:
        return jsonify({'error': 'Cannot delete yourself'}), 400
        
    user = User.query.get_or_404(user_id)
    db.session.delete(user)
    db.session.commit()
    return jsonify({'message': 'User deleted'})
