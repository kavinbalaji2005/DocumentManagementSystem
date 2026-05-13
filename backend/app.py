import os
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify
from flask_cors import CORS
from models import db
from config import Config
from utils.storage import resolve_storage_path

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    
    # Initialize extensions
    CORS(app)
    db.init_app(app)
    
    # Register blueprints
    from routes.folders import folders_bp
    from routes.documents import documents_bp
    from routes.ai import ai_bp
    from routes.versions import versions_bp
    from routes.files import files_bp
    app.register_blueprint(folders_bp)
    app.register_blueprint(documents_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(versions_bp)
    app.register_blueprint(files_bp)
    
    # Setup storage directory
    storage_root = os.path.abspath(app.config['STORAGE_ROOT'])
    os.makedirs(storage_root, exist_ok=True)
    documents_dir = resolve_storage_path(storage_root, 'documents')
    os.makedirs(documents_dir, exist_ok=True)
    
    if not os.access(documents_dir, os.W_OK):
        raise RuntimeError(f"Storage directory {documents_dir} is not writable.")
        
    import threading
    from jobs.extractor import process_version
    
    with app.app_context():
        db.create_all()
        # Recover pending jobs that are stale (> 2 minutes old)
        from models import Version
        
        stale_threshold = datetime.now(timezone.utc) - timedelta(minutes=2)
        stuck_versions = Version.query.filter(
            Version.status == 'pending',
            Version.created_at <= stale_threshold
        ).all()

        for v in stuck_versions:
            thread = threading.Thread(target=process_version, args=(app, v.id))
            thread.daemon = True
            thread.start()

    @app.get('/health')
    def health():
        return jsonify({'status': 'ok'})

    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True, port=5001)
