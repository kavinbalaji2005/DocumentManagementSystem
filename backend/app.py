import os
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify
from flask_cors import CORS
from sqlalchemy import inspect, text
from models import db
from config import Config
from utils.storage import resolve_storage_path


def ensure_user_email_column(app):
    """Backfill schema for existing DBs that predate the users.email column."""
    with app.app_context():
        inspector = inspect(db.engine)
        columns = {c['name'] for c in inspector.get_columns('users')}
        if 'email' in columns:
            return

        db.session.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL"))
        db.session.commit()

        inspector = inspect(db.engine)
        indexes = inspector.get_indexes('users')
        has_unique_email_index = any(
            idx.get('unique') and idx.get('column_names') == ['email']
            for idx in indexes
        )

        if not has_unique_email_index:
            db.session.execute(text("CREATE UNIQUE INDEX uq_users_email ON users (email)"))
            db.session.commit()

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    
    # Initialize extensions
    db.init_app(app)
    
    is_prod = os.getenv('FLASK_ENV') == 'production' or os.getenv('ENV') == 'production'

    # Add CSRF protection with SameSite cookies
    # Talisman must be initialized BEFORE CORS so that CORS's after_request
    # handler runs last and ensures Access-Control headers are present.
    from flask_talisman import Talisman
    Talisman(app, 
        force_https=is_prod,  # Set to True in production
        strict_transport_security=is_prod,  # Set to True in production
        content_security_policy=None  # Disable CSP to avoid blocking cross-origin requests in dev
    )
    
    frontend_urls = os.getenv('FRONTEND_URL')
    if frontend_urls:
        origins = [url.strip() for url in frontend_urls.split(',') if url.strip()]
    else:
        origins = "*"
        
    CORS(app, resources={r"/*": {"origins": origins}}, supports_credentials=False)
    
    # Register blueprints
    from routes.folders import folders_bp
    from routes.documents import documents_bp
    from routes.ai import ai_bp
    from routes.versions import versions_bp
    from routes.files import files_bp
    from routes.auth import auth_bp
    from routes.search import search_bp
    from routes.groups import groups_bp
    app.register_blueprint(folders_bp)
    app.register_blueprint(documents_bp)
    app.register_blueprint(ai_bp)
    app.register_blueprint(versions_bp)
    app.register_blueprint(files_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(search_bp)
    app.register_blueprint(groups_bp)
    
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
        ensure_user_email_column(app)
        
        # Create default admin if not exists
        from models import User
        admin_id = app.config.get('DEFAULT_ADMIN_ID', 'ELV0001')
        if not User.query.filter_by(employee_id=admin_id).first():
            admin_pass = app.config.get('DEFAULT_ADMIN_PASSWORD', 'admin')
            if admin_pass == 'admin':
                print("WARNING: Using default 'admin' password. Please set DEFAULT_ADMIN_PASSWORD in .env for production.")
            
            admin = User(employee_id=admin_id, role='Admin')
            admin.set_password(admin_pass)
            db.session.add(admin)
            db.session.commit()
            print(f"Created default admin user {admin_id}")

        # Recover pending jobs that are stale (> 2 minutes old)
        from models import Version
        
        stale_threshold = datetime.now(timezone(timedelta(hours=5, minutes=30))) - timedelta(minutes=2)
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
