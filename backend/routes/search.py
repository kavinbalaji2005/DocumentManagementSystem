from flask import Blueprint, request, jsonify, g
from models import Folder, Document
from routes.auth import token_required
from utils.permissions import get_accessible_folder_ids, has_permission

search_bp = Blueprint('search', __name__, url_prefix='/search')

@search_bp.route('', methods=['GET'])
@token_required
def search():
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'folders': [], 'documents': []})
        
    user = g.user
    
    folders = Folder.query.filter(Folder.name.ilike(f'%{query}%')).all()
    documents = Document.query.filter(Document.name.ilike(f'%{query}%')).all()
    
    if user.role == 'Employee':
        accessible_folder_ids = get_accessible_folder_ids(user, 'document:view')
        if accessible_folder_ids is not None:
            folders = [f for f in folders if f.id in accessible_folder_ids]
            documents = [d for d in documents if has_permission(user, 'document', d.id, 'document:view')]
            
    return jsonify({
        'folders': [f.to_dict() for f in folders],
        'documents': [d.to_dict() for d in documents]
    })
