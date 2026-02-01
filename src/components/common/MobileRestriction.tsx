import React, { useEffect, useState } from 'react';
import './MobileRestriction.css';

// Wrapper that blocks the UI on small screens and shows a desktop-only message.
const MobileRestriction: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isMobileOrTablet, setIsMobileOrTablet] = useState(false);

  useEffect(() => {
    const checkDevice = () => {
      // Check if viewport width is less than 1024px (typical laptop minimum)
      const width = window.innerWidth;
      setIsMobileOrTablet(width < 1024);
    };

    // Check on mount
    checkDevice();

    // Check on resize
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  if (isMobileOrTablet) {
    return (
      <div className="mobile-restriction">
        <div className="mobile-restriction-container">
          <div className="mobile-restriction-icon">💻</div>
          <h1 className="mobile-restriction-title">Desktop Experience Required</h1>
          <p className="mobile-restriction-message">
            AutoSortDrive is optimized for laptop and desktop devices to provide the best
            file management experience.
          </p>
          <div className="mobile-restriction-divider"></div>
          <p className="mobile-restriction-secondary">
            We're working hard to bring AutoSortDrive to mobile and tablet devices.
            For now, please access this app from your laptop or desktop computer.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default MobileRestriction;
