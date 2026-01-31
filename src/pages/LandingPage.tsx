import React, { useEffect } from 'react';
import { logger } from '@/utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import './LandingPage.css';

const LandingPage: React.FC = () => {
  const { isLoading, isAuthenticated, login } = useAuth();
  const navigate = useNavigate();

  // Check if Google Identity Services is loaded
  useEffect(() => {
    const checkGoogleAPI = () => {
      if (window.google) {
        logger.debug('✅ Google Identity Services loaded successfully');
        logger.debug('   Available APIs:', Object.keys(window.google.accounts));
      } else {
        logger.warn('⚠️ Google Identity Services not yet loaded');
        logger.debug('   Script should be loading from: https://accounts.google.com/gsi/client');
        logger.debug('   Check browser DevTools Network tab for loading issues');
      }
    };

    // Check immediately
    checkGoogleAPI();

    // Also check after a delay to catch late loading
    const timer = setTimeout(checkGoogleAPI, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      logger.debug('✅ User is authenticated, redirecting to /inbox');
      navigate('/inbox');
    }
  }, [isAuthenticated, navigate]);

  const handleGoogleSignIn = async () => {
    logger.debug('🖱️ Sign In button clicked');
    await login();
    // After successful login, useEffect will redirect
  };

  return (
    <div className="landing-page">
      <div className="landing-container">
        {/* Logo & Title */}
        <div className="landing-header">
          <div className="landing-logo">📂</div>
          <h1 className="landing-title">AutoSortDrive</h1>
          <p className="landing-subtitle">
            A smarter way to organize your Google Drive
          </p>
        </div>

        {/* Features */}
        <div className="landing-features">
          <div className="feature-item">
            <span className="feature-icon"><i className="fa-solid fa-tags"></i></span>
            <span className="feature-text">Smart categorization</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"><i className="fa-solid fa-magnifying-glass"></i></span>
            <span className="feature-text">Powerful search & filters</span>
          </div>
          <div className="feature-item">
            <span className="feature-icon"><i className="fa-solid fa-bolt"></i></span>
            <span className="feature-text">Quick organization</span>
          </div>
        </div>

        {/* Sign In Button */}
        <div className="landing-action">
          <button
            className="google-signin-btn"
            onClick={handleGoogleSignIn}
            disabled={isLoading}
          >
            {isLoading ? (
              <div className="spinner" />
            ) : (
              <>
                <span>Continue with </span>
                <svg className="google-icon" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              </>
            )}
          </button>
          <p className="landing-disclaimer">
            Secure OAuth 2.0 authentication
          </p>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;