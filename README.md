# AutoSortDrive

AutoSortDrive is a React + TypeScript web app for organizing Google Drive with categories, rules, and optional AI suggestions. It connects to a user’s Drive via OAuth, stores configuration in the user’s Drive appDataFolder, and provides fast workflows for sorting, reviewing, and bulk operations.

## Table of Contents
- [Features](#features)
- [Architecture & Data Flow](#architecture--data-flow)
- [APIs & Services](#apis--services)
- [OAuth Scopes](#oauth-scopes)
- [Configuration](#configuration)
- [Apps Script Backend](#apps-script-backend)
- [AI Categorization](#ai-categorization)
- [Caching & Consistency](#caching--consistency)
- [Review Queue](#review-queue)
- [File Preview & Bulk Download](#file-preview--bulk-download)
- [Local Development](#local-development)
- [Deployment (Vercel)](#deployment-vercel)
- [Troubleshooting](#troubleshooting)
- [Acknowledgements](#acknowledgements)
- [License](#license)

## Features
- Inbox view with search, filters, pagination, and bulk actions
- Category management (manual categories or folder-backed categories)
- Rule engine for auto-categorization (name, mime type, owner)
- Review Queue that combines stored suggestions and rule-based suggestions
- Optional AI categorization with confidence thresholds
- File preview for Google Workspace files, PDFs, images, and text
- Bulk download (ZIP) with export formats for Google Workspace files
- Session-based caching for performance and cross-page sync
- Light/Dark theme support

## Architecture & Data Flow
1. **OAuth (Google Identity Services)** is used to obtain an access token.
2. **Drive API v3** is called directly from the client using the OAuth token.
3. **Config file** is stored in the user’s Drive appDataFolder as `autosortdrive-config.json`.
4. **Unified client** (`src/lib/unifiedClient.ts`) merges Drive files with config (categories, rules, assignments).
5. **Caches** live in `sessionStorage` per-tab to avoid stale cross-user data.
6. **Review Queue** combines stored config entries and rule-based suggestions.

## APIs & Services
AutoSortDrive uses:
- **Google Drive API v3** (file listing, metadata, appDataFolder config)
- **Google Identity Services (GIS)** for OAuth
- **Apps Script Web App** (optional, for AI proxy)
- **Gemini API** (via Apps Script or serverless proxy)
- **Vercel** for hosting

## OAuth Scopes
The app requests these scopes (see `src/hooks/useAuth.ts`):
- `https://www.googleapis.com/auth/drive.readonly`
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/drive.appdata`
- `openid`
- `profile`
- `email`

## Configuration
Create a `.env` file at the project root (Vite format):

```
VITE_GOOGLE_CLIENT_ID=your_google_client_id
VITE_GOOGLE_API_KEY=your_google_api_key
VITE_APPS_SCRIPT_DEPLOY_URL=your_apps_script_web_app_url
VITE_API_BASE_URL=
VITE_API_TIMEOUT=30000
VITE_ENABLE_AI_FEATURES=true
VITE_ENABLE_DEBUG_MODE=false
VITE_ENV=development
VITE_GEMINI_MODEL=gemma-3n-e4b-it
```

Notes:
- `VITE_APPS_SCRIPT_DEPLOY_URL` is the deployed Apps Script URL.
- `VITE_ENABLE_AI_FEATURES` toggles AI suggestions.
- `VITE_GEMINI_MODEL` is optional; defaults are handled in code.

## Apps Script Backend
The Apps Script backend is optional but required for the AI proxy endpoint.

### Step-by-step
1) Create a new Apps Script project.
2) Copy `backend/Code.gs` into the Apps Script editor.
3) Deploy as a Web App:
   - Execute as: **Me**
   - Who has access: **Anyone** (or anyone with link)
4) Copy the deployment URL into `VITE_APPS_SCRIPT_DEPLOY_URL`.
5) Add script properties:
   - `GEMINI_API_KEY` (your Gemini API key)

## AI Categorization
AI is optional and can run via:
- **Vercel serverless route** (`/api/ai-categorize`) if you’ve deployed it, or
- **Apps Script** endpoint `?path=ai-categorize`

The prompt uses:
- Category descriptions, keywords, and examples
- Recent user corrections
- Strict guidance to avoid categories with “exclusion” descriptions

## Caching & Consistency
- Caches are stored in `sessionStorage` per tab for privacy and performance.
- Key caches:
  - `inbox_all_files`
  - `review_queue`
  - `categories`
  - `category_files_{id}`
- Config changes invalidate review queue and related caches.

## Review Queue
The Review Queue combines:
- Stored suggestions from config
- Rule-based suggestions for uncategorized files

Items are marked in Inbox as **In Review** when:
- They are in the stored review queue, or
- They match rules and are uncategorized

## File Preview & Bulk Download
- Preview supports Google Docs/Sheets/Slides via embedded preview URLs.
- PDFs and images are displayed using authenticated Drive download URLs.
- Bulk download (ZIP) supports up to 30 files per batch.
- Google Workspace files are exported (PDF, DOCX, etc.).

## Local Development
```
npm install
npm run dev
```

## Deployment (Vercel)
1) Set Vercel **Framework Preset** to **Vite**
2) Build command: `npm run build`
3) Output directory: `dist`
4) Ensure `vercel.json` exists for SPA routing:

```
{
  "rewrites": [
    { "source": "/:path*", "destination": "/index.html" }
  ]
}
```

## Troubleshooting
- **OAuth errors**: check authorized origins in Google Cloud Console.
- **CORS errors**: ensure Apps Script is deployed as a Web App and accessible.
- **Empty Review Queue**: force refresh or clear sessionStorage.
- **Missing files**: large drives may require pagination; refresh the Inbox.

## Acknowledgements
- Google Drive API v3
- Google Identity Services
- Google Apps Script
- Gemini API
- React, Vite, TypeScript
- react-hot-toast, axios, jszip
- Font Awesome (icons)

## License
MIT License. See `LICENSE`.
