import React, { useState, useEffect, useMemo } from 'react';
import { logger } from '@/utils/logger';
import { useNavigate, useLocation } from 'react-router-dom';
import { appsScriptClient } from '@/lib/appsScriptClient';
import { config } from '@/lib/config';
import { userCache } from '@/utils/userCache';
import toast from 'react-hot-toast';
import Tooltip from '@/components/common/Tooltip';
import FileThumbnail from '@/components/common/FileThumbnail';
import FilePreviewModal from '@/components/common/FilePreviewModal';
import { downloadFilesAsZip, prefetchDownloadMetadata } from '@/lib/bulkDownload';
import { authStorage } from '@/utils/authStorage';
import './InboxPage.css';

interface FileItem {
  id: string;
  name: string;
  mimeType: string;
  type: 'document' | 'image' | 'pdf' | 'sheet' | 'slide' | 'video' | 'folder' | 'other';
  modified: string;
  modifiedDate: Date;
  size?: number;
  parents?: string[];
  categoryId: string | null;
  categorized: boolean;
  selected: boolean;
  webViewLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  inReview?: boolean;
  assignmentMeta?: {
    source?: string;
    reason?: string;
    confidence?: number;
    model?: string;
    decidedAt?: string;
  };
}

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';
const isExcludedMimeType = (mimeType?: string) =>
  mimeType === FOLDER_MIME_TYPE || mimeType === SHORTCUT_MIME_TYPE;

const AI_COOLDOWN_STORAGE_KEY = 'aiCooldown';

const readAiCooldown = (defaultRemaining: number) => {
  try {
    const raw = sessionStorage.getItem(AI_COOLDOWN_STORAGE_KEY);
    if (!raw) {
      return { until: null, remaining: defaultRemaining };
    }
    const parsed = JSON.parse(raw);
    const until = typeof parsed?.until === 'number' ? parsed.until : null;
    const remaining = typeof parsed?.remaining === 'number' ? parsed.remaining : defaultRemaining;
    if (until !== null && !Number.isFinite(until)) {
      return { until: null, remaining: defaultRemaining };
    }
    return { until, remaining };
  } catch {
    return { until: null, remaining: defaultRemaining };
  }
};

