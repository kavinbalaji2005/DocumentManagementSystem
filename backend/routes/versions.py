from sqlalchemy.orm.unitofwork import SaveUpdateState
import os
import json
from flask import Blueprint, request, jsonify, current_app
from models import db, Version
from utils.storage import resolve_storage_path, resolve_document_directory
from utils.diffing import coerce_blocks, compute_block_diff

versions_bp = Blueprint('versions', __name__, url_prefix='/versions')

@versions_bp.route('/<int:version_id>/view', methods=['GET'])
def view_version(version_id):
    version = Version.query.get_or_404(version_id)
    return jsonify({
        'extracted_html': version.extracted_html,
        'status': version.status,
        'error_message': version.error_message
    })

@versions_bp.route('/diff', methods=['GET'])
def get_diff():
    # from=v1_id & to=v2_id
    from_id = request.args.get('from')
    to_id = request.args.get('to')

    if not to_id:
        return jsonify({'error': 'to parameter is required'}), 400

    try:
        to_version_id = int(to_id)
    except ValueError:
        return jsonify({'error': 'to must be an integer'}), 400

    from_version_id = None
    if from_id:
        try:
            from_version_id = int(from_id)
        except ValueError:
            return jsonify({'error': 'from must be an integer'}), 400

    to_version = Version.query.get_or_404(to_version_id)

    if from_version_id is None:
        stats = {}
        if to_version.stats_json:
            try:
                stats = json.loads(to_version.stats_json)
            except (TypeError, ValueError, json.JSONDecodeError):
                stats = {}

        return jsonify({
            'stats': stats,
            'ai_summary': to_version.ai_summary
        })

    from_version = Version.query.get_or_404(from_version_id)

    if from_version.document_id != to_version.document_id:
        return jsonify({'error': 'from and to versions must belong to the same document'}), 400

    if from_version.id == to_version.id:
        return jsonify({'error': 'from and to versions must be different'}), 400

    if from_version.version_number >= to_version.version_number:
        return jsonify({'error': 'from version must be older than to version'}), 400

    if from_version.status != 'success' or to_version.status != 'success':
        return jsonify({'error': 'Both versions must finish extraction before diffing'}), 409

    # Optimization: if file hashes are identical, there are no changes
    if from_version.file_hash == to_version.file_hash:
        return jsonify({
            'stats': {
                'added_chars': 0,
                'removed_chars': 0,
                'added_blocks': 0,
                'removed_blocks': 0,
                'modified_blocks': 0,
            },
            'ai_summary': None
        })

    from_blocks = coerce_blocks(
        blocks_json=from_version.extracted_blocks_json,
        extracted_text=from_version.extracted_text
    )
    to_blocks = coerce_blocks(
        blocks_json=to_version.extracted_blocks_json,
        extracted_text=to_version.extracted_text
    )

    _, stats, _ = compute_block_diff(from_blocks, to_blocks)

    previous_version = Version.query.filter_by(
        document_id=to_version.document_id,
        version_number=to_version.version_number - 1
    ).first()
    ai_summary = to_version.ai_summary if previous_version and previous_version.id == from_version.id else None

    if to_version.stats_json:
        try:
            saved_stats = json.loads(to_version.stats_json)
            if 'ai_prompt_tokens' in saved_stats:
                stats['ai_prompt_tokens'] = saved_stats['ai_prompt_tokens']
            if 'ai_completion_tokens' in saved_stats:
                stats['ai_completion_tokens'] = saved_stats['ai_completion_tokens']
        except Exception:
            pass

    return jsonify({
        'stats': stats,
        'ai_summary': ai_summary
    })

@versions_bp.route('/<int:version_id>', methods=['PATCH'])
def update_version(version_id):
    version = Version.query.get_or_404(version_id)
    data = request.get_json() or {}
    
    if 'name' in data:
        version.name = data['name']
    if 'comment' in data:
        version.comment = data['comment']
        
    db.session.commit()
    return jsonify(version.to_dict())

@versions_bp.route('/<int:version_id>/restore', methods=['POST'])
def restore_version(version_id):
    version = Version.query.get_or_404(version_id)
    document = version.document
    
    document.current_version_number += 1
    
    # Copy file to new version
    storage_root = current_app.config['STORAGE_ROOT']
    old_filepath = resolve_storage_path(storage_root, version.storage_path)
    
    import shutil
    doc_dir = resolve_document_directory(storage_root, document.id)
    os.makedirs(doc_dir, exist_ok=True)
    filename = f"v{document.current_version_number}_{version.file_hash[:8]}.docx"
    new_filepath = os.path.join(doc_dir, filename)
    
    shutil.copy2(old_filepath, new_filepath)
    
    new_version = Version()
    new_version.document_id = document.id
    new_version.version_number = document.current_version_number
    new_version.storage_path = f"documents/{document.id}/{filename}"
    new_version.file_hash = version.file_hash
    new_version.file_size = version.file_size
    new_version.status = 'pending'
    version_label = version.name if version.name else f"Version {version.version_number}"
    new_version.comment = f"Restored from {version_label}"
    
    db.session.add(new_version)
    db.session.commit()
    
    # Trigger background extraction job
    import threading
    from jobs.extractor import process_version
    app = current_app._get_current_object()
    thread = threading.Thread(target=process_version, args=(app, new_version.id))
    thread.daemon = True
    thread.start()
        
    return jsonify(new_version.to_dict()), 201
