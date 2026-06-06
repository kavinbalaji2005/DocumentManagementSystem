"""
Email notification utility for the Document Management System.

Uses Google SMTP (smtp.gmail.com) to send professional HTML notification emails
when major document actions occur. Emails are dispatched asynchronously in
background threads so they never block the API response.
"""

import smtplib
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone, timedelta

from models import (
    db, User, Document, Folder,
    ResourcePermission, GroupPermission
)
from utils.permissions import has_permission


# ───────────────────────── SMTP sender ─────────────────────────

def send_email(app, to_addresses, subject, html_body):
    """
    Send an HTML email via Google SMTP.
    Gracefully logs errors without raising so callers are never blocked.
    """
    if not to_addresses:
        return

    sender = app.config.get('MAIL_SENDER', '')
    password = app.config.get('MAIL_APP_PASSWORD', '')
    host = app.config.get('MAIL_SMTP_HOST', 'smtp.gmail.com')
    port = app.config.get('MAIL_SMTP_PORT', 587)

    if not sender or not password:
        app.logger.warning(
            'Mail not configured (MAIL_SENDER or MAIL_APP_PASSWORD empty). '
            'Skipping email to %s', to_addresses
        )
        return

    msg = MIMEMultipart('alternative')
    msg['From'] = f'DMS Notifications <{sender}>'
    msg['To'] = ', '.join(to_addresses)
    msg['Subject'] = subject
    msg.attach(MIMEText(html_body, 'html'))

    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(sender, password)
            server.sendmail(sender, to_addresses, msg.as_string())
        app.logger.info('Email sent to %s: %s', to_addresses, subject)
    except Exception as exc:
        app.logger.error('Failed to send email to %s: %s', to_addresses, exc)


# ───────────────── Recipient resolution ──────────────────

def get_document_recipients(document, exclude_user_id=None):
    """
    Return a list of email addresses for every user who has access to a
    document (direct permission, group permission, or folder-inherited).

    - Admin / Manager users always have access.
    - Employees are checked via the full permission resolution chain.
    - The acting user (exclude_user_id) is omitted so they don't get a
      notification about their own action.
    - Users without an email address are silently skipped.
    """
    recipients = set()
    all_users = User.query.all()

    for user in all_users:
        # Skip the actor
        if exclude_user_id and user.id == exclude_user_id:
            continue
        # Skip users with no email
        if not user.email:
            continue

        # Admin/Manager always have access
        if user.role in ('Admin', 'Manager'):
            recipients.add(user.email)
            continue

        # Employees: check via the permission system
        if has_permission(user, 'document', document.id, 'document:view'):
            recipients.add(user.email)

    return list(recipients)


def get_folder_recipients(folder_id, exclude_user_id=None):
    """
    Return email addresses for every user who has access to a folder.
    Used to find the *new* audience when a document is moved into a folder.
    """
    recipients = set()
    all_users = User.query.all()

    for user in all_users:
        if exclude_user_id and user.id == exclude_user_id:
            continue
        if not user.email:
            continue
        if user.role in ('Admin', 'Manager'):
            recipients.add(user.email)
            continue
        if has_permission(user, 'folder', folder_id, 'document:view'):
            recipients.add(user.email)

    return list(recipients)


# ───────────────── Folder breadcrumb builder ──────────────────

def _build_folder_path(folder_id):
    """Return a breadcrumb string like 'Home/Engineering/Reports' to match frontend's breadcrumbText."""
    if folder_id is None:
        return 'Home'
    parts = []
    current = Folder.query.get(folder_id)
    while current:
        parts.append(current.name)
        current = current.parent
    parts.reverse()
    return 'Home/' + '/'.join(parts) if parts else 'Home'


# ───────────────── Action metadata ──────────────────

