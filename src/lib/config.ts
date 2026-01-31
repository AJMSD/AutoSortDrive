/**
 * Environment configuration utilities
 */

export const config = {
  google: {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID as string,
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY as string,
  },
  api: {
    appsScriptUrl: import.meta.env.VITE_APPS_SCRIPT_DEPLOY_URL as string,
    baseUrl: import.meta.env.VITE_API_BASE_URL as string,
    timeout: parseInt(import.meta.env.VITE_API_TIMEOUT as string) || 30000,
  },
  features: {
    aiEnabled: import.meta.env.VITE_ENABLE_AI_FEATURES === 'true',
    debugMode: import.meta.env.VITE_ENABLE_DEBUG_MODE === 'true',
  },
  env: import.meta.env.VITE_ENV as string,
} as const;

/**
 * Validate environment configuration
 * Throws error if critical configs are missing
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check Google OAuth
  if (!config.google.clientId || config.google.clientId === 'your_google_client_id_here') {
    errors.push('VITE_GOOGLE_CLIENT_ID is not configured');
  }
  if (!config.google.apiKey || config.google.apiKey === 'your_google_api_key_here') {
    errors.push('VITE_GOOGLE_API_KEY is not configured');
  }

  // Check Apps Script URL
  if (!config.api.appsScriptUrl || !config.api.appsScriptUrl.startsWith('https://script.google.com')) {
    errors.push('VITE_APPS_SCRIPT_DEPLOY_URL is not properly configured');
  }

  if (config.features.debugMode) {
    console.log('🔍 Debug mode enabled');
    console.log('Configuration:', {
      clientId: config.google.clientId.substring(0, 20) + '...',
      apiKey: config.google.apiKey.substring(0, 10) + '...',
      appsScriptUrl: config.api.appsScriptUrl,
      aiEnabled: config.features.aiEnabled,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Log configuration status (safe - no secrets)
 */
export function logConfigStatus(): void {
  console.log('📋 Configuration Status:');
  console.log('  Google Client ID:', config.google.clientId ? '✅ Set' : '❌ Missing');
  console.log('  Google API Key:', config.google.apiKey ? '✅ Set' : '❌ Missing');
  console.log('  Apps Script URL:', config.api.appsScriptUrl ? '✅ Set' : '❌ Missing');
  console.log('  AI Features:', config.features.aiEnabled ? '✅ Enabled' : '⚠️ Disabled');
  console.log('  Debug Mode:', config.features.debugMode ? '✅ Enabled' : '⚠️ Disabled');
  console.log('  Environment:', config.env);
}
