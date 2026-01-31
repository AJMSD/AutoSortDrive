import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import MainLayout from '@/components/layout/MainLayout';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import LandingPage from '@/pages/LandingPage';
import WelcomeSetup from '@/pages/WelcomeSetup';
import InboxPage from '@/pages/InboxPage';
import CategoriesPage from '@/pages/CategoriesPage';
import CategoryViewPage from '@/pages/CategoryViewPage';
import ReviewQueuePage from '@/pages/ReviewQueuePage';
import RulesPage from '@/pages/RulesPage';
import AboutPage from '@/pages/AboutPage';
import DiagnosticsPage from '@/pages/DiagnosticsPage';
import './App.css';

// Animated Routes wrapper
const AnimatedRoutes: React.FC = () => {
  const location = useLocation();

  return (
    <div className="page-transition" key={location.pathname}>
      <Routes location={location}>
        {/* Landing/Sign-in page without navbar */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/welcome" element={<WelcomeSetup />} />
        <Route path="/diagnostics" element={<DiagnosticsPage />} />

        {/* Pages with navbar */}
        <Route
          path="/inbox"
          element={
            <ProtectedRoute>
              <MainLayout>
                <InboxPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/categories"
          element={
            <ProtectedRoute>
              <MainLayout>
                <CategoriesPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/categories/:categoryId"
          element={
            <ProtectedRoute>
              <MainLayout>
                <CategoryViewPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/review"
          element={
            <ProtectedRoute>
              <MainLayout>
                <ReviewQueuePage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/rules"
          element={
            <ProtectedRoute>
              <MainLayout>
                <RulesPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/about"
          element={
            <ProtectedRoute>
              <MainLayout>
                <AboutPage />
              </MainLayout>
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<div>404 - Page Not Found</div>} />
      </Routes>
    </div>
  );
};

const App: React.FC = () => {
  // Initialize theme from localStorage or system preference
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia(
      '(prefers-color-scheme: dark)'
    ).matches;

    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
  }, []);

  return (
    <Router>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--color-toast-bg)',
            color: 'var(--color-toast-text)',
            border: '1px solid var(--color-toast-border)',
            borderRadius: 'var(--radius-md)',
            padding: '1rem',
            fontSize: '0.9375rem',
            boxShadow: 'var(--color-toast-shadow)',
          },
          success: {
            iconTheme: {
              primary: 'var(--color-status-success)',
              secondary: 'white',
            },
          },
          error: {
            iconTheme: {
              primary: 'var(--color-status-error)',
              secondary: 'white',
            },
          },
        }}
      />
      <AnimatedRoutes />
    </Router>
  );
};

export default App;
