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

        {/* Resources */}
        <div className="resources-section">
          <h2 className="section-title">Resources</h2>
          <div className="resource-links">
            <a href="https://github.com/yourusername/autosortdrive" target="_blank" rel="noopener noreferrer" className="resource-link">
              <span className="resource-icon"><i className="fa-solid fa-book"></i></span>
              <div className="resource-info">
                <span className="resource-title">Documentation</span>
                <span className="resource-description">Read the full guide</span>
              </div>
              <span className="external-icon"><i className="fa-solid fa-arrow-up-right-from-square"></i></span>
            </a>
            <a href="https://github.com/yourusername/autosortdrive" target="_blank" rel="noopener noreferrer" className="resource-link">
              <span className="resource-icon"><i className="fa-brands fa-github"></i></span>
              <div className="resource-info">
                <span className="resource-title">GitHub Repository</span>
                <span className="resource-description">View source code</span>
              </div>
              <span className="external-icon"><i className="fa-solid fa-arrow-up-right-from-square"></i></span>
            </a>
            <a href="https://github.com/yourusername/autosortdrive/issues" target="_blank" rel="noopener noreferrer" className="resource-link">
              <span className="resource-icon"><i className="fa-solid fa-bug"></i></span>
              <div className="resource-info">
                <span className="resource-title">Report Issues</span>
                <span className="resource-description">Found a bug?</span>
              </div>
              <span className="external-icon"><i className="fa-solid fa-arrow-up-right-from-square"></i></span>
            </a>
            <a href="mailto:support@autosortdrive.com" className="resource-link">
              <span className="resource-icon"><i className="fa-solid fa-envelope"></i></span>
              <div className="resource-info">
                <span className="resource-title">Contact Support</span>
                <span className="resource-description">Get help</span>
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
          <div className="legal-links">
            <a href="#" className="legal-link">Privacy Policy</a>
            <span className="legal-separator">•</span>
            <a href="#" className="legal-link">Terms of Service</a>
            <span className="legal-separator">•</span>
            <a href="#" className="legal-link">License</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutPage;
