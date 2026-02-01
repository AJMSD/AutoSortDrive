import React from 'react';
import './AboutPage.css';

const AboutPage: React.FC = () => {
  return (
    <div className="about-page">
      <div className="about-container">
        <h1 className="page-title">About & Help</h1>

        {/* App Version */}
        <div className="about-card">
          <div className="about-header">
            <span className="about-icon"><i className="fa-solid fa-box"></i></span>
            <h2 className="about-title">AutoSortDrive</h2>
          </div>
          <div className="about-content">
            <div className="version-info">
              <span className="version-label">Version</span>
              <span className="version-number">0.1.0</span>
            </div>
            <p className="about-description">
              Smart Google Drive organization with automated categorization and intuitive file management.
            </p>
          </div>
        </div>

        {/* Quick Start Guide */}
        <div className="help-section">
          <h2 className="section-title">Quick Start Guide</h2>
          <div className="help-steps">
            <div className="help-step">
              <span className="step-number">1</span>
              <div className="step-content">
                <h3 className="step-title">Create Categories</h3>
                <p className="step-description">
                  Go to Categories page and create folders with descriptions to organize your files.
                </p>
              </div>
            </div>
            <div className="help-step">
              <span className="step-number">2</span>
              <div className="step-content">
                <h3 className="step-title">Set Up Rules</h3>
                <p className="step-description">
                  Define auto-categorization rules based on keywords, file types, or owners.
                </p>
              </div>
            </div>
            <div className="help-step">
              <span className="step-number">3</span>
              <div className="step-content">
                <h3 className="step-title">Review & Organize</h3>
                <p className="step-description">
                  Check the Review Queue for suggested categorizations and assign files manually.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* How It Works */}
        <div className="help-section">
          <h2 className="section-title">How AutoSortDrive Works</h2>
          <div className="info-grid">
            <div className="info-card">
              <h3 className="info-title">Inbox & Categories</h3>
              <p className="info-text">
                Inbox lists non-trashed files (excluding folders and shortcuts). Categories can be manual or linked to
                a Drive folder. Folder-backed categories always reflect the folder contents.
              </p>
            </div>
            <div className="info-card">
              <h3 className="info-title">Review Queue</h3>
              <p className="info-text">
                The Review Queue combines stored items (manual or AI suggestions) with rule-based suggestions for
                uncategorized files. Accepting or overriding clears the item and updates your assignments.
                For large Drives, rule-based items may appear after pagination finishes.
              </p>
            </div>
            <div className="info-card">
              <h3 className="info-title">Rules & AI</h3>
              <p className="info-text">
                Rules match on file name, mime type, or owner. AI suggestions can be enabled and used as primary or
                fallback with a confidence threshold you control.
              </p>
            </div>
            <div className="info-card">
              <h3 className="info-title">Folder Auto-Categorize</h3>
              <p className="info-text">
                If you allow folder sync on first login, non-empty Drive folders become categories. The sync runs
                periodically (about every 5 minutes).
              </p>
            </div>
          </div>
        </div>

        {/* Key Behaviors & Gotchas */}
        <div className="help-section">
          <h2 className="section-title">Key Behaviors & Gotchas</h2>
          <ul className="help-list">
            <li>
              <strong>Folder-backed categories</strong> can’t remove files inside the Drive folder from within the app.
              Move files in Drive to remove them from that category.
            </li>
            <li>
              <strong>Review Queue sources:</strong> items can be created manually, by rules, or by AI. The source
              impacts how they’re explained and cleared.
            </li>
            <li>
              <strong>Caching:</strong> data is cached per tab using session storage. If data looks stale, refresh or
              revisit the page to revalidate.
              Optimistic updates apply immediately and roll back on failure.
            </li>
            <li>
              <strong>Rules order:</strong> if multiple rules match, the first match is used for suggestions.
            </li>
            <li>
              <strong>AI vs rules:</strong> you can set AI as primary or fallback. Disabling AI clears AI suggestions
              from the Review Queue.
            </li>
            <li>
              <strong>AI cache:</strong> AI decisions are cached per file and reused until the file or rules change.
              The AI only sees file metadata (name, type), not file contents.
            </li>
            <li>
              <strong>Rule suggestions:</strong> the queue may be based on cached or paginated Drive results, so large
              Drives can take longer to surface all matches.
            </li>
            <li>
              <strong>Shortcuts:</strong> use Ctrl+Tab / Ctrl+Shift+Tab to cycle between main pages.
            </li>
          </ul>
        </div>

        {/* Limits */}
        <div className="help-section">
          <h2 className="section-title">Limits & Performance Notes</h2>
          <ul className="help-list">
            <li>AI auto-assign is limited to 3 files per minute. If the daily quota (500 files) is hit, AI is disabled until the next day.</li>
            <li>Bulk download is capped at 30 files per request; Google Workspace files are exported (PDF, DOCX, etc.).</li>
            <li>Large Drives may require pagination; refresh if you suspect files are missing.</li>
          </ul>
        </div>

        {/* Privacy & Security */}
        <div className="help-section">
          <h2 className="section-title">Privacy & Security</h2>
          <div className="info-grid">
            <div className="info-card">
              <h3 className="info-title">OAuth & Tokens</h3>
              <p className="info-text">
                Tokens are stored in session storage and expire automatically. You’ll see a prompt to refresh your
                session shortly before expiry (about 5 minutes).
              </p>
            </div>
            <div className="info-card">
              <h3 className="info-title">Config Storage</h3>
              <p className="info-text">
                Your configuration lives in your Drive appDataFolder as <code>autosortdrive-config.json</code> and is
                not visible in the Drive UI.
              </p>
            </div>
            <div className="info-card">
              <h3 className="info-title">Scopes</h3>
              <p className="info-text">
                The app requires Google Drive scopes to list, read, and update files. If access is revoked, you’ll need
                to sign in again.
              </p>
            </div>
          </div>
        </div>

        {/* Troubleshooting */}
        <div className="help-section">
          <h2 className="section-title">Troubleshooting</h2>
          <ul className="help-list">
            <li>“Nothing in category” - go to Inbox and refresh to warm the cache.</li>
            <li>“No AI suggestions” - check AI settings and confidence threshold in Rules.</li>
            <li>“Missing files” - Drive pagination may be in progress; refresh the page.</li>
            <li>“Auth errors” - sign out and sign back in to refresh tokens.</li>
          </ul>
        </div>

        {/* Resources */}
        <div className="resources-section">
          <h2 className="section-title">Resources</h2>
          <div className="resource-links">
            <a href="https://github.com/AJMSD/AutoSortDrive/blob/main/README.md" target="_blank" rel="noopener noreferrer" className="resource-link">
              <span className="resource-icon"><i className="fa-solid fa-book"></i></span>
              <div className="resource-info">
                <span className="resource-title">Documentation</span>
                <span className="resource-description">Read the full guide</span>
              </div>
              <span className="external-icon"><i className="fa-solid fa-arrow-up-right-from-square"></i></span>
            </a>
            <a href="https://github.com/AJMSD/AutoSortDrive" target="_blank" rel="noopener noreferrer" className="resource-link">
              <span className="resource-icon"><i className="fa-brands fa-github"></i></span>
              <div className="resource-info">
                <span className="resource-title">GitHub Repository</span>
                <span className="resource-description">View source code</span>
              </div>
              <span className="external-icon"><i className="fa-solid fa-arrow-up-right-from-square"></i></span>
            </a>
            <a href="https://github.com/AJMSD/AutoSortDrive/issues" target="_blank" rel="noopener noreferrer" className="resource-link">
              <span className="resource-icon"><i className="fa-solid fa-bug"></i></span>
              <div className="resource-info">
                <span className="resource-title">Report Issues</span>
                <span className="resource-description">Found a bug?</span>
              </div>
              <span className="external-icon"><i className="fa-solid fa-arrow-up-right-from-square"></i></span>
            </a>
          </div>
        </div>

        {/* Legal */}
        <div className="legal-section">
          <p className="legal-text">
            AutoSortDrive is an independent project and is not affiliated with Google LLC.
            Google Drive is a trademark of Google LLC.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
