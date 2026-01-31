import React, { useState, useEffect } from 'react';
import { logger } from '@/utils/logger';
import { userCache } from '@/utils/userCache';
import { useParams, useNavigate } from 'react-router-dom';
import { appsScriptClient } from '@/lib/appsScriptClient';
import toast from 'react-hot-toast';
import FileThumbnail from '@/components/common/FileThumbnail';
import FilePreviewModal from '@/components/common/FilePreviewModal';
import { downloadFilesAsZip } from '@/lib/bulkDownload';
import { authStorage } from '@/utils/authStorage';
import './CategoryViewPage.css';

interface FileItem {
  id: string;
  name: string;
  mimeType: string;
  type: 'document' | 'image' | 'pdf' | 'sheet' | 'slide' | 'video' | 'folder' | 'other';
  modified: string;
  modifiedDate: Date;
  selected: boolean;
  parents?: string[];
  thumbnailLink?: string;
  iconLink?: string;
  assignmentMeta?: {
    source?: string;
    reason?: string;
    confidence?: number;
    model?: string;
    decidedAt?: string;
  };
}

interface Category {
  id: string;
  name: string;
  description: string;
  keywords?: string[];
  examples?: string[];
  color: string;
  icon: string;
  fileCount: number;
  driveFolderId?: string;
  source?: 'manual' | 'drive-folder';
}