# Colour palette for action badges in the email
_ACTION_META = {
    'DOCUMENT_CREATED': {
        'label': 'Document Created',
        'color': '#16a34a',       # green
        'bg':    '#dcfce7',
    },
    'NEW_VERSION_UPLOADED': {
        'label': 'New Version Uploaded',
        'color': '#2563eb',       # blue
        'bg':    '#dbeafe',
    },
    'DOCUMENT_DELETED': {
        'label': 'Document Deleted',
        'color': '#dc2626',       # red
        'bg':    '#fee2e2',
    },
    'DOCUMENT_MOVED': {
        'label': 'Document Moved',
        'color': '#d97706',       # amber
        'bg':    '#fef3c7',
    },
    'VERSION_RESTORED': {
        'label': 'Version Restored',
        'color': '#7c3aed',       # violet
        'bg':    '#ede9fe',
    },
    'FOLDER_DELETED': {
        'label': 'Folder Deleted',
        'color': '#dc2626',
        'bg':    '#fee2e2',
    },
    'USER_PERMISSION_CHANGE': {
        'label': 'Permissions Modified',
        'color': '#7c3aed',       # violet
        'bg':    '#ede9fe',
    },
    'GROUP_PERMISSION_CHANGE': {
        'label': 'Group Permissions Modified',
        'color': '#7c3aed',       # violet
        'bg':    '#ede9fe',
    },
}


# ───────────────── HTML email template ──────────────────

def _render_email_html(action, actor_name, document_name, folder_path,
                       timestamp_str, extra_details=None, document_uuid=None):
    """Build a professional, responsive HTML email body."""
    import os
    frontend_url = os.getenv('FRONTEND_URL') or 'http://localhost:5173'
    frontend_url = frontend_url.rstrip('/')
    
    if document_uuid:
        doc_url = f"{frontend_url}/document/{document_uuid}"
        doc_display = f'<a href="{doc_url}" style="color:#2563eb;text-decoration:underline;font-weight:600;">{document_name}</a>'
    else:
        doc_display = f'<span style="font-weight:600;color:#1f2937;">{document_name}</span>'

    meta = _ACTION_META.get(action, {
        'label': action.replace('_', ' ').title(),
        'color': '#6b7280',
        'bg':    '#f3f4f6',
    })

    details_rows = ''
    if extra_details:
        for key, value in extra_details.items():
            label = key.replace('_', ' ').title()
            details_rows += f'''
            <tr>
              <td style="padding:8px 16px;color:#6b7280;font-size:13px;
                         white-space:nowrap;vertical-align:top;">{label}</td>
              <td style="padding:8px 16px;color:#1f2937;font-size:14px;">{value}</td>
            </tr>'''

    return f'''<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background-color:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:12px;overflow:hidden;
                    box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#0f172a;
                     padding:28px 32px;text-align:center;">
            <span style="font-size:22px;font-weight:500;color:#ffffff;
                         letter-spacing:0.5px;">Document Management System</span>
          </td>
        </tr>

        <!-- Action badge -->
        <tr>
          <td style="padding:28px 32px 12px;text-align:center;">
            <span style="display:inline-block;background:{meta['bg']};
                         color:{meta['color']};font-size:14px;font-weight:600;
                         padding:6px 18px;border-radius:20px;letter-spacing:0.3px;
                         border:1px solid {meta['color']};">
              {meta['label']}
            </span>
          </td>
        </tr>

        <!-- Main info table -->
        <tr>
          <td style="padding:12px 32px 4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#f9fafb;">
                <td style="padding:8px 16px;color:#6b7280;font-size:13px;
                           white-space:nowrap;">Performed by</td>
                <td style="padding:8px 16px;color:#1f2937;font-size:14px;
                           font-weight:600;">{actor_name}</td>
              </tr>
              <tr>
                <td style="padding:8px 16px;color:#6b7280;font-size:13px;
                           white-space:nowrap;">Document</td>
                <td style="padding:8px 16px;font-size:14px;">{doc_display}</td>
              </tr>
              <tr style="background:#f9fafb;">
                <td style="padding:8px 16px;color:#6b7280;font-size:13px;
                           white-space:nowrap;">Location</td>
                <td style="padding:8px 16px;color:#1f2937;font-size:14px;">{folder_path}</td>
              </tr>
              <tr>
                <td style="padding:8px 16px;color:#6b7280;font-size:13px;
                           white-space:nowrap;">Date &amp; Time</td>
                <td style="padding:8px 16px;color:#1f2937;font-size:14px;">{timestamp_str}</td>
              </tr>
              {details_rows}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px 28px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
              This is an automated notification from the Document Management System.<br>
              You received this email because you have access to the affected document.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>'''


