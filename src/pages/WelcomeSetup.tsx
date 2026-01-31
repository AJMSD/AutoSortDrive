import React from 'react';
import { useNavigate } from 'react-router-dom';
import './WelcomeSetup.css';

const WelcomeSetup: React.FC = () => {
  const navigate = useNavigate();

  const handleAction = (path: string) => {
    navigate(path);
  };

  return (
    <div className="welcome-setup">
      <div className="welcome-container">
        {/* Welcome Message */}
        <div className="welcome-message">
          <div className="welcome-icon"><i className="fa-solid fa-star"></i></div>
          <h2 className="welcome-title">Welcome to AutoSortDrive!</h2>
          <p className="welcome-text">
            Your Drive is connected and ready to organize. Let's get started.
          </p>
        </div>

        {/* Quick Actions */}
        <div className="welcome-actions">
          <button
            className="action-btn primary"
            onClick={() => handleAction('/inbox')}
          >
            <span className="btn-icon"><i className="fa-solid fa-folder"></i></span>
            <span className="btn-text">Start Browsing Files</span>
          </button>

          <button
            className="action-btn secondary"
            onClick={() => handleAction('/categories')}
          >
            <span className="btn-icon"><i className="fa-solid fa-tag"></i></span>
            <span className="btn-text">Create Your First Category</span>
          </button>

          <button
            className="action-btn tertiary"
            onClick={() => handleAction('/about')}
          >
            <span className="btn-icon"><i className="fa-solid fa-book"></i></span>
            <span className="btn-text">View About & Help</span>
          </button>
        </div>

        {/* Skip Button */}
        <button
          className="skip-btn"
          onClick={() => handleAction('/inbox')}
        >
          Skip and explore on my own
        </button>
      </div>
    </div>
  );
};

export default WelcomeSetup;
