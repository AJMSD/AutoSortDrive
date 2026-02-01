import React, { useState, useEffect } from 'react';
import { logger } from '@/utils/logger';
import { appsScriptClient } from '@/lib/appsScriptClient';
import toast from 'react-hot-toast';
import { authStorage } from '@/utils/authStorage';
import './FilePreviewModal.css';

// Modal that fetches authenticated preview/download URLs and renders previews or export options.
interface FilePreviewModalProps {
  fileId: string;
  fileName: string;
  mimeType: string;
  onClose: () => void;
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  fileId,
  fileName,
  mimeType: _mimeType,
  onClose
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [viewData, setViewData] = useState<any>(null);
  const [downloadData, setDownloadData] = useState<any>(null);
  const [selectedExportFormat, setSelectedExportFormat] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const openInNewTab = (url: string) => {
    const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (newWindow) {
      newWindow.opener = null;
    }
  };

  useEffect(() => {
    loadFileData();
    
    // Handle Escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      // Clean up blob URL when component unmounts
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [fileId, onClose]);

  const loadFileData = async () => {
    setIsLoading(true);
    setLoadError(null);
    
    try {
      // Load view and download data in parallel
      const [viewResult, downloadResult] = await Promise.all([
        appsScriptClient.getFileViewUrl(fileId),
        appsScriptClient.getFileDownloadUrl(fileId)
      ]);

      if (viewResult.success) {
        setViewData(viewResult.file);
        
        // For images, PDFs, and text files, fetch the content using authenticated API
        if (viewResult.file.viewType === 'image' || 
            viewResult.file.viewType === 'pdf' ||
            viewResult.file.viewType === 'text') {
          await fetchFileContent(viewResult.file.authenticatedPreviewUrl, viewResult.file.viewType);
        }
      } else {
        setLoadError(viewResult.error || 'Failed to load file preview');
        toast.error('Failed to load file preview');
      }

      if (downloadResult.success) {
        setDownloadData(downloadResult.file);
        if (downloadResult.file.exportFormats?.length > 0) {
          setSelectedExportFormat(downloadResult.file.exportFormats[0].format);
        }
      }
    } catch (error: any) {
      logger.error('Error loading file data:', error);
      const errorMsg = 'Failed to load file data';
      setLoadError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFileContent = async (url: string, viewType: string) => {
    try {
      const accessToken = authStorage.getAccessToken();
      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.error('Fetch error:', response.status, errorText);
        throw new Error(`Failed to fetch file content: ${response.status}`);
      }

      if (viewType === 'text') {
        const text = await response.text();
        setTextContent(text);
      } else {
        const blob = await response.blob();
        const blobUrlCreated = URL.createObjectURL(blob);
        setBlobUrl(blobUrlCreated);
      }
    } catch (error: any) {
      logger.error('Error fetching file content:', error);
      setLoadError(error.message || 'Failed to fetch file content');
    }
  };

  const handleDownload = async () => {
    if (!downloadData) return;

    setIsDownloading(true);
    
    try {
      let downloadUrl = downloadData.downloadUrl;

      // If it's a Google Workspace file and format is selected, get specific export URL
      if (downloadData.isGoogleWorkspace && selectedExportFormat) {
        const result = await appsScriptClient.getFileDownloadUrl(fileId, selectedExportFormat);
        if (result.success) {
          downloadUrl = result.file.downloadUrl;
        }
      }

      // Get access token for authenticated download
      const accessToken = authStorage.getAccessToken();
      if (!accessToken) {
        toast.error('Not authenticated');
        return;
      }

      // Download file using fetch with auth token
      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('File downloaded successfully');
    } catch (error: any) {
      logger.error('Download error:', error);
      toast.error('Failed to download file');
    } finally {
      setIsDownloading(false);
    }
  };

  const renderPreview = () => {
    if (isLoading) {
      return (
        <div className="preview-loading">
          <div className="spinner"></div>
          <p>Loading preview...</p>
        </div>
      );
    }

    if (loadError || !viewData) {
      return (
        <div className="preview-error">
          <span className="error-icon">⚠️</span>
          <p>{loadError || 'Unable to load preview'}</p>
          {viewData?.webViewLink && (
            <button className="btn-primary" onClick={() => openInNewTab(viewData.webViewLink)}>
              Open in Google Drive
            </button>
          )}
        </div>
      );
    }

    // For images - display using authenticated blob URL
    if (viewData.viewType === 'image' && blobUrl) {
      return (
        <div className="preview-image-container">
          <img 
            src={blobUrl} 
            alt={fileName} 
            className="preview-image"
            onError={() => setLoadError('Failed to load image')}
          />
        </div>
      );
    }

    // For PDFs - display using authenticated blob URL in iframe
    if (viewData.viewType === 'pdf' && blobUrl) {
      return (
        <iframe
          src={blobUrl}
          className="preview-iframe"
          title={fileName}
        />
      );
    }

    // For text files - display content in a pre element
    if (viewData.viewType === 'text' && textContent !== null) {
      return (
        <div className="preview-text-container">
          <pre className="preview-text">{textContent}</pre>
        </div>
      );
    }

    // For Google Workspace files (Docs, Sheets, Slides) - use embedded viewer
    if (viewData.viewType === 'embed' && viewData.embedLink) {
      return (
        <iframe
          src={viewData.embedLink}
          className="preview-iframe"
          title={fileName}
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-presentation"
        />
      );
    }

    // For other files or if preview fails, show thumbnail and open in Drive button
    return (
      <div className="preview-external">
        {viewData.thumbnailLink && (
          <img src={viewData.thumbnailLink} alt={fileName} className="preview-thumbnail" />
        )}
        <div className="external-info">
          <span className="file-icon-large">📄</span>
          <h3>{fileName}</h3>
          <p className="file-size">{viewData.size ? `${(viewData.size / 1024 / 1024).toFixed(2)} MB` : ''}</p>
          <p>This file type cannot be previewed directly</p>
          <div className="external-actions">
            <button 
              className="btn-primary" 
              onClick={() => openInNewTab(viewData.webViewLink)}
            >
              Open in Google Drive
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="file-preview-modal-overlay" onClick={onClose}>
      <div className="file-preview-modal" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="header-left">
            <h2 className="modal-title">{fileName}</h2>
          </div>
          
          <div className="header-actions">
            {downloadData && downloadData.isGoogleWorkspace && downloadData.exportFormats.length > 1 && (
              <div className="export-format-selector">
                <label>Format:</label>
                <select 
                  value={selectedExportFormat}
                  onChange={(e) => setSelectedExportFormat(e.target.value)}
                  className="format-select"
                >
                  {downloadData.exportFormats.map((format: any) => (
                    <option key={format.format} value={format.format}>
                      {format.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            <button 
              className="btn-download" 
              onClick={handleDownload}
              disabled={isDownloading || !downloadData}
              title={isDownloading ? "Downloading..." : "Download file"}
            >
              {isDownloading ? (
                <span className="spinner-small"></span>
              ) : (
                <i className="fa-solid fa-download"></i>
              )}
            </button>
            
            <button className="btn-close" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </div>

        {/* Modal Body - Preview */}
        <div className="modal-body">
          {renderPreview()}
        </div>
      </div>
    </div>
  );
};

export default FilePreviewModal;