const writeAiCooldown = (until: number | null, remaining: number) => {
  try {
    if (until === null) {
      sessionStorage.removeItem(AI_COOLDOWN_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
      AI_COOLDOWN_STORAGE_KEY,
      JSON.stringify({ until, remaining })
    );
  } catch {
    // Best-effort cache only; ignore storage failures.
  }
};

const InboxPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const AI_MAX_FILES_PER_CALL = 3;
  const AI_COOLDOWN_MS = 60 * 1000;
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFetchingRemaining, setIsFetchingRemaining] = useState(false); // Prevent duplicate background fetches
  const [isAssigning, setIsAssigning] = useState(false); // Track category assignment in progress
  const [files, setFiles] = useState<FileItem[]>([]);
  const [shouldAnimate, setShouldAnimate] = useState(false); // Track if files should animate on render
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<string>('');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const initialCooldown = readAiCooldown(AI_MAX_FILES_PER_CALL);
  const [aiCooldownUntil, setAiCooldownUntil] = useState<number | null>(initialCooldown.until);
  const [aiRemainingQuota, setAiRemainingQuota] = useState<number>(initialCooldown.remaining);
  const aiSuggestionsLocked = !config.features.aiSuggestionsEnabled;
  const [itemsPerPage, setItemsPerPage] = useState(() => {
    const saved = localStorage.getItem('itemsPerPage');
    return saved ? parseInt(saved, 10) : 100;
  });
  const [previewFile, setPreviewFile] = useState<{id: string; name: string; mimeType: string} | null>(null);

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

  // Simple cache key - we cache ALL files, filtering happens client-side
  const getCacheKey = () => {
    return 'inbox_all_files';
  };

  const normalizeConfigVersion = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return value;
  };

  // Fetch files from backend - progressive loading
  const fetchFiles = async () => {
    const cacheKey = getCacheKey();
    
    // TODO [CACHE-SYNC-4]: For first load, we don't have config version yet,
    // so we can't validate staleness. We'll get it after first API call.
    // This is intentional - cache validation happens on subsequent page loads.
    const cachedConfigVersion = userCache.getConfigVersion();
    const cachedFiles = userCache.get<FileItem[]>(cacheKey, {
      ttl: 5 * 60 * 1000,
      configVersion: cachedConfigVersion ?? undefined,
    });
    if (cachedFiles && cachedFiles.length > 0) {
      const sanitizedCache = cachedFiles.filter(file => !isExcludedMimeType(file.mimeType));
      if (sanitizedCache.length !== cachedFiles.length) {
        userCache.set(cacheKey, sanitizedCache, { configVersion: cachedConfigVersion ?? undefined });
        logger.debug('Removed folders/shortcuts from cached inbox files');
      }

      if (sanitizedCache.length > 0) {
        logger.debug('???? Loading files from user cache:', sanitizedCache.length);
        setFiles(sanitizedCache);
        setShouldAnimate(false);
        setIsLoading(false);
        setCurrentPage(1);
        void prefetchDownloadMetadata(sanitizedCache);
        return; // Use cached data, skip API call
      }
    }

    
    setIsLoading(true);
    setFiles([]);
    setCurrentPage(1);
    
    try {
      const params: any = {
        pageSize: 1000, // Use max API limit to reduce number of requests
      };
      // Fetch ALL non-trashed files from Drive (trashed=false filter applied in driveClient)

      // Fetch first page
      const firstResponse = await appsScriptClient.listFiles(params);
      
      // TODO [CACHE-SYNC-4]: Extract config version for cache tracking
      const configVersion = normalizeConfigVersion(firstResponse.configVersion);
      if (configVersion !== undefined) {
        userCache.setConfigVersion(configVersion);
      }
      
      // DEBUG: Check if backend is returning inReview flag
      logger.debug('🔍 DEBUG: First response from backend:', {
        success: firstResponse.success,
        fileCount: firstResponse.files?.length,
        sampleFile: firstResponse.files?.[0],
        hasInReviewFlag: firstResponse.files?.[0]?.inReview !== undefined,
        configVersion, // Log config version
      });
      
      if (firstResponse.success) {
        const mappedFiles: FileItem[] = firstResponse.files
          .filter((file: any) => !isExcludedMimeType(file.mimeType))
          .map((file: any) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          type: getFileType(file.mimeType),
          modified: getRelativeTime(file.modifiedTime),
          modifiedDate: new Date(file.modifiedTime),
          size: file.size,
          parents: file.parents || [],
          categoryId: file.categoryId,
          categorized: file.categorized,
          selected: false,
          webViewLink: file.webViewLink,
          thumbnailLink: file.thumbnailLink,
          iconLink: file.iconLink,
          inReview: file.inReview || false,
          assignmentMeta: file.assignmentMeta || undefined,
        }));

        // DEBUG: Check mapped files for inReview status
        const inReviewCount = mappedFiles.filter(f => f.inReview).length;
        logger.debug('🔍 DEBUG: Mapped files:', {
          total: mappedFiles.length,
          inReviewCount,
          sampleMapped: mappedFiles[0],
          filesInReview: mappedFiles.filter(f => f.inReview).map(f => ({ id: f.id, name: f.name, inReview: f.inReview }))
        });

        // Show first batch immediately
        setFiles(mappedFiles);
        setShouldAnimate(true);
        setIsLoading(false);
        logger.debug('✅ First batch loaded:', { fileCount: mappedFiles.length, hasMore: !!firstResponse.nextPageToken });
        
        // Fetch remaining pages in background if there are more
        if (firstResponse.nextPageToken) {
          setIsLoadingMore(true);
          
          // Continue fetching in background
          fetchRemainingPages(params, firstResponse.nextPageToken, mappedFiles, configVersion);
        } else {
          // No more pages - cache the files now
          userCache.set(cacheKey, mappedFiles, { configVersion });
          logger.debug('💾 Cached all files:', mappedFiles.length);
          void prefetchDownloadMetadata(mappedFiles);
        }
      } else {
        toast.error('Failed to load files: ' + (firstResponse.error || 'Unknown error'));
        setIsLoading(false);
      }
    } catch (error: any) {
      logger.error('Error fetching files:', error);
      toast.error('Failed to load files from Drive');
      setIsLoading(false);
    }
  };

  // Fetch remaining pages in background without blocking UI
  const fetchRemainingPages = async (baseParams: any, initialToken: string, existingFiles: FileItem[], configVersion?: number) => {
    // Prevent duplicate fetches
    if (isFetchingRemaining) {
      logger.debug('⏸️ Already fetching remaining pages, skipping');
      return;
    }

    setIsFetchingRemaining(true);
    let allFiles = [...existingFiles];
    let pageToken: string | null = initialToken;
    let pageCount = 0;
    const MAX_PAGES = 100; // Safety limit to prevent infinite loops

    try {
      while (pageToken && pageCount < MAX_PAGES) {
        pageCount++;
        logger.debug(`📄 Fetching page ${pageCount}/${MAX_PAGES}...`);
        const currentParams = { ...baseParams, cursor: pageToken };
        const response = await appsScriptClient.listFiles(currentParams);
        
        if (response.success) {
          const mappedFiles: FileItem[] = response.files
            .filter((file: any) => !isExcludedMimeType(file.mimeType))
            .map((file: any) => ({
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            type: getFileType(file.mimeType),
            modified: getRelativeTime(file.modifiedTime),
            modifiedDate: new Date(file.modifiedTime),
            size: file.size,
            parents: file.parents || [],
            categoryId: file.categoryId,
            categorized: file.categorized,
            selected: false,
            webViewLink: file.webViewLink,
            thumbnailLink: file.thumbnailLink,
            iconLink: file.iconLink,
            inReview: file.inReview || false,
            assignmentMeta: file.assignmentMeta || undefined,
          }));

          allFiles = [...allFiles, ...mappedFiles];
          
          // Update files progressively, preserving selections and deduplicating
          setFiles(prevFiles => {
            // Create map with all existing files
            const fileMap = new Map(prevFiles.map(f => [f.id, f]));
            
            // Add/update with new files
            mappedFiles.forEach(file => {
              const existing = fileMap.get(file.id);
              if (existing) {
                // Preserve selection state
                fileMap.set(file.id, {
                  ...file,
                  selected: existing.selected,
                  assignmentMeta: file.assignmentMeta || existing.assignmentMeta,
                });
              } else {
                fileMap.set(file.id, file);
              }
            });
            
            return Array.from(fileMap.values());
          });
          
          logger.debug('✅ Loaded files:', { totalCount: allFiles.length, hasMore: !!response.nextPageToken });
          
          pageToken = response.nextPageToken || null;
          
          // Add small delay to prevent overwhelming the API
          if (pageToken) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } else {
          logger.debug('❌ Failed to fetch page, stopping');
          break;
        }
      }
      
      if (pageCount >= MAX_PAGES) {
        logger.warn('⚠️ Reached maximum page limit, stopping fetch');
      }
    } catch (error) {
      logger.error('Error fetching remaining pages:', error);
    } finally {
      setIsLoadingMore(false);
      setIsFetchingRemaining(false);
      logger.debug('✅ All files loaded:', { totalCount: allFiles.length, pages: pageCount });
      
      // TODO [CACHE-SYNC-4]: Cache with config version for staleness detection
      const cacheKey = getCacheKey();
      if (configVersion !== undefined) {
        userCache.setConfigVersion(configVersion);
      }
      userCache.set(cacheKey, allFiles, { configVersion });
      if (allFiles.length > 0) {
        void prefetchDownloadMetadata(allFiles);
      }
    }
  };

  // Refresh files - check for new files in Drive and merge with existing
  const refreshFiles = async () => {
    setIsRefreshing(true);
    
    try {
      const params: any = { pageSize: 1000 }; // Use max API limit
      const response = await appsScriptClient.listFiles(params);
      
      // TODO [CACHE-SYNC-4]: Extract config version for cache tracking
      const configVersion = normalizeConfigVersion(response.configVersion);
      if (configVersion !== undefined) {
        userCache.setConfigVersion(configVersion);
      }
      
      if (response.success) {
        const newFiles: FileItem[] = response.files
          .filter((file: any) => !isExcludedMimeType(file.mimeType))
          .map((file: any) => ({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          type: getFileType(file.mimeType),
          modified: getRelativeTime(file.modifiedTime),
          modifiedDate: new Date(file.modifiedTime),
          size: file.size,
          parents: file.parents || [],
          categoryId: file.categoryId,
          categorized: file.categorized,
          selected: false,
          webViewLink: file.webViewLink,
          thumbnailLink: file.thumbnailLink,
          iconLink: file.iconLink,
          inReview: file.inReview || false,
          assignmentMeta: file.assignmentMeta || undefined,
        }));

        // Merge with existing files, preserving selections and categories
        setFiles(prevFiles => {
          const fileMap = new Map(prevFiles.map(f => [f.id, f]));

          // Add new files and update existing ones
          newFiles.forEach(newFile => {
            const existing = fileMap.get(newFile.id);
            if (existing) {
              // Preserve selection and category from existing
              fileMap.set(newFile.id, {
                ...newFile,
                selected: existing.selected,
                categoryId: existing.categoryId || newFile.categoryId,
                assignmentMeta: newFile.assignmentMeta || existing.assignmentMeta,
              });
            } else {
              // New file
              fileMap.set(newFile.id, newFile);
            }
          });

          const mergedFiles = Array.from(fileMap.values());
          userCache.set(getCacheKey(), mergedFiles, { configVersion });
          if (mergedFiles.length > 0) {
            void prefetchDownloadMetadata(mergedFiles);
          }
          return mergedFiles;
        });

        // Fetch remaining pages if needed
        if (response.nextPageToken) {
          setIsLoadingMore(true);
          fetchRemainingPages(params, response.nextPageToken, newFiles, configVersion);
        }
        
        toast.success('Files refreshed successfully');
      }
    } catch (error) {
      logger.error('Error refreshing files:', error);
      toast.error('Failed to refresh files');
    } finally {
      setIsRefreshing(false);
    }
  };

  // TODO [CACHE-SYNC-1]: Fetch files on mount only - filters are applied client-side
  useEffect(() => {
    logger.debug('🔍 Component mounted, fetching files from API');
    fetchFiles();
  }, []); // Empty dependency array - only runs once on mount

  // TODO [OPTION-2]: Smart cache check on navigation - only fetch if cache was invalidated
  useEffect(() => {
    // Skip if this is the initial mount (already handled above)
    if (!location.state) return;
    
    const cacheKey = getCacheKey();
    const cachedConfigVersion = userCache.getConfigVersion();
    const cachedFiles = userCache.get<FileItem[]>(cacheKey, {
      ttl: 5 * 60 * 1000,
      configVersion: cachedConfigVersion ?? undefined,
    });
    
    // If cache is missing (was invalidated by another page), fetch fresh data
    if (!cachedFiles || cachedFiles.length === 0) {
      logger.debug('📭 Cache invalidated, fetching fresh data on navigation...');
      fetchFiles();
    } else {
      logger.debug('📦 Using cached data on navigation, no fetch needed');
    }
  }, [location.pathname]); // Run when navigating to this route

  // TODO [CACHE-SYNC-1]: Refresh data when user returns to tab/window
  // This catches external Drive changes (files added/modified outside the app)
  // Pattern copied from CategoriesPage for consistency
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        logger.debug('👁️ Tab visible again, refreshing files...');
        fetchFiles();
      }
    };

    const handleFocus = () => {
      logger.debug('🎯 Window focused, refreshing files...');
      fetchFiles();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);
  
  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset to page 1 when filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchQuery, selectedTypes, selectedStatus, dateRange, customStartDate, customEndDate]);
  
  // Fetch categories from backend
  const [categories, setCategories] = useState<Array<{ id: string; name: string; color: string; icon: string; fileCount?: number }>>([]);

  const loadCategories = async (bypassCache: boolean = false) => {
    try {
      // Try cache first unless bypassing
      if (!bypassCache) {
        const cachedConfigVersion = userCache.getConfigVersion();
        const cachedCategories = userCache.get<Array<{ id: string; name: string; color: string; icon: string; fileCount?: number }>>(
          'categories',
          { configVersion: cachedConfigVersion ?? undefined }
        );
        if (cachedCategories) {
          logger.debug('📦 Loading categories from user cache');
          setCategories(cachedCategories);
          return;
        }
      }
      
      const response = await appsScriptClient.getCategories(bypassCache);
      if (response.success) {
        const configVersion = normalizeConfigVersion(response.configVersion);
        if (configVersion !== undefined) {
          userCache.setConfigVersion(configVersion);
        }
        const cats = response.categories.map((cat: any) => ({
          id: cat.id,
          name: cat.name,
          color: cat.color,
          icon: cat.icon,
          fileCount: typeof cat.fileCount === 'number' ? cat.fileCount : 0,
        }));
        setCategories(cats);
        userCache.set('categories', cats, { configVersion });
        logger.debug('✅ Loaded categories for inbox:', response.categories.length);
      }
    } catch (error) {
      logger.error('❌ Failed to load categories:', error);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  // Keyboard navigation: Escape to close category dropdown
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showCategoryDropdown) {
        setShowCategoryDropdown(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCategoryDropdown]);
  
  // Remove mock data - now using real data from fetchFiles()
  // const [files, setFiles] = useState<FileItem[]>([...]);

  const getCategoryColor = (categoryId: string | null) => {
    if (!categoryId) return null;
    const category = categories.find(c => c.id === categoryId);
    return category?.color || null;
  };

  const toggleFileSelection = (id: string) => {
    setFiles(prevFiles => {
      const target = prevFiles.find(f => f.id === id);
      if (!target) return prevFiles;
      return prevFiles.map(f => f.id === id ? { ...f, selected: !f.selected } : f);
    });
  };

  const toggleAllSelection = () => {
    setFiles(prevFiles => {
      const allSelected = prevFiles.length > 0 && prevFiles.every(f => f.selected);
      if (allSelected) {
        return prevFiles.map(f => (f.selected ? { ...f, selected: false } : f));
      }
      return prevFiles.map(f => ({ ...f, selected: true }));
    });
  };

  const clearSelection = () => {
    setFiles(files.map(f => ({ ...f, selected: false })));
    setShowCategoryDropdown(false);
  };

  useEffect(() => {
    if (aiCooldownUntil !== null) {
      writeAiCooldown(aiCooldownUntil, aiRemainingQuota);
    } else {
      writeAiCooldown(null, AI_MAX_FILES_PER_CALL);
    }
  }, [aiCooldownUntil, aiRemainingQuota]);

  useEffect(() => {
    if (!aiCooldownUntil) return;

    const remainingMs = aiCooldownUntil - Date.now();
    if (remainingMs <= 0) {
      setAiCooldownUntil(null);
      setAiRemainingQuota(AI_MAX_FILES_PER_CALL);
      return;
    }

    const timer = setTimeout(() => {
      setAiCooldownUntil(null);
      setAiRemainingQuota(AI_MAX_FILES_PER_CALL);
    }, remainingMs);

    return () => clearTimeout(timer);
  }, [aiCooldownUntil]);

  const assignToCategory = async (categoryId: string) => {
    const selectedFiles = files.filter(f => f.selected);
    
    if (selectedFiles.length === 0) return;
    
    // Close dropdown and show loading state
    setShowCategoryDropdown(false);
    setIsAssigning(true);
    
    try {
      // Check if "Auto" option was selected
      if (categoryId === 'auto') {
        const now = Date.now();
        const cooldownActive = aiCooldownUntil !== null && now < aiCooldownUntil;
        const remainingQuota = cooldownActive ? aiRemainingQuota : AI_MAX_FILES_PER_CALL;

        if (selectedFiles.length > AI_MAX_FILES_PER_CALL) {
          toast.error(`AI auto-assign is limited to ${AI_MAX_FILES_PER_CALL} files per minute.`);
          return;
        }

        if (selectedFiles.length > remainingQuota) {
          if (cooldownActive) {
            const secondsLeft = Math.ceil((aiCooldownUntil! - now) / 1000);
            toast.error(
              remainingQuota > 0
                ? `AI limit: only ${remainingQuota} more file${remainingQuota === 1 ? '' : 's'} allowed this cooldown.`
                : `AI cooldown active. Try again in ${secondsLeft}s.`
            );
          } else {
            toast.error(`AI can only process up to ${AI_MAX_FILES_PER_CALL} files per call.`);
          }
          return;
        }

        setAiCooldownUntil(now + AI_COOLDOWN_MS);
        setAiRemainingQuota(prev => {
          const base = cooldownActive ? prev : AI_MAX_FILES_PER_CALL;
          return Math.max(0, base - selectedFiles.length);
        });

        // Use batch auto-assign endpoint with optimistic updates
        logger.debug(`🤖 Auto-assigning ${selectedFiles.length} files using rules...`);
        
        const response = await appsScriptClient.batchAutoAssign(selectedFiles.map(f => f.id));
        
        if (!response.success) {
          throw new Error(response.error || 'Auto-assignment failed');
        }
        
        // Process results with safe destructuring
        const summary = response.summary || { assigned: 0, noMatch: 0, errors: 0, total: 0 };
        const assignedDetails = response.results?.assigned || [];
        const reviewDetails = response.results?.noMatch || [];
        const errorDetails = response.results?.errors || [];
        const rateLimitError = errorDetails.find((item: any) =>
          typeof item?.error === 'string' && /rate limit|quota/i.test(item.error)
        );

        if (rateLimitError && assignedDetails.length === 0 && reviewDetails.length === 0) {
          toast.error(rateLimitError.error || 'AI rate limit reached. Try again later.');
          return;
        }
        
        // Reload files from cache to reflect optimistic updates
        // The cache was already updated by batchAutoAssignOptimistic
        const cachedFiles = userCache.get<FileItem[]>(getCacheKey(), {
          configVersion: userCache.getConfigVersion() ?? undefined,
        });
        if (cachedFiles) {
          // Clear selections on updated files
          const updatedFiles = cachedFiles.map(f => ({ ...f, selected: false }));
          setFiles(updatedFiles);
          logger.debug('✅ Reloaded files from cache after auto-assign');
        } else {
          // Fallback: just clear selections
          const updatedFiles = files.map(f => ({ ...f, selected: false }));
          setFiles(updatedFiles);
        }
        
        // Show summary
        const { assigned, noMatch, errors } = summary;
        if (assigned > 0) {
          const maxItems = 4;
          const items = assignedDetails.slice(0, maxItems);
          toast.custom(() => (
            <div className="toast-panel toast-content">
              <div className="toast-title">
                Auto-assigned {assigned} file{assigned > 1 ? 's' : ''}
              </div>
              {items.map((item: any) => {
                const categoryName = categories.find(c => c.id === item.categoryId)?.name || 'Unknown category';
                return (
                  <div key={item.fileId} className="toast-subtext">
                    {item.fileName} <i className="fa-solid fa-arrow-right"></i> {categoryName}
                  </div>
                );
              })}
              {assignedDetails.length > maxItems && (
                <div className="toast-subtext">+{assignedDetails.length - maxItems} more</div>
              )}
            </div>
          ));
        }
        if (noMatch > 0) {
          const maxItems = 4;
          const items = reviewDetails.slice(0, maxItems);
          toast.custom(() => (
            <div className="toast-panel toast-content">
              <div className="toast-title">
                {noMatch} file{noMatch > 1 ? 's' : ''} added to Review Queue
              </div>
              {items.map((item: any) => (
                <div key={item.fileId} className="toast-subtext">
                  {item.fileName} <i className="fa-solid fa-arrow-right"></i> Review Queue
                </div>
              ))}
              {reviewDetails.length > maxItems && (
                <div className="toast-subtext">+{reviewDetails.length - maxItems} more</div>
              )}
            </div>
          ));
        }
        if (errors > 0) {
          toast.error(`${errors} file${errors > 1 ? 's' : ''} failed`);
        }
        
        // Reload categories to update counts
        loadCategories(true);
        
        // Navigate to review page if there are items needing review
        if (noMatch > 0) {
          setTimeout(() => {
            toast(`Navigating to Review Queue...`, { icon: <i className="fa-solid fa-rotate" style={{ color: 'var(--color-accent-primary)' }} /> });
            navigate('/review', { state: { refreshReviewQueue: true } });
          }, 1500);
        }
        
        return;
      }
      
      // Normal category assignment
      // Prepare assignments
      const assignments = selectedFiles.map(f => ({
        fileId: f.id,
        categoryId: categoryId,
      }));
      
      // Use chunked parallel processing for better performance
      const CHUNK_SIZE = 20; // Process 20 files per request
      const MAX_PARALLEL = 3; // Max 3 concurrent requests
      
      if (assignments.length <= CHUNK_SIZE) {
        // Small batch - send in one request
        const response = await appsScriptClient.assignCategoriesBulk(assignments);
        if (!response.success) {
          throw new Error(response.error || 'Failed to assign category');
        }
      } else {
        // Large batch - split into chunks and process in parallel
        const chunks: typeof assignments[] = [];
        for (let i = 0; i < assignments.length; i += CHUNK_SIZE) {
          chunks.push(assignments.slice(i, i + CHUNK_SIZE));
        }
        
        logger.debug(`📦 Processing ${assignments.length} files in ${chunks.length} chunks (${CHUNK_SIZE} per chunk, max ${MAX_PARALLEL} parallel)`);
        
        // Process chunks in batches of MAX_PARALLEL
        for (let i = 0; i < chunks.length; i += MAX_PARALLEL) {
          const batch = chunks.slice(i, i + MAX_PARALLEL);
          const promises = batch.map(chunk => appsScriptClient.assignCategoriesBulk(chunk));
          const results = await Promise.all(promises);
          
          // Check if any failed
          const failed = results.find(r => !r.success);
          if (failed) {
            throw new Error(failed.error || 'Failed to assign category');
          }
        }
        
        logger.debug(`✅ Successfully processed all ${chunks.length} chunks`);
      }
      
      // Update UI only after successful API call(s)
      const updatedFiles = files.map(f => 
        f.selected ? { ...f, categoryId, categorized: true, selected: false } : f
      );
      setFiles(updatedFiles);
      
      const currentConfigVersion = userCache.getConfigVersion();
      userCache.set(getCacheKey(), updatedFiles, { configVersion: currentConfigVersion ?? undefined });
      
      const categoryName = categories.find(c => c.id === categoryId)?.name || 'category';
      toast.success(`Successfully assigned ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} to ${categoryName}`);
      
      // Invalidate category file cache to force reload with fresh data
      userCache.remove(`category_files_${categoryId}`);
      logger.debug(`🗑️ Invalidated category cache for ${categoryId}`);
      
      // Reload categories bypassing cache to update counts immediately
      loadCategories(true);
      
      // Update categories cache count instead of invalidating
      try {
        const categoriesCache = userCache.get('categories');
        if (categoriesCache && Array.isArray(categoriesCache)) {
          const outgoingCounts = new Map<string, number>();
          let incomingCount = 0;

          selectedFiles.forEach(file => {
            if (file.categoryId && file.categoryId !== categoryId) {
              outgoingCounts.set(file.categoryId, (outgoingCounts.get(file.categoryId) || 0) + 1);
            }
            if (file.categoryId !== categoryId) {
              incomingCount += 1;
            }
          });

          const updatedCategories = categoriesCache.map((cat: any) =>
            cat.id === categoryId
              ? { ...cat, fileCount: Math.max(0, (cat.fileCount || 0) + incomingCount) }
              : outgoingCounts.has(cat.id)
                ? { ...cat, fileCount: Math.max(0, (cat.fileCount || 0) - (outgoingCounts.get(cat.id) || 0)) }
                : cat
          );
          userCache.set('categories', updatedCategories, { configVersion: currentConfigVersion ?? undefined });
          logger.debug(`🔄 Updated category count in cache (+${incomingCount})`);
        }
      } catch (e) {
        logger.error('Failed to update categories cache:', e);
      }
    } catch (error: any) {
      logger.error('Error assigning category:', error);
      toast.error('Failed to assign category: ' + error.message);
    } finally {
      setIsAssigning(false);
    }
  };

  const selectedCount = files.filter(f => f.selected).length;
  const hasSelectedInReview = files.some(f => f.selected && f.inReview);
  const isAiCooldownActive = aiCooldownUntil !== null && Date.now() < aiCooldownUntil;
  const aiQuotaRemaining = isAiCooldownActive ? aiRemainingQuota : AI_MAX_FILES_PER_CALL;
  const aiSelectionLimitReached = selectedCount > AI_MAX_FILES_PER_CALL;
  const aiCooldownSecondsLeft = isAiCooldownActive ? Math.ceil((aiCooldownUntil! - Date.now()) / 1000) : 0;

  // Apply all filters client-side on cached data
  const filteredFiles = useMemo(() => {
    let result = [...files];

    // DEBUG: Log files before filtering
    const beforeFilterInReview = result.filter(f => f.inReview).length;
    logger.debug('🔍 DEBUG: Files before filtering:', {
      totalFiles: result.length,
      inReviewFiles: beforeFilterInReview,
      sampleFile: result[0],
      sampleInReview: result.find(f => f.inReview)
    });

    // Apply search filter
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      result = result.filter(file => 
        file.name.toLowerCase().includes(query)
      );
    }

    // Apply type filter
    if (selectedTypes.length > 0) {
      const typeMap: Record<string, string[]> = {
        'Docs': ['document'],
        'Sheets': ['sheet'],
        'Slides': ['slide'],
        'PDFs': ['pdf'],
        'Images': ['image'],
        'Videos': ['video'],
        'Other': ['other']
      };
      
      const allowedTypes = selectedTypes.flatMap(t => typeMap[t] || []);
      result = result.filter(file => allowedTypes.includes(file.type));
    }

    // Apply status filter
    if (selectedStatus.length > 0) {
      result = result.filter(file => {
        if (selectedStatus.includes('In Review') && file.inReview) return true;
        if (selectedStatus.includes('Uncategorized') && !file.categoryId && !file.inReview) return true;
        if (selectedStatus.includes('Categorized') && file.categoryId) return true;
        return false;
      });
    }

    // Apply date range filter
    if (dateRange) {
      const now = new Date();
      let startDate: Date | null = null;

      if (dateRange === '7days') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (dateRange === '30days') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else if (dateRange === '90days') {
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      } else if (dateRange === 'custom' && customStartDate) {
        startDate = new Date(customStartDate);
      }

      if (startDate) {
        if (dateRange === 'custom' && customEndDate) {
          const endDate = new Date(customEndDate);
          endDate.setHours(23, 59, 59, 999); // Include entire end day
          result = result.filter(file => 
            file.modifiedDate >= startDate! && file.modifiedDate <= endDate
          );
        } else {
          result = result.filter(file => file.modifiedDate >= startDate!);
        }
      }
    }

    return result;
  }, [files, debouncedSearchQuery, selectedTypes, selectedStatus, dateRange, customStartDate, customEndDate]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredFiles.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedFiles = filteredFiles.slice(startIndex, endIndex);
  const paginationStatus = isLoadingMore ? `${totalPages}+` : `${totalPages}`;
  
  // Debug pagination
  useEffect(() => {
    logger.debug('📊 Pagination Debug:', {
      totalFiles: files.length,
      filteredFiles: filteredFiles.length,
      itemsPerPage,
      totalPages,
      currentPage,
      hasFilters: !!(debouncedSearchQuery || selectedTypes.length || selectedStatus.length || dateRange)
    });
  }, [files.length, filteredFiles.length, itemsPerPage, totalPages, currentPage, debouncedSearchQuery, selectedTypes.length, selectedStatus.length, dateRange]);

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handleItemsPerPageChange = (newValue: number) => {
    setItemsPerPage(newValue);
    localStorage.setItem('itemsPerPage', String(newValue));
    setCurrentPage(1); // Reset to first page
  };

  const handleBulkDownload = async () => {
    const selectedFiles = files.filter(f => f.selected);
    if (selectedFiles.length === 0) return;

    clearSelection();

    await downloadFilesAsZip(
      selectedFiles.map(file => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
      }))
    );
  };

  const fileTypes = ['Docs', 'Sheets', 'Slides', 'PDFs', 'Images', 'Videos', 'Other'];
  const statusOptions = ['Uncategorized', 'Categorized', 'In Review'];

  return (
    <div className="inbox-page">
      {/* Search & Filter Bar */}
      {aiSuggestionsLocked && (
        <div className="ai-disabled-banner">
          AI suggestions are currently disabled by the server. You can still assign categories manually or use rules.
        </div>
      )}

      <div className="inbox-toolbar">
        <div className="search-container">
          <i className="fa-solid fa-magnifying-glass search-icon"></i>
          <input
            type="text"
            className="search-input"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Tooltip content="Refresh files from Drive" position="bottom">
          <button
            className={`refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
            onClick={refreshFiles}
            disabled={isRefreshing}
          >
            <i className="fa-solid fa-arrows-rotate refresh-icon"></i>
          </button>
        </Tooltip>

        <Tooltip content="Toggle advanced filters" position="bottom">
          <button
            className={`filter-toggle ${filterOpen ? 'active' : ''}`}
            onClick={() => setFilterOpen(!filterOpen)}
          >
            <i className="fa-solid fa-filter filter-icon"></i>
          </button>
        </Tooltip>
      </div>

      {/* Filter Panel */}
      {filterOpen && (
        <div className="filter-panel">
          <div className="filter-section">
            <h3 className="filter-heading">File Type</h3>
            <div className="filter-options">
              {fileTypes.map(type => (
                <label key={type} className="filter-option">
                  <input
                    type="checkbox"
                    checked={selectedTypes.includes(type)}
                    onChange={() => {
                      setSelectedTypes(prev =>
                        prev.includes(type)
                          ? prev.filter(t => t !== type)
                          : [...prev, type]
                      );
                    }}
                  />
                  <span>{type}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <h3 className="filter-heading">Status</h3>
            <div className="filter-options">
              {statusOptions.map(status => (
                <label key={status} className="filter-option">
                  <input
                    type="checkbox"
                    checked={selectedStatus.includes(status)}
                    onChange={() => {
                      setSelectedStatus(prev =>
                        prev.includes(status)
                          ? prev.filter(s => s !== status)
                          : [...prev, status]
                      );
                    }}
                  />
                  <span>{status}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <h3 className="filter-heading">Date Modified</h3>
            <div className="date-range-options">
              <label className="date-range-option">
                <input
                  type="radio"
                  name="dateRange"
                  value="7days"
                  checked={dateRange === '7days'}
                  onChange={(e) => setDateRange(e.target.value)}
                />
                <span>Last 7 days</span>
              </label>
              <label className="date-range-option">
                <input
                  type="radio"
                  name="dateRange"
                  value="30days"
                  checked={dateRange === '30days'}
                  onChange={(e) => setDateRange(e.target.value)}
                />
                <span>Last 30 days</span>
              </label>
              <label className="date-range-option">
                <input
                  type="radio"
                  name="dateRange"
                  value="90days"
                  checked={dateRange === '90days'}
                  onChange={(e) => setDateRange(e.target.value)}
                />
                <span>Last 90 days</span>
              </label>
              <label className="date-range-option">
                <input
                  type="radio"
                  name="dateRange"
                  value="custom"
                  checked={dateRange === 'custom'}
                  onChange={(e) => setDateRange(e.target.value)}
                />
                <span>Custom range</span>
              </label>

              {dateRange === 'custom' && (
                <div className="custom-date-inputs">
                  <div className="date-input-group">
                    <label className="date-label">From:</label>
                    <input
                      type="date"
                      className="date-input"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                    />
                  </div>
                  <div className="date-input-group">
                    <label className="date-label">To:</label>
                    <input
                      type="date"
                      className="date-input"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {(selectedTypes.length > 0 || selectedStatus.length > 0 || dateRange) && (
            <Tooltip content="Remove all active filters" position="top">
              <button
                className="clear-filters"
                onClick={() => {
                  setSelectedTypes([]);
                  setSelectedStatus([]);
                  setDateRange('');
                  setCustomStartDate('');
                  setCustomEndDate('');
                }}
              >
                Clear all filters
              </button>
            </Tooltip>
          )}
        </div>
      )}

      {/* File List */}
      <div className="file-list">
        {/* List Header */}
        <div className="file-list-header">
          <label className="file-checkbox-container">
            <input
              type="checkbox"
              checked={files.every(f => f.selected)}
              onChange={toggleAllSelection}
            />
          </label>
          <span className="file-header-name">Name</span>
          <span className="file-header-category">Category</span>
          <span className="file-header-type">Type</span>
          <span className="file-header-modified">Modified</span>
        </div>

        {/* File Rows */}
        {isLoading ? (
          <>
            {[...Array(8)].map((_, i) => (
              <div key={i} className="skeleton-file-row">
                <div className="skeleton skeleton-icon"></div>
                <div className="skeleton-file-info">
                  <div className="skeleton skeleton-file-name"></div>
                  <div className="skeleton skeleton-file-meta"></div>
                </div>
                <div className="skeleton-actions">
                  <div className="skeleton skeleton-btn"></div>
                  <div className="skeleton skeleton-btn"></div>
                </div>
              </div>
            ))}
          </>
        ) : filteredFiles.length === 0 ? (
          <div className="no-results">
            <span className="no-results-icon"><i className="fa-solid fa-magnifying-glass"></i></span>
            <p>No files found</p>
            <p className="no-results-description">
              {searchQuery ? 'Try adjusting your search or filters' : 'No files match the current filters'}
            </p>
          </div>
        ) : (
          paginatedFiles.map((file, index) => {
            // DEBUG: Log each file being rendered
            if (index === 0 || file.inReview) {
              logger.debug('🔍 DEBUG: Rendering file:', {
                index,
                id: file.id,
                name: file.name,
                inReview: file.inReview,
                categoryId: file.categoryId
              });
            }
            
            return (
            <div
              key={file.id}
              className="file-row"
              style={shouldAnimate ? { animationDelay: `${index * 50}ms` } : {}}
              onClick={() => toggleFileSelection(file.id)}
            >
              <label className="file-checkbox-container" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={file.selected}
                  onChange={() => toggleFileSelection(file.id)}
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
                >
                  <i className="fa-solid fa-download"></i>
                </button>
              </div>

              <span className="file-category">
                {file.inReview ? (
                  <span className="in-review-tag">In Review</span>
                ) : file.categoryId && categories.find(c => c.id === file.categoryId) ? (
                  <span 
                    className="category-tag"
                    style={{ backgroundColor: getCategoryColor(file.categoryId) || undefined }}
                  >
                    {categories.find(c => c.id === file.categoryId)?.name}
                  </span>
                ) : (
                  <span className="uncategorized-tag">Uncategorized</span>
                )}
              </span>

              <span className="file-type-badge">{file.type}</span>
              <span className="file-modified-badge">{file.modified}</span>
            </div>
            );
          })
        )}
      </div>

      {/* Bulk Actions Bar */}
      {selectedCount > 0 && (
        <div className="bulk-actions-bar" onClick={(e) => e.stopPropagation()}>
          <div className="bulk-actions-content">
            <span className="selected-count">
              {selectedCount} file{selectedCount > 1 ? 's' : ''} selected
            </span>

            {hasSelectedInReview && (
              <span className="selection-warning">Assign disabled while In Review files are selected.</span>
            )}

            <div className="bulk-actions-buttons">
              <div className="category-dropdown-container">
                <button 
                  className="bulk-action-btn primary"
                  onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
                  disabled={isAssigning || hasSelectedInReview}
                >
                  <i className="fa-solid fa-layer-group action-icon manual bulk-action-icon"></i>
                  <span>{isAssigning ? 'Assigning...' : 'Assign to Category'}</span>
                </button>

                {showCategoryDropdown && !isAssigning && (
                  <div className="category-dropdown">
                    {/* Auto option - uses rules to automatically categorize */}
                    <button
                      className="category-dropdown-item auto-option"
                      onClick={() => assignToCategory('auto')}
                      disabled={
                        isAssigning ||
                        hasSelectedInReview ||
                        aiSelectionLimitReached ||
                        (isAiCooldownActive && aiQuotaRemaining <= 0)
                      }
                      title={
                        isAiCooldownActive && aiQuotaRemaining <= 0
                          ? `AI cooldown active. Try again in ${aiCooldownSecondsLeft}s.`
                          : aiSelectionLimitReached
                            ? `AI auto-assign is limited to ${AI_MAX_FILES_PER_CALL} files per minute.`
                            : 'Automatically assign category based on your rules'
                      }
                    >
                      <span className="category-color auto-icon">
                        🤖
                      </span>
                      <span><strong>Auto</strong> (Use Rules)</span>
                    </button>
                    
                    <div className="category-dropdown-divider"></div>
                    
                    {/* Regular categories */}
                    {categories.map(category => (
                      <button
                        key={category.id}
                        className="category-dropdown-item"
                        style={{ '--hover-color': category.color } as React.CSSProperties}
                        onClick={() => assignToCategory(category.id)}
                        disabled={hasSelectedInReview}
                      >
                        <span style={{ backgroundColor: category.color }} className="category-color">
                          <i className={`fa-solid ${category.icon}`}></i>
                        </span>
                        <span>{category.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button className="bulk-action-btn secondary" onClick={handleBulkDownload} disabled={isAssigning}>
                <i className="fa-solid fa-download"></i>
                <span>Download Zip</span>
              </button>

              <button className="bulk-action-btn secondary" onClick={clearSelection} disabled={isAssigning}>
                <i className="fa-solid fa-xmark"></i>
                <span>Clear Selection</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      <div className="pagination-bar">
        <div className="pagination-left">
          <span className="pagination-info">
            Showing {filteredFiles.length === 0 ? 0 : startIndex + 1}-{Math.min(endIndex, filteredFiles.length)} of {filteredFiles.length}
          </span>
          <div className="items-per-page">
            <label className="items-label">Items per page:</label>
            <select 
              className="items-select"
              value={itemsPerPage}
              onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        </div>
        <div className="pagination-controls">
          <span 
            className={`pagination-link ${currentPage === 1 ? 'disabled' : ''}`}
            onClick={handlePreviousPage}
          >
            Previous
          </span>
          <span className="pagination-separator">|</span>
          <span className="page-indicator">
            <span className="page-text">Page </span>
            {totalPages > 1 ? (
              <select 
                className="page-select"
                value={currentPage}
                onChange={(e) => setCurrentPage(Number(e.target.value))}
              >
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
                  <option key={pageNum} value={pageNum}>{pageNum}</option>
                ))}
              </select>
            ) : (
              <span className="current-page-number">{currentPage}</span>
            )}
            {' '}of {paginationStatus || 1}
            {isLoadingMore && <span className="loading-more-indicator"> (loading...)</span>}
          </span>
          <span className="pagination-separator">|</span>
          <span 
            className={`pagination-link ${currentPage >= totalPages || totalPages === 0 ? 'disabled' : ''}`}
            onClick={handleNextPage}
          >
            Next
          </span>
        </div>
      </div>

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          fileId={previewFile.id}
          fileName={previewFile.name}
          mimeType={previewFile.mimeType}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
};

export default InboxPage;

