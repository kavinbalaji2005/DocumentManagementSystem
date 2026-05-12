import json


def log_event(logger, event, level="info", **fields):
    payload = {"event": event, **fields}
    message = json.dumps(payload, default=str)
    log_method = getattr(logger, level, logger.info)
    log_method(message)
