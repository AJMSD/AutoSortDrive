import React, { useEffect } from 'react';
import { logger } from '@/utils/logger';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      logger.debug('🔒 Protected route accessed without authentication, redirecting to landing page');
    }
  }, [isAuthenticated, isLoading]);

  // While checking authentication, show nothing (or you could show a loading spinner)
  if (isLoading) {
    return null;
  }

  // If not authenticated, redirect to landing page
  // Save the attempted location so we can redirect back after login
  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  // User is authenticated, render the protected content
  return <>{children}</>;
};

export default ProtectedRoute;