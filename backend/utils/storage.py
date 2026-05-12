import os


def _absolute_storage_root(storage_root):
    return os.path.abspath(storage_root)


def resolve_storage_path(storage_root, relative_path):
    if not relative_path:
        raise ValueError("relative_path is required")

    absolute_root = _absolute_storage_root(storage_root)
    absolute_path = os.path.abspath(os.path.join(absolute_root, relative_path))
    try:
        common_root = os.path.commonpath([absolute_root, absolute_path])
    except ValueError as exc:
        raise ValueError(f"Path escapes storage root: {relative_path}") from exc

    if common_root != absolute_root:
        raise ValueError(f"Path escapes storage root: {relative_path}")

    return absolute_path


def resolve_document_directory(storage_root, document_id):
    return resolve_storage_path(storage_root, f"documents/{int(document_id)}")
