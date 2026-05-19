import json
from flask import g
from models import db, AuditLog

def log_document_action(document_id, action, details=None):
    """
    Logs an action performed on a document by the current user.
    """
    user_id = getattr(g.user, 'id', None) if getattr(g, 'user', None) else None
    
    # Optional: ensure we only log if there is a document_id and action
    if not document_id or not action:
        return
        
    details_str = json.dumps(details) if details else None
    
    log_entry = AuditLog(
        document_id=document_id,
        user_id=user_id,
        action=action,
        details=details_str
    )
    
    db.session.add(log_entry)
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f"Error logging document action: {e}")
