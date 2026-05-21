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

### Hierarchical File Explorer
* Nested directory structures with infinite depth.
* Context menus for folder creation, renaming, and secure deletion.
* Breadcrumb navigation.

### Role-Based Access Control (RBAC)
* Three defined user roles: `Admin`, `Manager`, and `User`.
* Granular route protections and frontend capability filtering (e.g., viewing, updating versions, downloading, audit log access).

### Multi-Format Document Viewer
* **Normal View**: Renders standard PDF sheets using browser-native canvas methods, or `.docx` streams directly on the client with CSS layouts matching the original document structure.
* **OCR View**: Exposes parsed Mistral Document AI OCR text layouts.
* **Diff View**: Renders inline insertions (`ins`) and deletions (`del`) between consecutive file versions.

### Semantic AI Diffing
* High-fidelity page-by-page comparison.
* LLM-driven changelogs mapping actual semantic additions, updates, or removals.
* Automatically groups large contiguous changes and ignores redundant formatting edits or OCR noise.

### System Audit Trail
* Full-coverage system tracking logging document uploads, downloads, account modifications, and permissions changes.
* Filterable logging tables.
* Clean CSV export support.

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
   DEFAULT_ADMIN_PASSWORD=admin
   
   # AI Integration API Keys
   OPENROUTER_API_KEY=your-openrouter-key-here
   MISTRAL_API_KEY=your-mistral-ocr-key-here
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

---

## Default Credentials

On your initial database generation run, the system automatically creates the root Administrator account:
* **Username / ID**: `ELV0001`
* **Password**: *Value assigned to `DEFAULT_ADMIN_PASSWORD` in your backend `.env`*
