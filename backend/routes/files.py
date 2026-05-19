import os
from flask import Blueprint, current_app, send_from_directory, abort, request, jsonify, g
from utils.storage import resolve_storage_path
from routes.auth import token_required
from utils.permissions import require_permission

files_bp = Blueprint('files', __name__, url_prefix='/files')

@files_bp.route('/<path:relative_path>', methods=['GET'])
@token_required
def serve_file(relative_path):
    storage_root = current_app.config['STORAGE_ROOT']
    try:
        safe_path = resolve_storage_path(storage_root, relative_path)
    except ValueError:
        abort(403)
    
    # Permission check for document files
    if relative_path.startswith('documents/'):
        parts = relative_path.split('/')
        if len(parts) >= 3 and parts[1].isdigit():
            doc_id = int(parts[1])
            is_download = request.args.get('download') == 'true'
            
            if is_download:
                # Download requires document:download
                denied = require_permission('document', doc_id, 'document:download')
                if denied:
                    return denied
                from utils.audit import log_document_action
                from models import Version, Document
                version = Version.query.filter_by(storage_path=relative_path).first()
                doc = Document.query.get(doc_id)
                
                doc_name = doc.name if doc else parts[2]
                version_num = version.version_number if version else None
                version_name = version.name if version else None
                
                log_details = {
                    'filename': doc_name,
                    'version': version_num,
                    'version_name': version_name
                }
                log_document_action(doc_id, 'DOWNLOAD', log_details)
            else:
                # Viewing/rendering requires document:view
                denied = require_permission('document', doc_id, 'document:view')
                if denied:
                    return denied
        
    directory = os.path.dirname(safe_path)
    filename = os.path.basename(safe_path)
    
    return send_from_directory(directory, filename, as_attachment=False)
