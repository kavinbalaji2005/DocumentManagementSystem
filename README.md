# Document Management System (DMS)

A full-stack, self-hosted Document Management System with native file rendering, robust version control, role-based access management, audit logging, and AI-powered document difference analysis.

---

## Tech Stack

### Backend
* **Core**: Python (Flask, Flask-SQLAlchemy, Flask-CORS)
* **Database**: MySQL (SQLAlchemy ORM + PyMySQL)
* **Processing**:
  * `python-docx` & `mammoth` (DOCX structure and HTML conversion)
  * `pdfplumber` (PDF layout analysis)
  * **Mistral Document AI OCR** (PDF text block & layout extraction)
* **AI Analysis**: OpenRouter API (Semantic version diffing and high-level summarization)

### Frontend
* **Core**: React, Vite, TailwindCSS
* **State & Querying**: Tailwind Typography, React Query (TanStack Query), Axios
* **Components**: `shadcn/ui` primitives (Radix UI under the hood)
* **Icons**: Lucide React
* **Document Rendering**:
  * `docx-preview` (Native client-side Word document rendering)
  * `htmldiff-js` (Visual diff tracking)

---

## Features

### Authentication

All access is gated behind a login screen. Users authenticate with their **Employee ID or registered email address** alongside their password. Sessions are JWT-secured, and the backend enforces role-based route protection on every request.

<p align="center">
  <img src="docs/screenshots/login.png" alt="Login Screen" width="700"/>
</p>

---

### Hierarchical File Explorer

The main workspace presents your document library as a familiar file explorer. Folders and documents appear as cards in the main pane, with a collapsible sidebar tree reflecting the same nested hierarchy.

* Nested directory structures with infinite depth.
* Context menus for folder creation, renaming, and secure deletion.
* Breadcrumb navigation in the top bar shows your current path at a glance.
* Global **Search** bar for locating documents across the entire tree.
* **New Folder** and **Upload Document** actions are always accessible from the top-right toolbar.

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Main Workspace — File Explorer" width="900"/>
</p>

#### Uploading a Document

Clicking **Upload Document** opens a modal that confirms the target folder and provides a drag-and-drop / click-to-select area. Supported formats are `.docx` and `.pdf` (up to 50 MB). The uploaded file is immediately processed by the backend pipeline and appears in the workspace on completion.

<p align="center">
  <img src="docs/screenshots/upload-document.png" alt="Upload Document Modal" width="700"/>
</p>

---

### Role-Based Access Control (RBAC)

Three defined user roles control what each account can see and do:

| Role | Capabilities |
|---|---|
| **Admin** | Full access — user management, all document operations, audit logs |
| **Manager** | Document operations, version management, audit log access |
| **User / Employee** | View and download documents within their permitted scope |

#### Granular Privilege Matrix

| Privilege / Action | Admin | Manager | Employee (Inherited / Explicitly Granted) |
|---|---|---|---|
| System Permission Bypass | Yes | Yes | No |
| Create Root-Level Folder | Yes | Yes | No |
| Create Folder (folder:create) | Yes | Yes | No |
| Update Folder (folder:update) | Yes | Yes | No |
| Delete Folder (folder:delete) | Yes | Yes | No |
| Create Document (document:create) | Yes | Yes | Yes (Explicitly Granted) |
| View Document (document:view) | Yes | Yes | Yes (Explicitly Granted) |
| Download Document (document:download) | Yes | Yes | Yes (Explicitly Granted) |
| Update Document (document:update) | Yes | Yes | No |
| Delete Document (document:delete) | Yes | Yes | No |
| Create Version (version:create) | Yes | Yes | Yes (Explicitly Granted) |
| View Document Audit Logs | Yes | No | No |
| Export Document Audit Logs | Yes | No | No |
| Create/Update/Delete Users | Yes | No | No |

Frontend capability filtering ensures that UI controls (e.g., version upload, audit log tab, delete actions) are conditionally rendered based on the authenticated user's role. Backend routes enforce the same rules independently.

#### User Management — Employees

