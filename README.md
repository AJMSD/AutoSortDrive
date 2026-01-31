# AutoSortDrive

AutoSortDrive is a React + TypeScript web app that helps you organize Google Drive with categories, rules, and optional AI suggestions. It connects to your Drive using OAuth, stores your configuration in your Drive appDataFolder, and provides a fast Inbox/Review workflow for sorting files.

## Highlights
- Inbox view with filters, search, and bulk actions
- Categories (manual or folder-backed) with per-category views
- Rules engine for auto-categorization
- Review Queue for rule/AI suggestions
- Optional AI-assisted categorization via serverless/Apps Script

## Tech
- React + TypeScript + Vite
- Google Drive API v3
- OAuth via Google Identity Services
- Drive appDataFolder config storage

## Running locally
1) Install dependencies: `npm install`
2) Create `.env` with your OAuth and API values
3) Start dev server: `npm run dev`

## Notes
- Config is stored as `autosortdrive-config.json` in the user’s Drive appDataFolder.
- Production deployments should keep secrets off the client.
