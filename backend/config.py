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
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')
    if not JWT_SECRET_KEY:
        raise ValueError("No JWT_SECRET_KEY set. Please configure it in your .env file.")
        
    DEFAULT_ADMIN_PASSWORD = os.getenv('DEFAULT_ADMIN_PASSWORD')
    MAX_CONTENT_LENGTH = 20 * 1024 * 1024 # 20MB
