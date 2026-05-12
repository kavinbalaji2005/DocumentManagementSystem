from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone
import json

def utc_now():
    return datetime.now(timezone.utc)

db = SQLAlchemy()

class Folder(db.Model):
    __tablename__ = 'folders'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey('folders.id', ondelete='CASCADE'), nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)
    
    # Relationships
    children = db.relationship('Folder', backref=db.backref('parent', remote_side=[id]), cascade="all, delete-orphan")
    documents = db.relationship('Document', backref='folder', cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'parent_id': self.parent_id,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat() if self.created_at else None,
            'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat() if self.updated_at else None,
            'child_count': len(self.children) + len(self.documents)
        }

class Document(db.Model):
    __tablename__ = 'documents'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    folder_id = db.Column(db.Integer, db.ForeignKey('folders.id', ondelete='CASCADE'), nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)
    current_version_number = db.Column(db.Integer, default=0)
    
    # Relationships
    versions = db.relationship('Version', backref='document', cascade="all, delete-orphan")

    def to_dict(self):
        # We also want extraction status of current version
        status = 'success'
        if self.versions:
            current = sorted(self.versions, key=lambda v: v.version_number)[-1]
            status = current.status
            
        return {
            'id': self.id,
            'name': self.name,
            'folder_id': self.folder_id,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat() if self.created_at else None,
            'updated_at': self.updated_at.replace(tzinfo=timezone.utc).isoformat() if self.updated_at else None,
            'current_version_number': self.current_version_number,
            'extraction_status': status
        }

class Version(db.Model):
    __tablename__ = 'versions'
    id = db.Column(db.Integer, primary_key=True)
    document_id = db.Column(db.Integer, db.ForeignKey('documents.id', ondelete='CASCADE'), nullable=False)
    version_number = db.Column(db.Integer, nullable=False)
    storage_path = db.Column(db.String(512), nullable=False) # Relative to STORAGE_ROOT
    file_hash = db.Column(db.String(64), nullable=False) # SHA-256
    file_size = db.Column(db.Integer, nullable=False) # Bytes
    
    # Extraction pipeline fields
    status = db.Column(db.String(20), default='pending') # pending, processing, success, failed
    error_message = db.Column(db.Text, nullable=True)
    
    extracted_blocks_json = db.Column(db.Text, nullable=True)
    extracted_html = db.Column(db.Text, nullable=True)
    extracted_text = db.Column(db.Text, nullable=True)
    
    # Diff against previous version
    diff_json = db.Column(db.Text, nullable=True)
    diff_html = db.Column(db.Text, nullable=True)
    stats_json = db.Column(db.Text, nullable=True) # {added_chars: 0, removed_chars: 0}
    ai_summary = db.Column(db.Text, nullable=True)
    name = db.Column(db.String(255), nullable=True) # Custom version name
    comment = db.Column(db.Text, nullable=True) # User comments
    
    created_at = db.Column(db.DateTime, default=utc_now)

    def to_dict(self):
        stats = {}
        if self.stats_json:
            try:
                stats = json.loads(self.stats_json)
            except:
                pass
                
        return {
            'id': self.id,
            'document_id': self.document_id,
            'version_number': self.version_number,
            'name': self.name,
            'comment': self.comment,
            'storage_path': self.storage_path,
            'file_size': self.file_size,
            'status': self.status,
            'error_message': self.error_message,
            'stats': stats,
            'ai_summary': self.ai_summary,
            'created_at': self.created_at.replace(tzinfo=timezone.utc).isoformat() if self.created_at else None
        }
