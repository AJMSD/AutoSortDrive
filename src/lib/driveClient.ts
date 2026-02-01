/**
 * Google Drive API Client
 * 
 * Direct integration with Google Drive API v3 for listing and managing files.
 * Uses the access token from OAuth to make authenticated requests.
 * 
 * Documentation: https://developers.google.com/drive/api/v3/reference
 */

import axios, { AxiosInstance } from 'axios';
import { logger } from '@/utils/logger';

class DriveClient {
  private baseUrl = 'https://www.googleapis.com/drive/v3';
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 30000,
    });

    // Add response interceptor for debugging
    this.client.interceptors.response.use(
      (response) => {
        return response;
      },
      (error) => {
        logger.error('❌ Drive API Error:', error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get the authorization header with access token
   */
  private getAuthHeader(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  /**
   * List files from user's Drive
   * 
   * @param accessToken - User's OAuth access token
   * @param params - Query parameters for filtering/pagination
   */
  async listFiles(accessToken: string, params?: {
    pageSize?: number;
    pageToken?: string;
    q?: string; // Query string for filtering
    orderBy?: string;
    excludeFolders?: boolean;
  }) {
    const queryParams: any = {
      pageSize: params?.pageSize || 100, // Reduced from 1000 for better pagination control
      orderBy: params?.orderBy || 'modifiedTime desc',
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, createdTime, size, owners, parents, webViewLink, iconLink, thumbnailLink)',
    };

    if (params?.pageToken) {
      queryParams.pageToken = params.pageToken;
    }

    // Always exclude trashed files unless explicitly searching for them
    const excludeFoldersAndShortcuts =
      "mimeType != 'application/vnd.google-apps.folder' and mimeType != 'application/vnd.google-apps.shortcut'";
    const shouldExcludeFolders = params?.excludeFolders !== false;

    if (params?.q) {
      // If query already mentions trashed, use it as-is
      if (params.q.includes('trashed')) {
        queryParams.q = params.q;
      } else {
        // Add trashed filter to existing query
        queryParams.q = `(${params.q}) and trashed=false`;
      }
    } else {
      // Default: only non-trashed files
      queryParams.q = 'trashed=false';
    }

    // Always exclude folders and shortcuts unless explicitly disabled
    if (shouldExcludeFolders) {
      queryParams.q = `(${queryParams.q}) and ${excludeFoldersAndShortcuts}`;
    }

    try {
      const response = await this.client.get(`${this.baseUrl}/files`, {
        headers: this.getAuthHeader(accessToken),
        params: queryParams,
      });

      return {
        success: true,
        files: response.data.files || [],
        nextPageToken: response.data.nextPageToken || null,
      };
    } catch (error: any) {
      logger.error('❌ Failed to list files:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
        files: [],
        nextPageToken: null,
      };
    }
  }

  /**
   * Get file metadata by ID
   */
  async getFile(accessToken: string, fileId: string) {
    try {
      const response = await this.client.get(`${this.baseUrl}/files/${fileId}`, {
        headers: this.getAuthHeader(accessToken),
        params: {
          fields: 'id, name, mimeType, modifiedTime, createdTime, size, owners, parents, webViewLink, iconLink, thumbnailLink',
        },
      });

      return {
        success: true,
        file: response.data,
      };
    } catch (error: any) {
      logger.error('❌ Failed to get file:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Create a file in Drive
   */
  async createFile(
    accessToken: string,
    metadata: {
      name: string;
      mimeType?: string;
      parents?: string[]; // Folder IDs
    },
    content?: string
  ) {
    try {
      // Upload metadata only (no content)
      if (!content) {
        const response = await this.client.post(
          `${this.baseUrl}/files`,
          metadata,
          {
            headers: {
              ...this.getAuthHeader(accessToken),
              'Content-Type': 'application/json',
            },
          }
        );

        return {
          success: true,
          file: response.data,
        };
      }

      // Upload with content (multipart)
      const boundary = '-------314159265358979323846';
      const delimiter = `\r\n--${boundary}\r\n`;
      const closeDelimiter = `\r\n--${boundary}--`;

      const multipartBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${metadata.mimeType || 'text/plain'}\r\n\r\n` +
        content +
        closeDelimiter;

      const response = await this.client.post(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        multipartBody,
        {
          headers: {
            ...this.getAuthHeader(accessToken),
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
        }
      );

      return {
        success: true,
        file: response.data,
      };
    } catch (error: any) {
      logger.error('❌ Failed to create file:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Update file content
   */
  async updateFile(accessToken: string, fileId: string, content: string, mimeType: string = 'text/plain') {
    try {
      const response = await this.client.patch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        content,
        {
          headers: {
            ...this.getAuthHeader(accessToken),
            'Content-Type': mimeType,
          },
        }
      );

      return {
        success: true,
        file: response.data,
      };
    } catch (error: any) {
      logger.error('❌ Failed to update file:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Download file content
   */
  async downloadFile(accessToken: string, fileId: string) {
    try {
      const response = await this.client.get(`${this.baseUrl}/files/${fileId}`, {
        headers: this.getAuthHeader(accessToken),
        params: { alt: 'media' },
      });

      return {
        success: true,
        content: response.data,
      };
    } catch (error: any) {
      logger.error('❌ Failed to download file:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Search for files in appDataFolder
   */
  async listAppDataFiles(accessToken: string, query?: string) {
    try {
      const q = query 
        ? `'appDataFolder' in parents and ${query}`
        : `'appDataFolder' in parents`;

      const response = await this.client.get(`${this.baseUrl}/files`, {
        headers: this.getAuthHeader(accessToken),
        params: {
          spaces: 'appDataFolder',
          q,
          fields: 'files(id, name, modifiedTime)',
        },
      });

      return {
        success: true,
        files: response.data.files || [],
      };
    } catch (error: any) {
      logger.error('❌ Failed to list appData files:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
        files: [],
      };
    }
  }

  /**
   * Create file in appDataFolder
   */
  async createAppDataFile(accessToken: string, name: string, content: string) {
    try {
      const metadata = {
        name,
        parents: ['appDataFolder'],
        mimeType: 'application/json',
      };

      return await this.createFile(accessToken, metadata, content);
    } catch (error: any) {
      logger.error('❌ Failed to create appData file:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update file in appDataFolder
   */
  async updateAppDataFile(accessToken: string, fileId: string, content: string) {
    return await this.updateFile(accessToken, fileId, content, 'application/json');
  }

  /**
   * Download file from appDataFolder
   */
  async downloadAppDataFile(accessToken: string, fileId: string) {
    return await this.downloadFile(accessToken, fileId);
  }

  /**
   * Update file parents (reparent/move)
   */
  async updateFileParents(
    accessToken: string,
    fileId: string,
    options: { addParents?: string[]; removeParents?: string[] }
  ) {
    try {
      const addParents = (options.addParents || []).filter(Boolean).join(',');
      const removeParents = (options.removeParents || []).filter(Boolean).join(',');

      const response = await this.client.patch(
        `${this.baseUrl}/files/${fileId}`,
        {},
        {
          headers: {
            ...this.getAuthHeader(accessToken),
            'Content-Type': 'application/json',
          },
          params: {
            ...(addParents ? { addParents } : {}),
            ...(removeParents ? { removeParents } : {}),
            fields: 'id, parents',
          },
        }
      );

      return {
        success: true,
        file: response.data,
      };
    } catch (error: any) {
      logger.error('❌ Failed to update file parents:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Trash a file or folder
   */
  async trashFile(accessToken: string, fileId: string) {
    try {
      const response = await this.client.patch(
        `${this.baseUrl}/files/${fileId}`,
        { trashed: true },
        {
          headers: {
            ...this.getAuthHeader(accessToken),
            'Content-Type': 'application/json',
          },
          params: {
            fields: 'id, trashed',
          },
        }
      );

      return {
        success: true,
        file: response.data,
      };
    } catch (error: any) {
      logger.error('❌ Failed to trash file:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }
}

export const driveClient = new DriveClient();
