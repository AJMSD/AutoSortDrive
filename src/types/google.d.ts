/**
 * TypeScript definitions for Google Identity Services
 * Documentation: https://developers.google.com/identity/gsi/web/reference/js-reference
 */

interface GoogleUser {
  email: string;
  name: string;
  picture: string;
  sub: string; // Google user ID
}

interface GoogleCredentialResponse {
  credential: string; // JWT token
  select_by: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
  error_uri?: string;
}

/**
 * OAuth error object passed to error_callback
 * These errors can occur during the OAuth flow
 */
interface GoogleOAuthError {
  type?: string; // Error type (e.g., 'popup_closed_by_user', 'access_denied', etc.)
  error?: string; // Error code (e.g., 'invalid_client', 'origin_mismatch', etc.)
  message?: string; // Human-readable error message
  details?: string; // Additional error details
  [key: string]: any; // Allow for additional properties
}

interface GoogleAuthConfig {
  client_id: string;
  scope: string;
  callback?: (response: GoogleTokenResponse) => void;
  error_callback?: (error: GoogleOAuthError) => void;
  ux_mode?: 'popup' | 'redirect'; // Default is 'popup'
  redirect_uri?: string; // Required if ux_mode is 'redirect'
  state?: string; // Optional state parameter for CSRF protection
  enable_serial_consent?: boolean; // Request scopes incrementally
  hint?: string; // Email hint for account selection
  hosted_domain?: string; // Restrict to a specific Google Workspace domain
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: '' | 'consent' | 'select_account' | 'none'; hint?: string }) => void;
}

interface Google {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
      }) => void;
      prompt: () => void;
      renderButton: (element: HTMLElement, config: any) => void;
    };
    oauth2: {
      initTokenClient: (config: GoogleAuthConfig) => GoogleTokenClient;
    };
  };
}

declare global {
  interface Window {
    google: Google;
  }
}

export {};
