from flask import Blueprint, request, jsonify, current_app
from models import db, Folder, Document
from utils.storage import resolve_document_directory

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
def get_root_children():
    folders = Folder.query.filter_by(parent_id=None).all()
    documents = Document.query.filter_by(folder_id=None).all()
    return jsonify({
        'folders': [f.to_dict() for f in folders],
        'documents': [d.to_dict() for d in documents]
    })

@folders_bp.route('/<int:folder_id>/children', methods=['GET'])
def get_children(folder_id):
    # Verify folder exists
    folder = Folder.query.get_or_404(folder_id)
    folders = Folder.query.filter_by(parent_id=folder_id).all()
    documents = Document.query.filter_by(folder_id=folder_id).all()
    return jsonify({
        'folders': [f.to_dict() for f in folders],
        'documents': [d.to_dict() for d in documents]
    })

@folders_bp.route('/<int:folder_id>/path', methods=['GET'])
def get_folder_path(folder_id):
    folder = Folder.query.get_or_404(folder_id)
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
def create_folder():
    data = request.json
    name = data.get('name')
    parent_id = data.get('parent_id') # Can be None for root

    if not name:
        return jsonify({'error': 'Name is required'}), 400

    new_folder = Folder(name=name, parent_id=parent_id)
    db.session.add(new_folder)
    db.session.commit()
    return jsonify(new_folder.to_dict()), 201

@folders_bp.route('/<int:folder_id>', methods=['PATCH'])
def update_folder(folder_id):
    folder = Folder.query.get_or_404(folder_id)
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
def get_delete_preview(folder_id):
    folder = Folder.query.get_or_404(folder_id)
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
def delete_folder(folder_id):
    folder = Folder.query.get_or_404(folder_id)
    
    # We must also clean up the physical files for all documents in this folder and subfolders
    # SQLAlchemy cascade will delete the DB records, but we need a pre-delete hook or manual walk 
    # to delete the physical files from the storage/ directory.
    # To do this safely, we will walk the tree, collect document versions, and delete them from disk.
    
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