Admins access **User Management** from the sidebar. The **Employees** tab lists all accounts with their Employee ID, email, current role, group membership, and creation date. Roles can be changed inline via dropdown, and accounts can be provisioned or removed directly from this view.

<p align="center">
  <img src="docs/screenshots/user-management-employees.png" alt="User Management — Employees Tab" width="900"/>
</p>

#### User Management — Groups

The **Groups** tab lets admins create named groups (e.g., *Engineering*, *Dev*), assign ungrouped employees to them, and manage membership. Groups provide a convenient unit for scoping document access without managing permissions user-by-user.

<p align="center">
  <img src="docs/screenshots/user-management-groups.png" alt="User Management — Groups Tab" width="900"/>
</p>

---

### Multi-Format Document Viewer

Opening any document launches a full-screen viewer. A tab bar at the top switches between the available view modes. A collapsible **Version History** panel on the right lists every uploaded version with its timestamp, file size, change note, and a one-click restore action.

#### Normal View

Renders the document in its native format:
* **PDF** — pages are drawn to a browser canvas with accurate layout, pagination indicator, and page-jump controls.
* **DOCX** — streamed and rendered client-side by `docx-preview` with CSS layouts that match the original Word document structure, including headings, body text, and inline formatting.

<p align="center">
  <img src="docs/screenshots/document-normal-view.png" alt="Document Viewer — Normal View (PDF)" width="900"/>
</p>

#### OCR View

Exposes the raw output of the **Mistral Document AI OCR** pipeline. Text blocks and layout regions extracted from the PDF are displayed with visual overlays, making it easy to verify extraction quality or inspect machine-readable content in scanned documents.

<p align="center">
  <img src="docs/screenshots/document-ocr-view.png" alt="Document Viewer — OCR View" width="900"/>
</p>

---

### Semantic AI Diffing

The **Diff View** is the most powerful feature of the DMS. Rather than a raw line-by-line character diff, the system uses an LLM (via OpenRouter) to produce a structured, human-readable changelog between any two consecutive versions.

* An **AI Diff Summary** panel at the top of the view breaks changes into labelled categories: **Deletions**, **Modifications**, and **Additions** — each described in plain language (e.g., *"Earned/privilege leave reduced from 12 days → 8 days"*).
* Below the summary, the document body renders inline with `<ins>` (green) and `<del>` (red strikethrough) markers so you can pinpoint exactly where in the document each change occurred.
* Large contiguous changes are grouped; redundant formatting edits and OCR noise are filtered out automatically.
* The **Regenerate** button re-triggers the AI analysis on demand.
* Token cost for the LLM call is surfaced transparently below the summary.
* The **Version History** sidebar lets you select which version pair to compare.

<p align="center">
  <img src="docs/screenshots/document-diff-view.png" alt="Document Viewer — AI Diff View (DOCX)" width="900"/>
</p>

---

### System Audit Trail

Every significant action in the system is recorded and associated with the acting user, their role, a typed action label, and a detail string. The **Audit Log** is available both at the system level and scoped to individual documents.

* The log table is filterable and sortable.
* One-click **Export to CSV** for compliance reporting or external archival.

<p align="center">
  <img src="docs/screenshots/document-audit-log.png" alt="Document Audit Log" width="900"/>
</p>

Every event performed is recorded inside the backend database with detailed JSON metadata representing the precise action payload:

| Action Code | Trigger Event | Captured Metadata Details |
|---|---|---|
| **`CREATE`** | A new document is successfully created and uploaded. | `{'name': document_name, 'folder_id': parent_folder_id}` |
| **`UPDATE`** | A document is renamed or moved to another folder. | `{'name': new_name}` or `{'folder_id': target_folder_uuid}` |
| **`DOWNLOAD`** | A user downloads a document copy or a specific historical version. | `{'version': version_number}` |
| **`VERSION_UPLOAD`** | A new version is added to an existing document. | `{'version': next_version_number, 'change_note': uploader_comments}` |
| **`VERSION_UPDATE`** | An uploader or manager updates the change log note of a version. | `{'version': version_number, 'change_note': updated_note}` |
| **`VERSION_RESTORE`** | An older version is restored as the latest head. | `{'restored_from': target_version_number, 'new_version': new_version_number}` |
| **`AI_SUMMARIZE`** | OpenRouter is called to compute a semantic diff changelog. | `{'version': compared_version_number}` |
| **`AI_OCR`** | Mistral AI OCR is triggered to extract page layout blocks. | `{'version': processed_version_number}` |
| **`EXPORT_AUDIT`** | Scoped document history is exported to a CSV spreadsheet. | *(No additional payload required)* |