def _render_folder_delete_email(actor_name, folder_name, folder_path,
                                document_names, timestamp_str):
    """Build a batched HTML email for folder deletion with multiple documents."""
    doc_list_html = ''
    for name in document_names:
        doc_list_html += f'''
        <tr>
          <td style="padding:6px 16px;color:#1f2937;font-size:14px;
                     border-bottom:1px solid #f3f4f6;">&bull; {name}</td>
        </tr>'''

    return f'''<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background-color:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:12px;overflow:hidden;
                    box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#0f172a;
                     padding:28px 32px;text-align:center;">
            <span style="font-size:22px;font-weight:500;color:#ffffff;
                         letter-spacing:0.5px;">Document Management System</span>
          </td>
        </tr>

        <!-- Action badge -->
        <tr>
          <td style="padding:28px 32px 12px;text-align:center;">
            <span style="display:inline-block;background:#fee2e2;
                         color:#dc2626;font-size:14px;font-weight:600;
                         padding:6px 18px;border-radius:20px;letter-spacing:0.3px;
                         border:1px solid #dc2626;">
              Folder Deleted
            </span>
          </td>
        </tr>

        <!-- Main info -->
        <tr>
          <td style="padding:12px 32px 4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <tr style="background:#f9fafb;">
                <td style="padding:8px 16px;color:#6b7280;font-size:13px;
                           white-space:nowrap;">Performed by</td>
                <td style="padding:8px 16px;color:#1f2937;font-size:14px;
                           font-weight:600;">{actor_name}</td>
              </tr>
              <tr>
                <td style="padding:8px 16px;color:#6b7280;font-size:13px;
                           white-space:nowrap;">Folder</td>
                <td style="padding:8px 16px;color:#1f2937;font-size:14px;
                           font-weight:600;">{folder_name}</td>
              </tr>
              <tr style="background:#f9fafb;">
                <td style="padding:8px 16px;color:#6b7280;font-size:13px;
                           white-space:nowrap;">Location</td>
                <td style="padding:8px 16px;color:#1f2937;font-size:14px;">{folder_path}</td>
              </tr>
              <tr>
                <td style="padding:8px 16px;color:#6b7280;font-size:13px;
                           white-space:nowrap;">Date &amp; Time</td>
                <td style="padding:8px 16px;color:#1f2937;font-size:14px;">{timestamp_str}</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Affected documents -->
        <tr>
          <td style="padding:16px 32px 4px;">
            <p style="margin:0 0 8px;font-size:13px;color:#6b7280;font-weight:600;
                      text-transform:uppercase;letter-spacing:0.5px;">
              Affected Documents ({len(document_names)})
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              {doc_list_html}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px 28px;text-align:center;">
            <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
              This is an automated notification from the Document Management System.<br>
              You received this email because you had access to the affected documents.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>'''


# ───────────────── Public dispatch API ──────────────────

def _format_timestamp():
    """Return a human-readable IST timestamp string."""
    ist_tz = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist_tz)
    return now.strftime('%B %d, %Y at %I:%M %p IST')


