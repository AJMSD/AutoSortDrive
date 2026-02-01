/**
 * Authentication Hook - Google OAuth 2.0 Integration
 * 
 * ==================================================================================
 * GOOGLE CLOUD CONSOLE CONFIGURATION CHECKLIST
 * ==================================================================================
 * 
 * Before OAuth will work, you MUST configure these in Google Cloud Console:
 * https://console.cloud.google.com/apis/credentials
 * 
 * 1. CREATE OAuth 2.0 Client ID:
 *    - Application type: "Web application"
 *    - Name: "AutoSortDrive" (or any name)
 * 
 * 2. AUTHORIZED JAVASCRIPT ORIGINS (Required for redirect mode):
 *    Add these exact URIs:
 *    - http://localhost:5173              (for local development)
 *    - https://yourdomain.com             (for production deployment)
 *    - https://your-app.vercel.app        (if deploying to Vercel)
 *    
 *    ⚠️ Common Mistakes:
 *    - DO NOT include trailing slashes
 *    - DO NOT include paths (e.g., /callback)
 *    - Match the EXACT origin (http vs https, port number)
 *    - Missing localhost:5173 = "origin_mismatch" errors locally
 * 
 * 3. AUTHORIZED REDIRECT URIs (not needed for popup mode):
 *    Not required - we're using popup mode
 *    Only needed if you switch to redirect mode later
 * 
 * 4. COPY CLIENT ID to .env:
 *    VITE_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID_HERE.apps.googleusercontent.com
 * 
 * 5. ENABLE APIs in Google Cloud Console:
 *    - Google Drive API
 *    - Google People API (for profile/email)
 * 
 * ==================================================================================
 * COMMON OAUTH ERRORS & SOLUTIONS
 * ==================================================================================
 * 
 * Error: "origin_mismatch"
 *   → Current origin not in "Authorized JavaScript origins"
 *   → Solution: Add exact origin to Google Cloud Console (including http/https and port)
 * 
 * Error: "redirect_uri_mismatch"
 *   → Not relevant for popup mode (ux_mode: 'popup')
 *   → Only matters if using ux_mode: 'redirect'
 * 
 * Error: "invalid_client"
 *   → VITE_GOOGLE_CLIENT_ID is incorrect or from wrong project
 *   → Solution: Verify client ID in Google Cloud Console
 * 
 * Error: "popup_closed_by_user"
 *   → User closed popup without completing sign-in
 *   → Solution: Normal user behavior, no action needed
 * 
 * Error: "popup_failed_to_open"
 *   → Browser blocked popup
 *   → Solution: Allow popups for this site in browser settings
 * 
 * Error: "access_denied"
 *   → User denied permissions
 *   → Solution: Normal user behavior, no action needed
 * 
 * Google Identity Services not loading:
 *   → Check browser Network tab for https://accounts.google.com/gsi/client
 *   → Ad blocker may be blocking the script
 *   → Check browser console for "Google Identity Services loaded successfully"
 * 
 * ==================================================================================
 * OAUTH FLOW (Redirect Mode)
 * ==================================================================================
 * 
 * 1. User clicks "Sign In with Google"
 * 2. initTokenPopup Mode - Direct Drive API Access)
 * ==================================================================================
 * 
 * 1. User clicks "Sign In with Google"
 * 2. initTokenClient() creates OAuth client with client_id and scopes
 * 3. requestAccessToken() opens popup to accounts.google.com
 * 4. User signs in and grants permissions
 * 5. Popup closes, callback receives access_token
 * 6. Frontend uses token to call Drive API directly (list files, manage config)
 * 7. Config stored in user's Drive appDataFolder (isolated per user)
 * 8. We fetch user info from Google using access_token
 * 9. Store user + token in localStorage
 * 10. Redirect to /inbox
 * 
 * Token expiration is handled automatically by useEffect (logs out when expired)
 * 
 * NO Apps Script needed for Drive operations - all done via Google Drive API v3====
 * 
 * All OAuth events are logged to console with emoji prefixes:
 *   🔐 = OAuth flow started
 *   ✅ = Success
 *   ❌ = Error
 *   ⚠️ = Warning
 *   🌐 = Origin/network info
 *   ⏰ = Token expiration
 * 
 * Check console for detailed error messages with explanations.
 * 
 * ==================================================================================
 */

