import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    _BACKEND_DIR = os.path.dirname(__file__)
    STORAGE_ROOT = os.path.abspath(os.path.join(_BACKEND_DIR, os.getenv('STORAGE_ROOT', '../storage')))
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL')
    
    if not SQLALCHEMY_DATABASE_URI:
        raise ValueError("No DATABASE_URL set. Please configure it in your .env file.")
        
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY')
    MISTRAL_API_KEY = os.getenv('MISTRAL_API_KEY')
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')
    if not JWT_SECRET_KEY:
        raise ValueError("No JWT_SECRET_KEY set. Please configure it in your .env file.")
        
    DEFAULT_ADMIN_ID = os.getenv('DEFAULT_ADMIN_ID', 'ELV0001')
    DEFAULT_ADMIN_PASSWORD = os.getenv('DEFAULT_ADMIN_PASSWORD', 'admin')
    MAX_CONTENT_LENGTH = 50 * 1024 * 1024 # 50MB
    
    # Mail settings (Google SMTP)
    MAIL_SENDER = os.getenv('MAIL_SENDER', 'kavinbalajibackup@gmail.com')
    MAIL_APP_PASSWORD = os.getenv('MAIL_APP_PASSWORD', '')
    MAIL_SMTP_HOST = os.getenv('MAIL_SMTP_HOST', 'smtp.gmail.com')
    MAIL_SMTP_PORT = int(os.getenv('MAIL_SMTP_PORT', '587'))
    
    # Security settings for CSRF and XSS protection
    is_prod = os.getenv('FLASK_ENV') == 'production' or os.getenv('ENV') == 'production'
    SESSION_COOKIE_SECURE = is_prod  # Set to True for HTTPS in production
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = None  # CSRF tokens don't expire
    WTF_CSRF_SSL_STRICT = is_prod  # Set to True in production