def notify_document_event(app, document_id, action, actor_user,
                          extra_details=None, recipient_override=None):
    """
    Build and send an email notification for a document event.
    Runs the actual SMTP send in a background thread.

    Parameters
    ----------
    app : Flask app instance (use current_app._get_current_object())
    document_id : int
    action : str — one of the keys in _ACTION_META
    actor_user : User model instance (the person who performed the action)
    extra_details : dict|None — additional key/value pairs for the email body
    recipient_override : list|None — if provided, use these emails instead of
                         resolving recipients from the database
    """
    # Extract primitives in the request thread to prevent DetachedInstanceError
    actor_id = actor_user.id if actor_user else None
    actor_name = actor_user.employee_id if actor_user else 'System'

    def _send():
        with app.app_context():
            document = Document.query.get(document_id)
            if not document and not recipient_override:
                app.logger.warning(
                    'notify_document_event: document %s not found', document_id)
                return

            doc_name = document.name if document else extra_details.get('document_name', 'Unknown')
            folder_path = _build_folder_path(
                document.folder_id if document else extra_details.get('folder_id'))

            timestamp_str = _format_timestamp()

            if recipient_override:
                recipients = recipient_override
            else:
                recipients = get_document_recipients(
                    document, exclude_user_id=actor_id)

            if not recipients:
                app.logger.info(
                    'No recipients for %s on document %s', action, document_id)
                return

            # Remove fallback keys so they don't get rendered as extra details rows
            render_details = None
            if extra_details:
                render_details = {k: v for k, v in extra_details.items() if k not in ('document_name', 'folder_id')}

            subject = f'[DMS] {_ACTION_META.get(action, {}).get("label", action)}: {doc_name}'
            doc_uuid = document.uuid if document else None
            html = _render_email_html(
                action, actor_name, doc_name, folder_path,
                timestamp_str, render_details, document_uuid=doc_uuid)

            send_email(app, recipients, subject, html)

    thread = threading.Thread(target=_send, daemon=True)
    thread.start()


def notify_document_move(app, document_id, actor_user,
                         old_folder_id, new_folder_id):
    """
    Notify for a document move:
    - Old-location users get a "document moved away" notification.
    - New-location users get a "document added" notification.
    """
    # Extract primitives in the request thread to prevent DetachedInstanceError
    actor_id = actor_user.id if actor_user else None
    actor_name = actor_user.employee_id if actor_user else 'System'

    def _send():
        with app.app_context():
            document = Document.query.get(document_id)
            if not document:
                return

            doc_name = document.name
            timestamp_str = _format_timestamp()

            old_path = _build_folder_path(old_folder_id)
            new_path = _build_folder_path(new_folder_id)

            # Resolve new location recipients
            new_recipients = get_document_recipients(document, exclude_user_id=actor_id)
            new_recipients_set = set(new_recipients)

            # --- Notify old-location users ---
            old_recipients = []
            if old_folder_id is not None:
                old_recipients = get_folder_recipients(old_folder_id, exclude_user_id=actor_id)
            else:
                # Document was at root — admin/managers would know
                old_recipients = [
                    u.email for u in User.query.filter(
                        User.role.in_(['Admin', 'Manager']),
                        User.email.isnot(None),
                        User.id != actor_id
                    ).all() if u.email
                ]

            if old_recipients:
                # Split based on access to the new location
                old_with_access = [r for r in old_recipients if r in new_recipients_set]
                old_without_access = [r for r in old_recipients if r not in new_recipients_set]

                if old_with_access:
                    subject = f'[DMS] Document Moved: {doc_name}'
                    html = _render_email_html(
                        'DOCUMENT_MOVED', actor_name, doc_name, new_path,
                        timestamp_str, {
                            'Moved From': old_path,
                            'Moved To': new_path,
                        }, document_uuid=document.uuid)
                    send_email(app, old_with_access, subject, html)

                if old_without_access:
                    subject = f'[DMS] Document Moved (Access Lost): {doc_name}'
                    html = _render_email_html(
                        'DOCUMENT_MOVED', actor_name, doc_name, '[Access Restricted]',
                        timestamp_str, {
                            'Moved From': old_path,
                            'Moved To': '[Access Restricted]',
                            'Access Status': 'You have lost access to this document because it was moved to a restricted folder.'
                        }, document_uuid=None)
                    send_email(app, old_without_access, subject, html)

            # --- Notify new-location users (exclude those already notified) ---
            # Remove anyone who was already in old_recipients
            new_only = [r for r in new_recipients if r not in set(old_recipients)]

            if new_only:
                subject = f'[DMS] Document Added: {doc_name}'
                html = _render_email_html(
                    'DOCUMENT_MOVED', actor_name, doc_name, new_path,
                    timestamp_str, {
                        'Moved From': old_path,
                        'Moved To': new_path,
                    }, document_uuid=document.uuid)
                send_email(app, new_only, subject, html)

    thread = threading.Thread(target=_send, daemon=True)
    thread.start()