import React, { useState, useCallback, useEffect } from 'react';
import { config } from '@/lib/config';
import { unifiedClient } from '@/lib/unifiedClient';
import { userCache } from '@/utils/userCache';
import { authStorage } from '@/utils/authStorage';
import { logger } from '@/utils/logger';

interface User {
  name: string;
  email: string;
  picture: string;
  accessToken: string;
  expiresAt: number;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<{ success: boolean; error?: string }>;
}

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

/**
 * Validate OAuth configuration before attempting authentication
 * Helps catch common configuration errors early
 */
const validateOAuthConfig = (): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  // Check client_id format (should end with .apps.googleusercontent.com)
  if (!config.google.clientId) {
    errors.push('❌ VITE_GOOGLE_CLIENT_ID is missing');
  } else if (!config.google.clientId.includes('.apps.googleusercontent.com')) {
    errors.push('⚠️ VITE_GOOGLE_CLIENT_ID does not match expected format (should end with .apps.googleusercontent.com)');
  }

  // Check for placeholder values
  if (config.google.clientId === 'your_google_client_id_here') {
    errors.push('❌ VITE_GOOGLE_CLIENT_ID is still set to placeholder value');
  }

  return { valid: errors.length === 0, errors };
};

export const useAuth = (): AuthContextType => {
  const [user, setUser] = useState<User | null>(() => {
    const stored = authStorage.getStoredUser();
    if (stored) {
      if (stored.expiresAt && stored.expiresAt > Date.now()) {
        return stored as User;
      }
      authStorage.clearStoredUser();
    }
    return null;
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const refreshPromptShownRef = React.useRef(false);

  const login = useCallback(async () => {
    
    // Validate configuration before attempting OAuth
    const validation = validateOAuthConfig();
    if (!validation.valid) {
      logger.error('❌ OAuth Configuration Errors:');
      validation.errors.forEach(err => logger.error('  ', err));
      alert('OAuth configuration error. Check console for details.');
      return;
    }

    setIsLoading(true);
    
    try {
      // Wait for Google API to load
      if (!window.google) {
        logger.warn('⏳ Google Identity Services library not loaded yet, waiting...');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (!window.google) {
        const errorMsg = 'Google Identity Services library failed to load. Check if https://accounts.google.com/gsi/client is blocked.';
        logger.error('❌', errorMsg);
        throw new Error(errorMsg);
      }

      // Define scopes for Drive API access
      const scopes = [
        'https://www.googleapis.com/auth/drive.readonly',  // Read file metadata
        'https://www.googleapis.com/auth/drive.file',      // Create/modify app files
        'https://www.googleapis.com/auth/drive.appdata',   // App-specific data folder
        'openid',                                          // OpenID Connect
        'profile',                                         // User profile info
        'email',                                           // User email
      ].join(' ');


      // Use OAuth2 Token Client for Drive API access with POPUP mode
      // We're calling Drive API directly, so no CORS issues with Apps Script
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: config.google.clientId,
        scope: scopes,
        // ux_mode: 'popup' is default - perfect for calling Google APIs directly
        callback: async (response: GoogleTokenResponse) => {
          
          // Check for errors in response
          if (response.error) {
            logger.error('❌ OAuth Error Response:', {
              error: response.error,
              description: response.error_description,
              fullResponse: response,
            });
            alert(`OAuth Error: ${response.error}\n${response.error_description || 'See console for details'}`);
            setIsLoading(false);
            return;
          }

          if (response.access_token) {
            const expiresInSeconds =
              typeof response.expires_in === 'number' && response.expires_in > 0
                ? response.expires_in
                : 3600;
            
            // Get user info from Google
            try {
              const userInfoResponse = await fetch(
                'https://www.googleapis.com/oauth2/v2/userinfo',
                {
                  headers: {
                    Authorization: `Bearer ${response.access_token}`,
                  },
                }
              );
              
              if (!userInfoResponse.ok) {
                throw new Error(`Failed to fetch user info: ${userInfoResponse.status} ${userInfoResponse.statusText}`);
              }
              
              const userInfo = await userInfoResponse.json();
              
              const userData: User = {
                name: userInfo.name,
                email: userInfo.email,
                picture: userInfo.picture,
                accessToken: response.access_token,
                expiresAt: Date.now() + (expiresInSeconds * 1000),
              };
              
              setUser(userData);
              authStorage.setStoredUser(userData);
              
            } catch (error: any) {
              logger.error('❌ Failed to fetch user info:', {
                error: error.message,
                stack: error.stack,
                response: error.response,
              });
              alert('Failed to fetch user information. See console for details.');
            } finally {
              setIsLoading(false);
            }
          } else {
            logger.error('❌ No access token in response:', response);
            setIsLoading(false);
          }
        },
        error_callback: (error: any) => {
          // Enhanced error logging for debugging OAuth failures
          logger.error('❌ OAuth Error Callback Triggered');
          logger.error('   Error object:', error);
          logger.error('   Error type:', typeof error);
          
          // Log all error properties
          if (error && typeof error === 'object') {
            logger.error('   Error details:', {
              type: error.type,
              error: error.error,
              message: error.message,
              details: error.details,
              ...error, // Log any additional properties
            });

            // Common OAuth error types and their meanings:
            const errorMessages: Record<string, string> = {
              'popup_closed_by_user': '🚫 User closed the popup without completing sign-in',
              'access_denied': '🚫 User denied permission to access their Google account',
              'popup_failed_to_open': '🚫 Popup was blocked by browser. Please allow popups for this site.',
              'invalid_client': '❌ Invalid client_id. Check VITE_GOOGLE_CLIENT_ID in .env',
              'invalid_scope': '❌ Invalid OAuth scope requested. Check scope configuration.',
              'redirect_uri_mismatch': '❌ Redirect URI mismatch. Check "Authorized redirect URIs" in Google Cloud Console.',
              'origin_mismatch': `❌ Origin mismatch. Current origin (${window.location.origin}) is not in "Authorized JavaScript origins".`,
              'unauthorized_client': '❌ Client not authorized for this OAuth flow. Check OAuth client type in Google Cloud Console.',
            };

            const errorType = error.type || error.error || 'unknown';
            const explanation = errorMessages[errorType] || '❌ Unknown OAuth error';
            logger.error('   Explanation:', explanation);
            
            // Show user-friendly error
            alert(`OAuth Error: ${explanation}\n\nSee console for technical details.`);
          } else {
            logger.error('   Raw error:', error);
          }
          
          setIsLoading(false);
        },
      });

      // Request access token (this will show the consent popup)
      client.requestAccessToken();
      // Popup mode works perfectly for calling Google APIs directly
      
    } catch (error: any) {
      logger.error('❌ Login failed:', {
        message: error.message,
        stack: error.stack,
        error,
      });
      alert(`Login failed: ${error.message}\n\nSee console for details.`);
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    
    // Clear config cache
    unifiedClient.clearCache();
    
    // Clear all cached data (files, categories, etc.)
    userCache.clearAllCache();
    
    setUser(null);
    authStorage.clearStoredUser();
  }, []);

  // Refresh access token
  const refreshToken = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    
    if (!window.google) {
      logger.error('Google Identity Services not available');
      return { success: false, error: 'Google Identity Services not available' };
    }

    try {
      const scopes = [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file',
        'https://www.googleapis.com/auth/drive.appdata',
        'openid',
        'profile',
        'email',
      ].join(' ');

      const refreshResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: config.google.clientId,
          scope: scopes,
          hint: user?.email,
          callback: async (response: GoogleTokenResponse) => {
            if (response.error) {
              logger.error('Token refresh failed:', response.error);
              resolve({ success: false, error: response.error_description || response.error });
              return;
            }

            if (response.access_token && user) {
              const expiresInSeconds =
                typeof response.expires_in === 'number' && response.expires_in > 0
                  ? response.expires_in
                  : 3600;
              
              const updatedUser: User = {
                ...user,
                accessToken: response.access_token,
                expiresAt: Date.now() + (expiresInSeconds * 1000),
              };
              
              setUser(updatedUser);
              authStorage.setStoredUser(updatedUser);
              resolve({ success: true });
              return;
            }

            resolve({ success: false, error: 'No access token returned' });
          },
          error_callback: (error: any) => {
            logger.error('Token refresh error callback:', error);
            resolve({
              success: false,
              error: error?.message || error?.error || 'Token refresh failed',
            });
          },
        });

        client.requestAccessToken({ prompt: 'none' }); // prompt: 'none' = silent refresh
      });

      return refreshResult;
    } catch (error) {
      logger.error('Failed to refresh token:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to refresh token' };
    }
  }, [user]);

  // Check token expiration and show warning
  useEffect(() => {
    let expiryTimeout: ReturnType<typeof setTimeout> | undefined;
    let warningTimeout: ReturnType<typeof setTimeout> | undefined;
    let warningToastId: string | undefined;
    const refreshPromptKey = 'autosortdrive_refresh_prompt_shown';

    if (user && user.expiresAt) {
      const timeUntilExpiry = user.expiresAt - Date.now();
      const WARNING_TIME = 5 * 60 * 1000; // Warn 5 minutes before expiry

      if (timeUntilExpiry <= 0) {
        logger.warn('⏰ Access token expired, logging out');
        logout();
      } else {
        const showWarningToast = (minutesLeft: number) => {
          if (refreshPromptShownRef.current) {
            return;
          }
          if (sessionStorage.getItem(refreshPromptKey)) {
            refreshPromptShownRef.current = true;
            return;
          }
          refreshPromptShownRef.current = true;
          sessionStorage.setItem(refreshPromptKey, '1');

          import('react-hot-toast').then(({ default: toast }) => {
            warningToastId = toast.custom(
              (t) => {
                return React.createElement(
                  'div',
                  { className: 'toast-panel toast-content' },
                  React.createElement('div', { className: 'toast-title' }, 'Session Expiring Soon'),
                  React.createElement(
                    'div',
                    { className: 'toast-subtext' },
                    `Your session will expire in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}.`,
                  ),
                  React.createElement(
                    'div',
                    { className: 'toast-actions' },
                    React.createElement(
                      'button',
                      {
                        className: 'toast-button primary',
                        onClick: async () => {
                          toast.dismiss(t.id);
                          const result = await refreshToken();
                          if (result.success) {
                            toast.success('Session refreshed!');
                          } else {
                            toast.error(result.error || 'Failed to refresh session');
                          }
                        },
                      },
                      'Refresh Session'
                    ),
                    React.createElement(
                      'button',
                      {
                        className: 'toast-button secondary',
                        onClick: () => {
                          toast.dismiss(t.id);
                        },
                      },
                      'Dismiss'
                    )
                  )
                );
              },
              {
                duration: Infinity,
                position: 'top-center',
              }
            );
          });
        };

        // Show warning if expiry is soon
        if (timeUntilExpiry <= WARNING_TIME) {
          const minutesLeft = Math.floor(timeUntilExpiry / 60000);
          showWarningToast(minutesLeft);
        } else {
          // Schedule warning for later
          warningTimeout = setTimeout(() => {
            showWarningToast(5);
          }, timeUntilExpiry - WARNING_TIME);
        }

        // Auto logout when token expires
        expiryTimeout = setTimeout(() => {
          logger.warn('⏰ Access token expired, logging out');
          
          // Dismiss warning toast if still showing
          if (warningToastId) {
            import('react-hot-toast').then(({ default: toast }) => {
              toast.dismiss(warningToastId);
              toast.error('Session expired. Please sign in again.');
            });
          }
          
          logout();
        }, timeUntilExpiry);
      }
    }

    return () => {
      if (expiryTimeout) {
        clearTimeout(expiryTimeout);
      }
      if (warningTimeout) {
        clearTimeout(warningTimeout);
      }
      if (warningToastId) {
        import('react-hot-toast').then(({ default: toast }) => {
          toast.dismiss(warningToastId);
        });
      }
    };
  }, [user?.expiresAt, user?.accessToken, logout, refreshToken]); // Reset timer on new login

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    refreshToken,
  };
};
