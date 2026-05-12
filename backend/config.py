import os
from dotenv import load_dotenv

load_dotenv()


def _resolve_database_url(raw_database_url, backend_dir, storage_root):
    if not raw_database_url:
        return f"sqlite:///{os.path.join(storage_root, 'dms.db')}"

    # Flask-SQLAlchemy resolves relative sqlite paths from instance_path.
    # Normalize to an absolute sqlite URI so behavior is stable from any cwd.
    if raw_database_url.startswith('sqlite:///') and not raw_database_url.startswith('sqlite:////'):
        sqlite_path = raw_database_url[len('sqlite:///'):]
        if sqlite_path != ':memory:' and not os.path.isabs(sqlite_path):
            absolute_path = os.path.abspath(os.path.join(backend_dir, sqlite_path))
            return f"sqlite:///{absolute_path}"

    return raw_database_url


class Config:
    _BACKEND_DIR = os.path.dirname(__file__)
    STORAGE_ROOT = os.path.abspath(os.path.join(_BACKEND_DIR, os.getenv('STORAGE_ROOT', '../storage')))
    SQLALCHEMY_DATABASE_URI = _resolve_database_url(
        os.getenv('DATABASE_URL'),
        _BACKEND_DIR,
        STORAGE_ROOT
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
    MAX_CONTENT_LENGTH = 20 * 1024 * 1024 # 20MB
