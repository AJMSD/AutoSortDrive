import React, { useState, useRef, useEffect } from 'react';
import { logger } from '@/utils/logger';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import './ProfileDropdown.css';

interface User {
  name?: string;
  email?: string;
  picture?: string;
}

interface ProfileDropdownProps {
  user: User;
}

const ProfileDropdown: React.FC<ProfileDropdownProps> = ({ user }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [buttonImageError, setButtonImageError] = useState(false);
  const [dropdownImageError, setDropdownImageError] = useState(false);
  const [buttonRetryCount, setButtonRetryCount] = useState(0);
  const [dropdownRetryCount, setDropdownRetryCount] = useState(0);
  const [buttonImageSrc, setButtonImageSrc] = useState<string | null>(null);
  const [dropdownImageSrc, setDropdownImageSrc] = useState<string | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { logout } = useAuth();

  const MAX_RETRY_COUNT = 2;

  // Initialize theme from localStorage or current document preference
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const documentTheme =
      (document.documentElement.getAttribute('data-theme') as 'light' | 'dark' | null) ||
      (document.body.getAttribute('data-theme') as 'light' | 'dark' | null);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialTheme = savedTheme || documentTheme || (prefersDark ? 'dark' : 'light');
    setTheme(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
    document.body.setAttribute('data-theme', initialTheme);
  }, []);

  // Log when picture URL changes and reset states
  useEffect(() => {
    if (user.picture) {
      logger.debug('🖼️ ProfileDropdown: image load start –', user.picture);
      setButtonImageSrc(user.picture);
      setDropdownImageSrc(user.picture);
    } else {
      logger.debug('🖼️ ProfileDropdown: no picture URL, using fallback');
      setButtonImageSrc(null);
      setDropdownImageSrc(null);
    }
    setButtonImageError(false);
    setDropdownImageError(false);
    setButtonRetryCount(0);
    setDropdownRetryCount(0);
  }, [user.picture]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = () => {
    logout();
    navigate('/');
    setIsOpen(false);
  };

  const handleThemeToggle = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase();
  };

  const handleButtonImageLoad = () => {
    logger.debug('🖼️ ProfileDropdown (button): image loaded OK');
  };

  const handleButtonImageError = () => {
    logger.error('🖼️ ProfileDropdown (button): image error –', {
      src: buttonImageSrc,
      retryCount: buttonRetryCount,
    });

    if (buttonRetryCount < MAX_RETRY_COUNT) {
      const nextRetry = buttonRetryCount + 1;
      logger.debug(`🖼️ ProfileDropdown (button): retrying (attempt ${nextRetry}/${MAX_RETRY_COUNT})`);
      setButtonRetryCount(nextRetry);
      // Trigger retry by briefly clearing and re-setting src
      setButtonImageSrc(null);
      setTimeout(() => {
        setButtonImageSrc(user.picture || null);
      }, 100);
    } else {
      logger.error('🖼️ ProfileDropdown (button): giving up, using fallback');
      setButtonImageError(true);
    }
  };

  const handleDropdownImageLoad = () => {
    logger.debug('🖼️ ProfileDropdown (dropdown): image loaded OK');
  };

  const handleDropdownImageError = () => {
    logger.error('🖼️ ProfileDropdown (dropdown): image error –', {
      src: dropdownImageSrc,
      retryCount: dropdownRetryCount,
    });

    if (dropdownRetryCount < MAX_RETRY_COUNT) {
      const nextRetry = dropdownRetryCount + 1;
      logger.debug(`🖼️ ProfileDropdown (dropdown): retrying (attempt ${nextRetry}/${MAX_RETRY_COUNT})`);
      setDropdownRetryCount(nextRetry);
      // Trigger retry by briefly clearing and re-setting src
      setDropdownImageSrc(null);
      setTimeout(() => {
        setDropdownImageSrc(user.picture || null);
      }, 100);
    } else {
      logger.error('🖼️ ProfileDropdown (dropdown): giving up, using fallback');
      setDropdownImageError(true);
    }
  };

  return (
    <div className="profile-dropdown" ref={dropdownRef}>
      <div className="profile-controls">
        <button
          className="theme-toggle-button"
          onClick={handleThemeToggle}
          type="button"
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          aria-pressed={theme === 'dark'}
          title={theme === 'light' ? 'Dark mode' : 'Light mode'}
        >
          <i className={theme === 'light' ? 'fa-solid fa-moon' : 'fa-solid fa-sun'}></i>
        </button>

        {/* Profile Icon Button */}
        <button
          className="profile-button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Profile menu"
          aria-expanded={isOpen}
          type="button"
        >
          {buttonImageSrc && !buttonImageError ? (
            <img
              key={`${user.picture}-${buttonRetryCount}`}
              src={buttonImageSrc}
              alt={user.name || 'User'}
              className="profile-avatar"
              onLoad={handleButtonImageLoad}
              onError={handleButtonImageError}
            />
          ) : (
            <div className="profile-avatar initials">
              {getInitials(user.name)}
            </div>
          )}
        </button>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="dropdown-menu">
          {/* User Info */}
          <div className="dropdown-header">
            {dropdownImageSrc && !dropdownImageError ? (
              <img
                key={`${user.picture}-${dropdownRetryCount}`}
                src={dropdownImageSrc}
                alt={user.name || 'User'}
                className="dropdown-avatar image"
                onLoad={handleDropdownImageLoad}
                onError={handleDropdownImageError}
              />
            ) : (
              <div className="dropdown-avatar initials">
                {getInitials(user.name)}
              </div>
            )}
            <div className="user-info">
              {user.name && <p className="user-name">{user.name}</p>}
              {user.email && <p className="user-email">{user.email}</p>}
            </div>
          </div>

          <hr className="dropdown-divider" />

          {/* Menu Items */}
          <button
            className="dropdown-item"
            onClick={() => {
              navigate('/rules');
              setIsOpen(false);
            }}
          >
            <span className="dropdown-icon"><i className="fa-solid fa-wand-magic-sparkles"></i></span>
            <span className="dropdown-label">Rules</span>
          </button>

          <button
            className="dropdown-item"
            onClick={() => {
              navigate('/about');
              setIsOpen(false);
            }}
          >
            <span className="dropdown-icon"><i className="fa-solid fa-circle-info"></i></span>
            <span className="dropdown-label">About & Help</span>
          </button>

          <hr className="dropdown-divider" />

          {/* Sign Out */}
          <button className="dropdown-item signout" onClick={handleSignOut}>
            <span className="dropdown-icon"><i className="fa-solid fa-arrow-right-from-bracket"></i></span>
            <span className="dropdown-label">Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default ProfileDropdown;
