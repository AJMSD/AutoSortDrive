import React, { useEffect, useState } from 'react';
import './FirstLoginModal.css';

interface FirstLoginModalProps {
  onClose: (decision: 'accepted' | 'declined') => void;
  onGoToAbout: (decision: 'accepted' | 'declined') => void;
}

const FirstLoginModal: React.FC<FirstLoginModalProps> = ({ onClose, onGoToAbout }) => {
  const [autoCategorizeDecision, setAutoCategorizeDecision] = useState<'accepted' | 'declined' | null>(null);
  const [showDecisionError, setShowDecisionError] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!autoCategorizeDecision) {
          setShowDecisionError(true);
          return;
        }
        onClose(autoCategorizeDecision);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [autoCategorizeDecision, onClose]);

  return (
    <div className="first-login-modal-overlay" onClick={() => {
      if (!autoCategorizeDecision) {
        setShowDecisionError(true);
        return;
      }
      onClose(autoCategorizeDecision);
    }}>
      <div
        className="first-login-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-login-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="first-login-header">
          <span className="first-login-icon">
            <i className="fa-solid fa-star"></i>
          </span>
          <div className="first-login-title-group">
            <h2 id="first-login-title">Welcome to AutoSortDrive</h2>
            <p className="first-login-subtitle">
              Start by reviewing About &amp; Help to understand the flow.
            </p>
          </div>
        </div>

        <div className="first-login-body">
          <div className="first-login-decision">
            <h3>Auto-categorize existing Drive folders?</h3>
            <p>We can scan your personal Drive and shared drives to create categories from folders that contain files.
              Files will appear under those categories. No files are moved or modified.</p>
            <div className="decision-options">
              <label className={`decision-option \${autoCategorizeDecision === 'accepted' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="auto-categorize-folders"
                  value="accepted"
                  checked={autoCategorizeDecision === 'accepted'}
                  onChange={() => {
                    setAutoCategorizeDecision('accepted');
                    setShowDecisionError(false);
                  }}
                />
                <span>Yes, auto-categorize my folders</span>
              </label>
              <label className={`decision-option \${autoCategorizeDecision === 'declined' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="auto-categorize-folders"
                  value="declined"
                  checked={autoCategorizeDecision === 'declined'}
                  onChange={() => {
                    setAutoCategorizeDecision('declined');
                    setShowDecisionError(false);
                  }}
                />
                <span>No, I will create categories manually</span>
              </label>
            </div>
            {showDecisionError && (
              <p className="decision-error">Please choose yes or no to continue.</p>
            )}
          </div>

          <ul className="first-login-list">
            <li>
              <span className="bullet-icon"><i className="fa-solid fa-tags"></i></span>
              Create categories with clear descriptions, keywords, and examples.
            </li>
            <li>
              <span className="bullet-icon"><i className="fa-solid fa-wand-magic-sparkles"></i></span>
              Add rules or enable AI to auto-categorize files.
            </li>
            <li>
              <span className="bullet-icon"><i className="fa-solid fa-clipboard-check"></i></span>
              Review suggestions in the Review Queue.
            </li>
          </ul>

        </div>

        <div className="first-login-actions">
          <button
            className="first-login-btn secondary"
            type="button"
            onClick={() => {
              if (!autoCategorizeDecision) {
                setShowDecisionError(true);
                return;
              }
              onClose(autoCategorizeDecision);
            }}
          >
            Continue
          </button>
          <button
            className="first-login-btn primary"
            type="button"
            onClick={() => {
              if (!autoCategorizeDecision) {
                setShowDecisionError(true);
                return;
              }
              onGoToAbout(autoCategorizeDecision);
            }}
          >
            Go to About &amp; Help
          </button>
        </div>
      </div>
    </div>
  );
};

export default FirstLoginModal;