---

## Email Notifications

The Document Management System includes a built-in asynchronous email dispatch utility (`backend/utils/mail.py`) that handles SMTP mail transport in background threads. Notifications feature rich, responsive HTML layouts with action-specific badges, detailed metadata tables, and direct hyperlinked gateways to the document vault.

### Core Email Scenarios

The system dynamically resolves recipients and content based on user roles and permissions:

#### 1. Document Life Cycle
* **Document Created**
  * **Audience**: All users who have access to the new document (resolved via direct, group, or inherited folder permissions), excluding the actor.
  * **Content**: Subject `[DMS] Document Created: [name]`. Includes a dynamic, direct transition hyperlink and the exact Home-anchored breadcrumb path (e.g. `Home/Engineering/Reports`).
* **New Version Uploaded**
  * **Audience**: All users with view permission on the document, excluding the actor.
  * **Content**: Subject `[DMS] New Version Uploaded: [name]`. Lists the new version number (e.g., `v3`), uploader comments (change note), and a direct dynamic link to review.
* **Document Deleted**
  * **Audience**: Pre-resolved list of users who had access to the document prior to deletion.
  * **Content**: Subject `[DMS] Document Deleted: [name]`. Alerts users that the resource was permanently deleted, safely downgrading links to plain text.

#### 2. Directory Operations & Batched Alerts
* **Folder Deleted (Consolidated Alert)**
  * **Audience**: Unique set of users who had access to the folder tree and its contents, excluding the actor.
  * **Content**: Subject `[DMS] Folder Deleted: [folder_name] ([Count] documents affected)`. Combines all affected items into a single, clean bulleted list to prevent mailbox flooding.

#### 3. Document Relocation & Access-Aware Redaction
When a document is moved (`notify_document_move`), the mail utility dynamically evaluates target audience permissions to safeguard confidentiality:
* **Moved (Access Retained)**
  * **Audience**: Users who had access to the old location and still have access to the new destination.
  * **Content**: Subject `[DMS] Document Moved: [name]`. Displays symmetric `'Moved From'` and `'Moved To'` details, alongside direct document hyperlinks.
* **Moved (Access Lost)**
  * **Audience**: Users who had access to the old location but **do not** have access to the destination folder.
  * **Content**: Subject `[DMS] Document Moved (Access Lost): [name]`. To protect vault integrity, the destination path is redacted as `[Access Restricted]`, direct hyperlinks are suppressed (rendered as plain text), and an explicit `'Access Status': 'You have lost access to this document because it was moved to a restricted folder.'` row is appended.
* **Document Added (New Location)**
  * **Audience**: Users at the new location who did not have access to the old folder.
  * **Content**: Subject `[DMS] Document Added: [name]`. Welcomes new viewers with a direct link and the full `'Moved From'` and `'Moved To'` breadcrumbs.

#### 4. Explicit Workspace Permissions
* **Access Granted (Direct User / Group Member)**
  * **Audience**: The target user or group members gaining view access to a document.
  * **Content**: Subject `[DMS] Access Granted: [name]`. Delivers a direct link to the document, their location breadcrumb, and a detailed list of newly granted privileges.
* **Access Revoked (Direct User / Group Member)**
  * **Audience**: The target user or group members losing access to a document.
  * **Content**: Subject `[DMS] Access Revoked: [name]`. Notifies them of permission loss, redacting location details as `[Access Restricted]` and suppressing document hyperlinks.
* **Permissions Modified (Audit trail for other viewers)**
  * **Audience**: Other existing document viewers, excluding the target and the actor.
  * **Content**: Subject `[DMS] Permissions Updated for [target] on [name]`. Logs specific privileges given or taken for transparent, workspace-wide access tracking.