def notify_folder_deleted(app, actor_user, folder_name, folder_path,
                          document_names, recipients):
    """
    Send a single batched email per recipient for a folder deletion that
    affected multiple documents.
    """
    if not recipients or not document_names:
        return

    # Extract primitives in the request thread to prevent DetachedInstanceError
    actor_name = actor_user.employee_id if actor_user else 'System'

    def _send():
        with app.app_context():
            timestamp_str = _format_timestamp()
            subject = f'[DMS] Folder Deleted: {folder_name} ({len(document_names)} documents affected)'
            html = _render_folder_delete_email(
                actor_name, folder_name, folder_path,
                document_names, timestamp_str)
            send_email(app, recipients, subject, html)

    thread = threading.Thread(target=_send, daemon=True)
    thread.start()


def notify_user_permission_change(app, document_id, actor_user, target_user_id,
                                  given_privileges, taken_privileges):
    """
    Notify users with access to a document when a specific user's individual
    permissions are modified. Excludes the target user and the actor from the mailing list.
    Also emails the target user directly if they have gained or lost access.
    """
    actor_id = actor_user.id if actor_user else None
    actor_name = actor_user.employee_id if actor_user else 'System'

    def _send():
        with app.app_context():
            document = Document.query.get(document_id)
            if not document:
                return

            target_user = User.query.get(target_user_id)
            if not target_user:
                return

            doc_name = document.name
            folder_path = _build_folder_path(document.folder_id)
            timestamp_str = _format_timestamp()

            # Resolve recipients
            recipients = get_document_recipients(document, exclude_user_id=actor_id)
            
            # Exclude the target user from receiving the notification about their own permission change
            recipients = [r for r in recipients if r != target_user.email]

            # If target user has view access and was granted permissions, email them directly
            if target_user.email and has_permission(target_user, 'document', document.id, 'document:view'):
                subject_target = f'[DMS] Access Granted: {doc_name}'
                extra_details_target = {
                    'Access Status': 'You have been granted access to this document.'
                }
                if given_privileges:
                    extra_details_target['Privileges Granted'] = ', '.join(given_privileges)
                
                html_target = _render_email_html(
                    'DOCUMENT_CREATED', actor_name, doc_name, folder_path,
                    timestamp_str, extra_details_target, document_uuid=document.uuid)
                send_email(app, [target_user.email], subject_target, html_target)
            elif target_user.email and not has_permission(target_user, 'document', document.id, 'document:view') and taken_privileges:
                # Target user lost access completely
                subject_target = f'[DMS] Access Revoked: {doc_name}'
                extra_details_target = {
                    'Access Status': 'Your access to this document has been revoked.'
                }
                if taken_privileges:
                    extra_details_target['Privileges Revoked'] = ', '.join(taken_privileges)
                
                html_target = _render_email_html(
                    'DOCUMENT_DELETED', actor_name, doc_name, '[Access Restricted]',
                    timestamp_str, extra_details_target, document_uuid=None)
                send_email(app, [target_user.email], subject_target, html_target)

            if not recipients:
                return

            extra_details = {
                'Target User': f"{target_user.employee_id} ({target_user.email or 'No email'})",
            }
            if given_privileges:
                extra_details['Privileges Given'] = ', '.join(given_privileges)
            if taken_privileges:
                extra_details['Privileges Taken'] = ', '.join(taken_privileges)

            subject = f'[DMS] Permissions Updated for {target_user.employee_id} on {doc_name}'
            html = _render_email_html(
                'USER_PERMISSION_CHANGE', actor_name, doc_name, folder_path,
                timestamp_str, extra_details, document_uuid=document.uuid)

            send_email(app, recipients, subject, html)

    thread = threading.Thread(target=_send, daemon=True)
    thread.start()


