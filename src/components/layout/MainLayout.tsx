import React, { useEffect, useRef, useState } from 'react';
import { logger } from '@/utils/logger';
import { useNavigate, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import FirstLoginModal from '@/components/common/FirstLoginModal';
import { appsScriptClient } from '@/lib/appsScriptClient';
import './MainLayout.css';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const onboardingChecked = useRef(false);
  const [showFirstLoginModal, setShowFirstLoginModal] = useState(false);

  // Keyboard navigation: Ctrl+Tab to cycle through pages
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Tab or Ctrl+Shift+Tab
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault(); // Prevent browser tab switching

        const pages = ['/inbox', '/categories', '/review', '/about'];
        const currentIndex = pages.indexOf(location.pathname);
        
        if (currentIndex === -1) return; // Not on a main page

        let nextIndex;
        if (e.shiftKey) {
          // Ctrl+Shift+Tab: Go backwards
          nextIndex = currentIndex === 0 ? pages.length - 1 : currentIndex - 1;
        } else {
          // Ctrl+Tab: Go forwards
          nextIndex = currentIndex === pages.length - 1 ? 0 : currentIndex + 1;
        }

        navigate(pages[nextIndex]);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate, location.pathname]);

  useEffect(() => {
    if (onboardingChecked.current) return;
    onboardingChecked.current = true;

    const loadOnboardingState = async () => {
      const response = await appsScriptClient.getOnboardingState();
      if (response?.success && response.onboarding?.showFirstLoginModal) {
        setShowFirstLoginModal(true);
      }
    };

    loadOnboardingState().catch((error) => {
      logger.warn('Failed to load onboarding state:', error);
    });
  }, []);

  const persistOnboardingDismissal = async (decision: 'accepted' | 'declined') => {
    await appsScriptClient.updateOnboardingState({
      autoCategorizeFoldersDecision: decision,
      showFirstLoginModal: false,
      dismissedAt: new Date().toISOString(),
    });
  };

  const handleOnboardingClose = async (decision: 'accepted' | 'declined') => {
    setShowFirstLoginModal(false);
    try {
      await persistOnboardingDismissal(decision);
    } catch (error) {
      logger.warn('Failed to persist onboarding dismissal:', error);
    }
  };

  const handleOnboardingAbout = async (decision: 'accepted' | 'declined') => {
    setShowFirstLoginModal(false);
    try {
      await persistOnboardingDismissal(decision);
    } catch (error) {
      logger.warn('Failed to persist onboarding dismissal:', error);
    }
    navigate('/about');
  };

  return (
    <div className="main-layout">
      <Navbar />
      <main className="main-content">
        <div className="content-wrapper">
          {children}
        </div>
      </main>
      {showFirstLoginModal && (
        <FirstLoginModal
          onClose={handleOnboardingClose}
          onGoToAbout={handleOnboardingAbout}
        />
      )}
    </div>
  );
};

export default MainLayout;
