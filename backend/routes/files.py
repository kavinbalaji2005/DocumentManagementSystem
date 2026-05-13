import os
from flask import Blueprint, current_app, send_from_directory, abort
from utils.storage import resolve_storage_path

files_bp = Blueprint('files', __name__, url_prefix='/files')

@files_bp.route('/<path:relative_path>', methods=['GET'])
def serve_file(relative_path):
    storage_root = current_app.config['STORAGE_ROOT']
    try:
        safe_path = resolve_storage_path(storage_root, relative_path)
    except ValueError:
        abort(403)
        
    directory = os.path.dirname(safe_path)
    filename = os.path.basename(safe_path)
    
    return send_from_directory(directory, filename, as_attachment=False)
