# Document Management System (DMS)

Browser-based document management with folder/document CRUD, DOCX versioning, visual rendering, inline diffing, and AI change summaries.

## Current stack in this repo

### Frontend

- React `19.2.5`
- Vite `8.x`
- TanStack Query `5.x`
- React Hook Form `7.x`
- shadcn/ui + Radix UI + Tailwind CSS `3.4.x`
- Lucide React, date-fns, axios

### Backend

- Flask `3.0.3`
- Flask-SQLAlchemy `3.1.1` + SQLAlchemy `2.0.30`
- SQLite
- python-docx `1.1.2`, mammoth `1.7.0`, diff-match-patch `20200713`
- APScheduler `3.10.4`
- OpenAI Python client (`openrouter` compatible endpoint)

## Implemented capabilities

- Folder CRUD with recursive subfolders and move support
- Document upload/rename/move/delete
- Version history, restore, and single-version delete (with safety checks)
- DOCX extraction pipeline (`extracted_blocks_json`, `extracted_html`, `extracted_text`)
- Inline diff rendering with block-aware matching and modified block highlighting
- AI summary generation from changed blocks (`added`, `removed`, `modified`)
- Startup recovery for stale pending extraction jobs (>2 minutes)
- Storage path safety checks and post-write checksum verification

## API highlights

- Folders: `/folders`, `/folders/root/children`, `/folders/:id/children`, `/folders/:id/delete-preview`
- Documents: `/documents/upload`, `/documents/:id`, `/documents/:id/versions`
- Versions: `/versions/:id/view`, `/versions/diff?from=&to=`, `/versions/:id/restore`, `/versions/:id`
- AI: `/ai/summarize-diff`

## Run locally

1. **Backend**
   - Create/use virtual environment in `backend/`
   - Install `backend/requirements.txt`
   - Configure `backend/.env` (`STORAGE_ROOT`, `DATABASE_URL`, `OPENROUTER_API_KEY`)
   - Run Flask app on `http://localhost:5000`
2. **Frontend**
   - `npm install`
   - `npm run dev`
