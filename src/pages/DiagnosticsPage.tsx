import React, { useState, useEffect } from 'react';
import { config, validateConfig, logConfigStatus } from '@/lib/config';
import { appsScriptClient } from '@/lib/appsScriptClient';

interface TestResult {
  name: string;
  status: 'pending' | 'success' | 'failed' | 'warning';
  message: string;
  details?: any;
}

const DiagnosticsPage: React.FC = () => {
  const [results, setResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    logConfigStatus();
  }, []);

  const runDiagnostics = async () => {
    setIsRunning(true);
    const testResults: TestResult[] = [];

    // Test 1: Environment Variables
    testResults.push({
      name: '1. Environment Variables',
      status: 'pending',
      message: 'Checking environment configuration...',
    });
    setResults([...testResults]);

    const validation = validateConfig();
    testResults[0] = {
      name: '1. Environment Variables',
      status: validation.valid ? 'success' : 'failed',
      message: validation.valid
        ? 'All environment variables are set correctly'
        : 'Missing or invalid environment variables',
      details: validation.errors,
    };
    setResults([...testResults]);

    // Test 2: Google Client ID Format
    testResults.push({
      name: '2. Google OAuth Client ID',
      status: 'pending',
      message: 'Validating Google Client ID format...',
    });
    setResults([...testResults]);

    const clientIdValid = config.google.clientId.endsWith('.apps.googleusercontent.com');
    testResults[1] = {
      name: '2. Google OAuth Client ID',
      status: clientIdValid ? 'success' : 'failed',
      message: clientIdValid
        ? 'Client ID format is valid'
        : 'Client ID format is invalid',
      details: { clientId: config.google.clientId.substring(0, 30) + '...' },
    };
    setResults([...testResults]);

    // Test 3: Apps Script URL
    testResults.push({
      name: '3. Apps Script Deployment URL',
      status: 'pending',
      message: 'Checking Apps Script URL...',
    });
    setResults([...testResults]);

    const scriptUrlValid = config.api.appsScriptUrl.startsWith(
      'https://script.google.com/macros/'
    );
    testResults[2] = {
      name: '3. Apps Script Deployment URL',
      status: scriptUrlValid ? 'success' : 'failed',
      message: scriptUrlValid
        ? 'Apps Script URL format is valid'
        : 'Apps Script URL format is invalid',
      details: { url: config.api.appsScriptUrl },
    };
    setResults([...testResults]);

    // Test 4: Apps Script Connection
    testResults.push({
      name: '4. Apps Script Backend Connection',
      status: 'pending',
      message: 'Testing connection to Apps Script...',
    });
    setResults([...testResults]);

    try {
      const connectionTest = await appsScriptClient.testConnection();
      testResults[3] = {
        name: '4. Apps Script Backend Connection',
        status: connectionTest.success ? 'success' : 'failed',
        message: connectionTest.message,
        details: connectionTest.data,
      };
    } catch (error: any) {
      testResults[3] = {
        name: '4. Apps Script Backend Connection',
        status: 'failed',
        message: error.message || 'Failed to connect to Apps Script backend',
        details: { 
          error: error.message,
          code: error.code,
          response: error.response?.data,
          status: error.response?.status,
          url: config.api.appsScriptUrl,
        },
      };
    }
    setResults([...testResults]);

    // Test 5: Google OAuth (will need user interaction)
    testResults.push({
      name: '5. Drive Files API',
      status: 'pending',
      message: 'Testing file listing endpoint...',
    });
    setResults([...testResults]);

    try {
      const filesTest = await appsScriptClient.listFiles({ pageSize: 5 });
      testResults[4] = {
        name: '5. Drive Files API',
        status: filesTest.success ? 'success' : 'failed',
        message: filesTest.success 
          ? `Successfully retrieved ${filesTest.files?.length || 0} files`
          : 'Failed to retrieve files',
        details: {
          totalReturned: filesTest.totalReturned,
          hasNextPage: !!filesTest.nextPageToken,
          sampleFiles: filesTest.files?.slice(0, 3).map((f: any) => ({
            name: f.name,
            type: f.mimeType,
            categorized: f.categorized,
          })),
        },
      };
    } catch (error: any) {
      testResults[4] = {
        name: '5. Drive Files API',
        status: 'failed',
        message: error.message || 'Failed to test file listing',
        details: { 
          error: error.message,
          response: error.response?.data,
        },
      };
    }
    setResults([...testResults]);

    // Test 6: Google OAuth Flow (manual)
    testResults.push({
      name: '6. Google OAuth Flow',
      status: 'warning',
      message: 'Manual test required - Click "Sign in with Google" on landing page',
    });
    setResults([...testResults]);

    setIsRunning(false);
  };

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return '✅';
      case 'failed':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'pending':
        return '⏳';
    }
  };

  const getStatusColor = (status: TestResult['status']) => {
    switch (status) {
      case 'success':
        return 'text-green-600 dark:text-green-400';
      case 'failed':
        return 'text-red-600 dark:text-red-400';
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400';
      case 'pending':
        return 'text-gray-600 dark:text-gray-400';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            🔧 System Diagnostics
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-8">
            Testing AutoSortDrive configuration and connectivity
          </p>

          <button
            onClick={runDiagnostics}
            disabled={isRunning}
            className={`
              px-6 py-3 rounded-lg font-medium mb-8 transition-all
              ${
                isRunning
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
              }
              text-white
            `}
          >
            {isRunning ? 'Running Tests...' : 'Run Diagnostics'}
          </button>

          {results.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Test Results
              </h2>
              {results.map((result, index) => (
                <div
                  key={index}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{getStatusIcon(result.status)}</span>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
                        {result.name}
                      </h3>
                      <p className={`text-sm ${getStatusColor(result.status)}`}>
                        {result.message}
                      </p>
                      {result.details && (
                        <details className="mt-2">
                          <summary className="text-sm text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-900 dark:hover:text-gray-200">
                            View Details
                          </summary>
                          <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-x-auto">
                            {JSON.stringify(result.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.length > 0 && !isRunning && (
            <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                Next Steps
              </h3>
              <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                <li>• If all tests pass, try signing in on the landing page</li>
                <li>• Check browser console (F12) for additional debug logs</li>
                <li>
                  • Verify your Apps Script deployment is set to "Anyone" or "Anyone with
                  Google account"
                </li>
                <li>
                  • Make sure OAuth consent screen is configured with your Google Cloud
                  project
                </li>
              </ul>
            </div>
          )}

          <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">
              Current Configuration
            </h3>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <div>
                <dt className="text-gray-600 dark:text-gray-400">Client ID:</dt>
                <dd className="font-mono text-xs text-gray-900 dark:text-white break-all">
                  {config.google.clientId}
                </dd>
              </div>
              <div>
                <dt className="text-gray-600 dark:text-gray-400">API Key:</dt>
                <dd className="font-mono text-xs text-gray-900 dark:text-white">
                  {config.google.apiKey.substring(0, 10)}...
                </dd>
              </div>
              <div>
                <dt className="text-gray-600 dark:text-gray-400">Apps Script URL:</dt>
                <dd className="font-mono text-xs text-gray-900 dark:text-white break-all">
                  {config.api.appsScriptUrl}
                </dd>
              </div>
              <div>
                <dt className="text-gray-600 dark:text-gray-400">Debug Mode:</dt>
                <dd className="text-gray-900 dark:text-white">
                  {config.features.debugMode ? 'Enabled' : 'Disabled'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-600 dark:text-gray-400">AI Features:</dt>
                <dd className="text-gray-900 dark:text-white">
                  {config.features.aiEnabled ? 'Enabled' : 'Disabled'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsPage;
