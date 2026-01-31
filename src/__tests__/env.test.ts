import { describe, it, expect } from 'vitest';

describe('Environment Configuration Tests', () => {
  it('should load VITE_GOOGLE_CLIENT_ID', () => {
    expect(import.meta.env.VITE_GOOGLE_CLIENT_ID).toBeDefined();
    expect(import.meta.env.VITE_GOOGLE_CLIENT_ID).not.toBe('your_google_client_id_here');
    expect(import.meta.env.VITE_GOOGLE_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
  });

  it('should load VITE_GOOGLE_API_KEY', () => {
    expect(import.meta.env.VITE_GOOGLE_API_KEY).toBeDefined();
    expect(import.meta.env.VITE_GOOGLE_API_KEY).not.toBe('your_google_api_key_here');
  });

  it('should load VITE_APPS_SCRIPT_DEPLOY_URL', () => {
    expect(import.meta.env.VITE_APPS_SCRIPT_DEPLOY_URL).toBeDefined();
    expect(import.meta.env.VITE_APPS_SCRIPT_DEPLOY_URL).toMatch(/^https:\/\/script\.google\.com/);
  });

  it('should have debug mode enabled', () => {
    expect(import.meta.env.VITE_ENABLE_DEBUG_MODE).toBe('true');
  });

  it('should have AI features disabled', () => {
    expect(import.meta.env.VITE_ENABLE_AI_FEATURES).toBe('false');
  });
});