---

## Project Structure

```
├── backend/
│   ├── routes/          # Blueprint API endpoints (auth, files, folders, ai, etc.)
│   ├── jobs/            # PDF and DOCX processing pipelines
│   ├── utils/           # Shared utilities (audit loggers, permissions, diff engines)
│   ├── models.py        # SQLAlchemy schema definitions
│   ├── config.py        # Environment loader
│   └── app.py           # Application entrypoint & init script
│
├── frontend/
│   ├── src/
│   │   ├── components/  # Feature modules, UI primitives, and layout templates
│   │   ├── context/     # Auth and session context providers
│   │   ├── pages/       # Route-level views (Login, Users, Workspace)
│   │   └── api.js       # Central API client & interceptors
│   ├── package.json
│   └── tailwind.config.js
│
├── docs/
│   └── screenshots/     # README screenshot assets
│
└── storage/             # Locally stored version files
```

---

## Setup & Installation

### Prerequisites
* **Python 3.10+**
* **Node.js 18+** & **npm**

---

### 1. Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install required packages:
   ```bash
   pip install -r requirements.txt
   ```

3. Database Connection Setup (MySQL):
   Ensure MySQL is running on your system, then create the database and user permissions using a MySQL shell:
   ```sql
   CREATE DATABASE dms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'dms_user'@'127.0.0.1' IDENTIFIED BY '12345';
   GRANT ALL PRIVILEGES ON dms.* TO 'dms_user'@'127.0.0.1';
   FLUSH PRIVILEGES;
   ```

4. Create a `.env` file in the `backend/` directory:
   ```env
   DATABASE_URL=mysql+pymysql://dms_user:12345@127.0.0.1:3306/dms?charset=utf8mb4
   STORAGE_ROOT=../storage
   JWT_SECRET_KEY=generate-a-secure-random-string-here
   # Default Admin Credentials
   DEFAULT_ADMIN_ID=ELV0001
   DEFAULT_ADMIN_PASSWORD=admin

   # AI Integration API Keys
   OPENROUTER_API_KEY=your-openrouter-key-here
   MISTRAL_API_KEY=your-mistral-ocr-key-here

   # Mail Server Configuration (Optional)
   # Required if you want to receive asynchronous HTML email alerts on document operations
   MAIL_SENDER=your-sender-email@gmail.com
   MAIL_APP_PASSWORD=your-google-app-password
   MAIL_SMTP_HOST=smtp.gmail.com
   MAIL_SMTP_PORT=587

   # Production Environment Settings (Optional)
   # Set FLASK_ENV=production to automatically enable forced HTTPS redirects,
   # HSTS strict transport headers, and secure SameSite session cookies.
   FLASK_ENV=development

   # Comma-separated list of authorized frontend origins for CORS.
   # Fallback is "*" if left blank (perfect for quick local demos).
   FRONTEND_URL=http://localhost:5173
   ```

5. Run the server (this runs initialization routines to create database tables and bootstrap the default admin):
   ```bash
   python app.py
   ```
   *The backend will boot up at `http://localhost:5001`.*

---

### 2. Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd ../frontend
   ```

2. Install client dependencies:
   ```bash
   npm install
   ```

3. Spin up the development server:
   ```bash
   npm run dev
   ```
   *The client interface will spin up at `http://localhost:5173`.*

4. **Production Frontend Configuration (Optional)**:
   Define the backend URL before compiling the production bundle. Create a `.env` file in the `frontend/` directory:
   ```env
   VITE_API_URL=https://api.dms.yourdomain.com
   ```
   And build the optimized production assets:
   ```bash
   npm run build
   ```

---

## Default Credentials

On your initial database generation run, the system automatically bootstraps the root Administrator account using values from the backend `.env`:
* **Username / ID**: *Value assigned to `DEFAULT_ADMIN_ID` in your backend `.env` (defaults to `ELV0001` if omitted)*
* **Password**: *Value assigned to `DEFAULT_ADMIN_PASSWORD` in your backend `.env` (defaults to `admin` if omitted)*

---