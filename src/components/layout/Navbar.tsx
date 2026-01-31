import React, { useState } from 'react';
import { logger } from '@/utils/logger';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import ProfileDropdown from '@/components/common/ProfileDropdown';
import './Navbar.css';

const Navbar: React.FC = () => {
  const location = useLocation();
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Debug logging
  React.useEffect(() => {
    if (user) {
      logger.debug('👤 Navbar: User loaded', { 
        name: user.name, 
        email: user.email,
        hasPicture: !!user.picture 
      });
    } else {
      logger.debug('👤 Navbar: No user');
    }
  }, [user]);

  const navItems = [
    { label: 'Inbox', path: '/inbox' },
    { label: 'Categories', path: '/categories' },
    { label: 'Review', path: '/review' },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="navbar">
      <div className="navbar-container">
        {/* Logo */}
        <Link to="/inbox" className="navbar-logo">
          <span className="navbar-logo-box">AutoSortDrive</span>
        </Link>

        {/* Desktop Navigation Menu */}
        <div className="navbar-menu desktop">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-link ${isActive(item.path) ? 'active' : ''}`}
            >
              <span className="nav-label">{item.label}</span>
              {isActive(item.path) && <div className="active-underline" />}
            </Link>
          ))}
        </div>

        {/* Right Side - Profile & Mobile Menu */}
        <div className="navbar-right">
          {user ? (
            <ProfileDropdown user={user} />
          ) : (
            <Link to="/" className="navbar-signin-btn">
              Sign In
            </Link>
          )}

          {/* Mobile Menu Toggle */}
          <button
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <span className={`hamburger ${mobileMenuOpen ? 'active' : ''}`}>
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      {mobileMenuOpen && (
        <div className="navbar-menu mobile">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`mobile-nav-link ${isActive(item.path) ? 'active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <span className="mobile-nav-label">{item.label}</span>
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
};

export default Navbar;