const CategoryViewPage: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isRemoving, setIsRemoving] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'type'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [previewFile, setPreviewFile] = useState<{id: string; name: string; mimeType: string} | null>(null);
  const [aiReasonFile, setAiReasonFile] = useState<FileItem | null>(null);
  
  const [category, setCategory] = useState<Category | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isInboxCacheEmpty, setIsInboxCacheEmpty] = useState(false);

  // Map MIME types to file types
  const getFileType = (mimeType: string): FileItem['type'] => {
    if (mimeType.includes('document')) return 'document';
    if (mimeType.includes('spreadsheet')) return 'sheet';
    if (mimeType.includes('presentation')) return 'slide';
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('image/')) return 'image';
    if (mimeType.includes('video/')) return 'video';
    if (mimeType.includes('folder')) return 'folder';
    return 'other';
  };

  // Format relative time
  const getRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  useEffect(() => {
    if (!categoryId) return;

    let isActive = true;

    const loadCategory = async () => {
      setIsLoading(true);
      setIsInboxCacheEmpty(false);

      try {
        const cachedConfigVersion = userCache.getConfigVersion();
        const cachedCategories = userCache.get<Category[]>('categories', {
          configVersion: cachedConfigVersion ?? undefined,
        });
        const foundCategory = cachedCategories?.find(c => c.id === categoryId) || null;

        if (!foundCategory) {
          if (!isActive) return;
          setCategory(null);
          setFiles([]);
          setIsLoading(false);
          return;
        }

        if (!isActive) return;
        setCategory(foundCategory);

        const inboxCache = userCache.get<any[]>('inbox_all_files', {
          configVersion: cachedConfigVersion ?? undefined,
        });
        if (!inboxCache || !Array.isArray(inboxCache) || inboxCache.length === 0) {
          // Fallback: fetch files to hydrate cache for this category view.
          const params: any = { pageSize: 1000 };
          const firstResponse = await appsScriptClient.listFiles(params);
          if (!firstResponse.success) {
            if (!isActive) return;
            setFiles([]);
            setIsInboxCacheEmpty(true);
            setIsLoading(false);
            return;
          }

          const configVersion =
            typeof firstResponse.configVersion === 'number' && Number.isFinite(firstResponse.configVersion)
              ? firstResponse.configVersion
              : undefined;
          if (configVersion !== undefined) {
            userCache.setConfigVersion(configVersion);
          }

          const mapFiles = (items: any[]) =>
            items.map((file: any) => ({
              id: file.id,
              name: file.name,
              mimeType: file.mimeType,
              type: file.type || getFileType(file.mimeType),
              modified: getRelativeTime(file.modifiedTime),
              modifiedDate: new Date(file.modifiedTime),
              selected: false,
              parents: file.parents || [],
              thumbnailLink: file.thumbnailLink,
              iconLink: file.iconLink,
              assignmentMeta: file.assignmentMeta || undefined,
              categoryId: file.categoryId,
            }));

          let allFiles = mapFiles(firstResponse.files || []);
          let pageToken: string | null = firstResponse.nextPageToken || null;
          let pageCount = 0;
          const MAX_PAGES = 100;

          while (pageToken && pageCount < MAX_PAGES) {
            pageCount += 1;
            const response = await appsScriptClient.listFiles({ ...params, cursor: pageToken });
            if (!response.success) break;
            allFiles = [...allFiles, ...mapFiles(response.files || [])];
            pageToken = response.nextPageToken || null;
          }

          userCache.set('inbox_all_files', allFiles, { configVersion });

          const folderId = foundCategory.driveFolderId;
          const categoryFiles = allFiles
            .filter((file: any) => {
              const matchesAssignment = file.categoryId === categoryId;
              const matchesFolder =
                folderId && Array.isArray(file.parents) && file.parents.includes(folderId);
              return matchesAssignment || matchesFolder;
            })
            .map((file: any) => {
              const modifiedDate =
                file.modifiedDate instanceof Date
                  ? file.modifiedDate
                  : new Date(file.modifiedDate || file.modifiedTime);
              return {
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                type: file.type || getFileType(file.mimeType),
                modified: getRelativeTime(modifiedDate.toISOString()),
                modifiedDate,
                selected: false,
                parents: file.parents || [],
                thumbnailLink: file.thumbnailLink,
                iconLink: file.iconLink,
                assignmentMeta: file.assignmentMeta || undefined,
              };
            });

          if (!isActive) return;
          setFiles(categoryFiles);
          setIsInboxCacheEmpty(false);
          setIsLoading(false);
          return;
        }

        const folderId = foundCategory.driveFolderId;
        const categoryFiles = inboxCache
          .filter((file: any) => {
            const matchesAssignment = file.categoryId === categoryId;
            const matchesFolder =
              folderId && Array.isArray(file.parents) && file.parents.includes(folderId);
            return matchesAssignment || matchesFolder;
          })
          .map((file: any) => ({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            type: file.type || getFileType(file.mimeType),
            modified: file.modified || getRelativeTime(new Date(file.modifiedDate).toISOString()),
            modifiedDate: new Date(file.modifiedDate),
            selected: false,
            parents: file.parents || [],
            thumbnailLink: file.thumbnailLink,
            iconLink: file.iconLink,
            assignmentMeta: file.assignmentMeta || undefined,
          }));

        if (!isActive) return;
        setFiles(categoryFiles);
        setIsLoading(false);
      } catch (error) {
        logger.error('Error loading category:', error);
        toast.error('Error loading category');
        if (!isActive) return;
        setIsLoading(false);
      }
    };

    void loadCategory();

    return () => {
      isActive = false;
    };
  }, [categoryId]);

  const toggleFileSelection = (fileId: string) => {
    setFiles(prevFiles =>
      prevFiles.map(f => {
        if (f.id !== fileId) return f;
        return { ...f, selected: !f.selected };
      })
    );
  };

  const handleRemoveFromCategory = async (fileId: string) => {
    setIsRemoving(true);
    try {
      // Optimistic update is handled automatically by appsScriptClient
      const response = await appsScriptClient.assignCategory(fileId, null);
      if (response.success) {
        // Update local UI state
        const updatedFiles = files.filter(f => f.id !== fileId);
        setFiles(updatedFiles);

        if (category) {
          setCategory({ ...category, fileCount: Math.max(0, category.fileCount - 1) });
        }

        toast.success('Removed from category');
      } else {
        toast.error('Failed to remove file from category');
      }
    } catch (error) {
      logger.error('Error removing file:', error);
      toast.error('Error removing file from category');
    } finally {
      setIsRemoving(false);
    }
  };

  const handleBulkRemove = async () => {
    const isFolderCategory = !!category?.driveFolderId;
    const removableFiles = files.filter(f => {
      if (!f.selected) return false;
      if (isFolderCategory && f.parents?.includes(category!.driveFolderId!)) return false;
      return true;
    });
    const lockedFiles = files.filter(
      f => f.selected && isFolderCategory && f.parents?.includes(category!.driveFolderId!)
    );

    if (removableFiles.length === 0) {
      if (lockedFiles.length > 0) {
        toast.error('Selected files were added from the category\'s Drive folder. Move them in Drive to remove.');
      }
      return;
    }

    setIsRemoving(true);
    try {
      // Remove all selected files from category
      const assignments = removableFiles.map(f => ({ fileId: f.id, categoryId: null }));
      const response = await appsScriptClient.assignCategoriesBulk(assignments);
      
      if (response.success) {
        const removedIds = new Set(removableFiles.map(f => f.id));
        setFiles(prev => prev.filter(f => !removedIds.has(f.id)));
        // Update category count
        if (category) {
          setCategory({ ...category, fileCount: Math.max(0, category.fileCount - removableFiles.length) });
        }
        // Update inbox cache to remove categoryId from these files
        const selectedFileIds = removableFiles.map(f => f.id);
        const inboxCacheKey = 'inbox_all_files';
        const inboxCache = userCache.get<any[]>(inboxCacheKey);
        if (inboxCache) {
          const updatedInboxFiles = inboxCache.map((f: any) =>
            selectedFileIds.includes(f.id)
              ? { ...f, categoryId: null, categorized: false }
              : f
          );
          const currentConfigVersion = userCache.getConfigVersion();
          userCache.set(inboxCacheKey, updatedInboxFiles, { configVersion: currentConfigVersion ?? undefined });
          logger.debug(`?? Updated inbox cache to remove category from ${removableFiles.length} files`);
        }
        
        // Update categories cache count instead of invalidating
        const categoriesCache = userCache.get('categories');
        if (categoriesCache && Array.isArray(categoriesCache)) {
          const updatedCategories = categoriesCache.map((c: any) =>
            c.id === categoryId
              ? { ...c, fileCount: Math.max(0, c.fileCount - removableFiles.length) }
              : c
          );
          const currentConfigVersion = userCache.getConfigVersion();
          userCache.set('categories', updatedCategories, { configVersion: currentConfigVersion ?? undefined });
          logger.debug(`?? Updated category count in cache (-${removableFiles.length})`);
        }
        
        toast.success(`Removed ${removableFiles.length} file${removableFiles.length > 1 ? 's' : ''} from category`);
        if (lockedFiles.length > 0) {
          toast.error(`Skipped ${lockedFiles.length} file${lockedFiles.length > 1 ? 's' : ''} from the category\'s Drive folder. Move them in Drive to remove.`);
        }
      } else {
        toast.error('Failed to remove files from category');
      }
    } catch (error) {
      logger.error('Error removing files:', error);
      toast.error('Error removing files from category');
    } finally {
      setIsRemoving(false);
    }
  };

  const handleBulkDownload = async () => {
    const selectedFiles = files.filter(f => f.selected);
    if (selectedFiles.length === 0) return;

    setFiles(files.map(f => ({ ...f, selected: false })));

    await downloadFilesAsZip(
      selectedFiles.map(file => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
      }))
    );
  };

  const sortedFiles = [...files].sort((a, b) => {
    let comparison = 0;
    
    if (sortBy === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (sortBy === 'date') {
      comparison = a.modifiedDate.getTime() - b.modifiedDate.getTime();
    } else if (sortBy === 'type') {
      comparison = a.type.localeCompare(b.type);
    }
    
    return sortOrder === 'asc' ? comparison : -comparison;
  });
  const isFolderCategory = !!category?.driveFolderId;
  const selectedCount = files.filter(f => f.selected).length;
  const removableSelectedCount = isFolderCategory
    ? files.filter(f => f.selected && !f.parents?.includes(category!.driveFolderId!)).length
    : selectedCount;
  const aiReasonMeta = aiReasonFile?.assignmentMeta;
  const aiReasonConfidence =
    typeof aiReasonMeta?.confidence === 'number'
      ? Math.round(aiReasonMeta.confidence > 1 ? aiReasonMeta.confidence : aiReasonMeta.confidence * 100)
      : null;

  if (isLoading) {
    return (
      <div className="category-view-page">
        <div className="loading-container">
          <div className="spinner-lg"></div>
          <p className="loading-text">Loading category...</p>
        </div>
      </div>
    );
  }

  if (!category) {
    return (
      <div className="category-view-page">
        <div className="empty-state">
          <span className="empty-icon">❌</span>
          <h3>Category not found</h3>
          <p>This category doesn't exist or has been deleted.</p>
          <button className="back-btn" onClick={() => navigate('/categories')}>
            Back to Categories
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="category-view-page">
      {/* Category Header */}
      <div className="category-header">
        <button className="back-btn" onClick={() => navigate('/categories')}>
          ← Back to Categories
        </button>
        
        <div className="category-header-content">
          <div className="category-header-left">
            <span 
              className="category-icon-large"
              style={{ backgroundColor: category.color }}
            >
              <i className={`fa-solid ${category.icon}`}></i>
            </span>
            <div className="category-header-info">
              <h1 className="category-title">{category.name}</h1>
              <p className="category-description-full">{category.description}</p>
              <div className="category-meta">
                <span className="file-count">{files.length} files</span>
              </div>
            </div>
          </div>
          
          <div className="category-header-actions">
            <div className="sort-controls">
              <label className="sort-label">Sort by:</label>
              <select 
                className="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'date' | 'type')}
              >
                <option value="date">Date Modified</option>
                <option value="name">Name</option>
                <option value="type">Type</option>
              </select>
              
              <button
                className="sort-order-btn"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
              >
                <i className={`fa-solid ${sortOrder === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down'}`}></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Files List */}
      <div className="category-files-container">
        {files.length === 0 ? (
          isInboxCacheEmpty ? (
            <div className="empty-state">
              <span className="empty-icon pulse"><i className="fa-solid fa-inbox"></i></span>
              <h3>Inbox cache is empty</h3>
              <p>Visit Inbox to load files into the cache so this category can display them.</p>
              <button className="action-btn" onClick={() => navigate('/inbox')}>
                Go to Inbox
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon pulse"><i className="fa-solid fa-folder"></i></span>
              <h3>No files in this category yet</h3>
              <p>Files you assign to "{category.name}" will appear here.</p>
              <button className="action-btn" onClick={() => navigate('/inbox')}>
                Browse Files
              </button>
            </div>
          )
        ) : (
          <>
            {/* File List Header */}
            <div className="file-list-header">
              <span className="file-header-checkbox">
                <input
                  type="checkbox"
                  checked={files.length > 0 && selectedCount === files.length}
                  onChange={() => {
                    const allSelected = files.length > 0 && selectedCount === files.length;
                    setFiles(files.map(f => ({ ...f, selected: !allSelected })));
                  }}
                />
              </span>
              <span className="file-header-name">Name</span>
              <span className="file-header-modified">Modified</span>
              <span className="file-header-type">Type</span>
              <span className="file-header-actions">Actions</span>
            </div>

            {/* File Rows */}
            {sortedFiles.map((file, index) => {
              const isFolderOwned = isFolderCategory && file.parents?.includes(category!.driveFolderId!);

              return (
                <div
                  key={file.id}
                  className="file-row"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <label className="file-checkbox-container" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={file.selected}
                      onChange={() => toggleFileSelection(file.id)}
                      title={
                        isFolderOwned
                          ? 'This file belongs to a Drive folder. Move it in Drive to remove.'
                          : undefined
                      }
                    />
                  </label>

                <div className="file-info">
                  <FileThumbnail
                    thumbnailLink={file.thumbnailLink}
                    iconLink={file.iconLink}
                    mimeType={file.mimeType}
                    fileName={file.name}
                    size="small"
                  />
                  <span 
                    className="file-name clickable"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewFile({ id: file.id, name: file.name, mimeType: file.mimeType });
                    }}
                    title="Click to preview"
                  >
                    {file.name}
                  </span>
                </div>

                <span className="file-modified-badge">{file.modified}</span>
                
                <span className="file-type-badge">{file.type}</span>
                
                <div className="file-actions">
                  {file.assignmentMeta?.source === 'AI' && file.assignmentMeta?.reason && (
                    <button
                      className="ai-reason-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAiReasonFile(file);
                      }}
                      title="View AI reason"
                      aria-label={`View AI reason for ${file.name}`}
                    >
                      <i className="fa-solid fa-robot"></i>
                    </button>
                  )}
                  <button
                    className="download-btn"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const result = await appsScriptClient.getFileDownloadUrl(file.id);
                        if (!result.success) throw new Error(result.error);
                        
                        const accessToken = authStorage.getAccessToken();
                        if (!accessToken) throw new Error('Not authenticated');
                        const response = await fetch(result.downloadUrl, {
                          headers: { 'Authorization': `Bearer ${accessToken}` }
                        });
                        
                        if (!response.ok) throw new Error('Download failed');
                        
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = file.name;
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                        document.body.removeChild(a);
                        
                        toast.success('Downloaded successfully');
                      } catch (error: any) {
                        toast.error('Download failed');
                      }
                    }}
                    title="Download file"
                    aria-label={`Download ${file.name}`}
                  >
                    <i className="fa-solid fa-download"></i>
                  </button>
                  <button
                    className={`delete-btn${isFolderOwned ? ' is-locked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isFolderOwned) {
                        toast.error('This file was added from the category\'s Drive folder. Move it in Drive to remove.');
                        return;
                      }
                      handleRemoveFromCategory(file.id);
                    }}
                    disabled={isRemoving}
                    aria-disabled={isFolderOwned}
                    title={
                      isFolderOwned
                        ? 'This file belongs to a Drive folder. Move it in Drive to remove.'
                        : 'Remove from category'
                    }
                    aria-label={`Remove ${file.name} from category`}
                  >
                    <i className="fa-regular fa-trash-can"></i>
                  </button>
                </div>
              </div>
              );
            })}
          </>
        )}
      </div>

      {/* Bulk Actions Bar */}
      {selectedCount > 0 && (
        <div className="bulk-actions-bar">
          <span className="selection-count">
            {selectedCount} file{selectedCount > 1 ? 's' : ''} selected
          </span>
          <div className="bulk-actions">
            <button 
              className={`bulk-remove-btn${removableSelectedCount === 0 ? ' is-locked' : ''}`} 
              onClick={handleBulkRemove}
              disabled={isRemoving}
              aria-disabled={removableSelectedCount === 0}
            >
              {isRemoving ? 'Removing...' : 'Remove from Category'}
            </button>
            <button
              className="bulk-remove-btn"
              onClick={handleBulkDownload}
              disabled={isRemoving}
            >
              Download Zip
            </button>

            <button 
              className="clear-selection-btn" 
              onClick={() => setFiles(files.map(f => ({ ...f, selected: false })))}
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          fileId={previewFile.id}
          fileName={previewFile.name}
          mimeType={previewFile.mimeType}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {aiReasonFile && (
        <>
          <div
            className="modal-backdrop"
            onClick={() => setAiReasonFile(null)}
          />
          <div
            className="ai-reason-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-ai-reason-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ai-reason-header">
              <div>
                <h3 id="category-ai-reason-title">AI Reason</h3>
                <p className="ai-reason-subtitle">{aiReasonFile.name}</p>
                {aiReasonConfidence !== null && (
                  <span className="ai-reason-confidence">Confidence: {aiReasonConfidence}%</span>
                )}
              </div>
              <button
                className="ai-reason-close"
                type="button"
                onClick={() => setAiReasonFile(null)}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="ai-reason-body">
              <p>{aiReasonMeta?.reason || 'No reason provided.'}</p>
            </div>
            <div className="ai-reason-actions">
              <button
                className="modal-btn btn-cancel"
                type="button"
                onClick={() => setAiReasonFile(null)}
              >
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CategoryViewPage;