def notify_group_permission_change(app, document_id, actor_user, target_group_id,
                                   given_privileges, taken_privileges):
    """
    Notify users with access to a document when a group's permissions are modified.
    Excludes all members of that group and the actor from the mailing list.
    Also emails group members directly if they have gained or lost access.
    """
    actor_id = actor_user.id if actor_user else None
    actor_name = actor_user.employee_id if actor_user else 'System'

    def _send():
        with app.app_context():
            from models import UserGroup
            document = Document.query.get(document_id)
            if not document:
                return

            group = UserGroup.query.get(target_group_id)
            if not group:
                return

            doc_name = document.name
            folder_path = _build_folder_path(document.folder_id)
            timestamp_str = _format_timestamp()

            # Resolve recipients
            recipients = get_document_recipients(document, exclude_user_id=actor_id)
            
            # Exclude all members of the target group from receiving this notification
            group_emails = {m.email for m in group.members.all() if m.email}
            recipients = [r for r in recipients if r not in group_emails]

            # Split group members into those who now have and do not have view access
            members_with_view = []
            members_without_view = []
            for m in group.members.all():
                if not m.email or m.id == actor_id:
                    continue
                if has_permission(m, 'document', document.id, 'document:view'):
                    members_with_view.append(m.email)
                else:
                    members_without_view.append(m.email)

            if members_with_view and given_privileges:
                subject_group = f'[DMS] Access Granted: {doc_name}'
                extra_details_group = {
                    'Access Status': f'Your group "{group.name}" has been granted access to this document.'
                }
                if given_privileges:
                    extra_details_group['Group Privileges Granted'] = ', '.join(given_privileges)
                
                html_group = _render_email_html(
                    'DOCUMENT_CREATED', actor_name, doc_name, folder_path,
                    timestamp_str, extra_details_group, document_uuid=document.uuid)
                send_email(app, members_with_view, subject_group, html_group)

            if members_without_view and taken_privileges:
                subject_group = f'[DMS] Access Revoked: {doc_name}'
                extra_details_group = {
                    'Access Status': f'Your group "{group.name}" access to this document has been revoked.'
                }
                if taken_privileges:
                    extra_details_group['Group Privileges Revoked'] = ', '.join(taken_privileges)
                
                html_group = _render_email_html(
                    'DOCUMENT_DELETED', actor_name, doc_name, '[Access Restricted]',
                    timestamp_str, extra_details_group, document_uuid=None)
                send_email(app, members_without_view, subject_group, html_group)

            if not recipients:
                return

            extra_details = {
                'Target Group': group.name,
            }
            if given_privileges:
                extra_details['Privileges Given'] = ', '.join(given_privileges)
            if taken_privileges:
                extra_details['Privileges Taken'] = ', '.join(taken_privileges)

            subject = f'[DMS] Group Permissions Updated for {group.name} on {doc_name}'
            html = _render_email_html(
                'GROUP_PERMISSION_CHANGE', actor_name, doc_name, folder_path,
                timestamp_str, extra_details, document_uuid=document.uuid)

            send_email(app, recipients, subject, html)

    thread = threading.Thread(target=_send, daemon=True)
    thread.start()
