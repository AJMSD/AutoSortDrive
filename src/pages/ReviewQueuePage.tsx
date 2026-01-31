import React, { useState, useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { useLocation } from 'react-router-dom';
import { userCache } from '@/utils/userCache';
import toast from 'react-hot-toast';
import Tooltip from '@/components/common/Tooltip';
import FileThumbnail from '@/components/common/FileThumbnail';
import FilePreviewModal from '@/components/common/FilePreviewModal';
import { appsScriptClient } from '@/lib/appsScriptClient';
import { downloadFilesAsZip } from '@/lib/bulkDownload';
import './ReviewQueuePage.css';

interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
}

interface ReviewFile {
  id: string;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  file?: {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    thumbnailLink?: string;
    iconLink?: string;
  };
  status: 'pending' | 'accepted' | 'rejected';
  suggestedCategoryId?: string;
  suggestedCategory?: Category;
  confidence?: number;
  reason?: string;
  source?: string;
}

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';
const isExcludedMimeType = (mimeType?: string) =>
  mimeType === FOLDER_MIME_TYPE || mimeType === SHORTCUT_MIME_TYPE;

const ReviewQueuePage: React.FC = () => {
  const location = useLocation();
  const refreshTriggered = useRef(false);
  const removeToastRef = useRef<{ id?: string; count: number; timers: ReturnType<typeof setTimeout>[] }>({
    count: 0,
    timers: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showManualDropdown, setShowManualDropdown] = useState<string | null>(null);
  const manualDropdownRef = useRef<HTMLDivElement | null>(null);
  const [removingFiles, setRemovingFiles] = useState<Set<string>>(new Set());
  const [rejectingFiles, setRejectingFiles] = useState<Set<string>>(new Set());
  const [animatedConfidence, setAnimatedConfidence] = useState<Map<string, number>>(new Map());
  const [categories, setCategories] = useState<Category[]>([]);
  const [reviewFiles, setReviewFiles] = useState<ReviewFile[]>([]);
  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
  const [showBulkCategoryDropdown, setShowBulkCategoryDropdown] = useState(false);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState(() => {
    const saved = localStorage.getItem('reviewItemsPerPage');
    return saved ? parseInt(saved, 10) : 25;
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [previewFile, setPreviewFile] = useState<{ id: string; name: string; mimeType: string } | null>(null);
  const [aiReasonModalFile, setAiReasonModalFile] = useState<ReviewFile | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<{
    fileId?: string;
    fileName?: string;
    suggestedCategoryId?: string | null;
    suggestedCategoryName?: string;
    chosenCategoryId?: string | null;
    chosenCategoryName?: string;
    source?: string;
  } | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  // Refresh when window becomes visible/focused
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        logger.debug('👁️ Review queue tab visible, refreshing...');
        loadData();
      }
    };

    const handleFocus = () => {
      logger.debug('🎯 Review queue window focused, refreshing...');
      loadData();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  const loadData = async (forceRefresh: boolean = false) => {
    setIsLoading(true);
    try {
      const CACHE_KEY = 'review_queue';
      const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
      const cachedConfigVersion = userCache.getConfigVersion();
      
      // Try cache first unless force refresh
      if (!forceRefresh) {
        const cachedQueue = userCache.get<ReviewFile[]>(CACHE_KEY, {
          ttl: CACHE_TTL,
          configVersion: cachedConfigVersion ?? undefined,
        });

        const inboxCache = userCache.get<any[]>('inbox_all_files', {
          configVersion: cachedConfigVersion ?? undefined,
        }) || [];
        const inboxHasInReview = inboxCache.some(file => file?.inReview);

        if (cachedQueue && cachedQueue.length >= 0) {
          if (cachedQueue.length == 0 && inboxHasInReview) {
            // Force refresh when inbox indicates review items but cache is empty
            forceRefresh = true;
          } else {
            const sanitizedQueue = cachedQueue.filter(item => {
              const mimeType = item.file?.mimeType || item.mimeType || '';
              return !isExcludedMimeType(mimeType);
            });
            if (sanitizedQueue.length !== cachedQueue.length) {
              userCache.set(CACHE_KEY, sanitizedQueue, {
                ttl: CACHE_TTL,
                configVersion: cachedConfigVersion ?? undefined,
              });
            }

            logger.debug('???? Using cached review queue:', sanitizedQueue.length, 'items');
            setReviewFiles(sanitizedQueue);
            
            // Animate confidence scores
            const confidenceMap = new Map<string, number>();
            sanitizedQueue.forEach((item: ReviewFile) => {
              if (item.confidence) {
                confidenceMap.set(item.id, item.confidence);
              }
            });
            setAnimatedConfidence(confidenceMap);
            setIsLoading(false);
            
            // Load categories in background
            const cachedCategories = userCache.get<Category[]>('categories', {
              configVersion: cachedConfigVersion ?? undefined,
            });
            if (cachedCategories) {
              setCategories(cachedCategories);
            } else {
              appsScriptClient.getCategories().then(res => {
                if (res.success) {
                  const configVersion =
                    typeof res.configVersion === 'number' && Number.isFinite(res.configVersion)
                      ? res.configVersion
                      : undefined;
                  if (configVersion !== undefined) {
                    userCache.setConfigVersion(configVersion);
                  }
                  setCategories(res.categories || []);
                  userCache.set('categories', res.categories || [], { configVersion });
                }
              });
            }
            return; // Use cached data
          }
        }
      }
      
      // Cache miss or force refresh - load from API
      logger.debug('🔄 Loading review queue from API...');
      const cachedCategories = userCache.get<Category[]>('categories', {
        configVersion: cachedConfigVersion ?? undefined,
      });
      
      // Load categories and review queue in parallel
      const [categoriesRes, queueRes] = await Promise.all([
        cachedCategories ? Promise.resolve({ success: true, categories: cachedCategories }) : appsScriptClient.getCategories(),
        appsScriptClient.getReviewQueue('pending')
      ]);

      if (categoriesRes.success) {
        setCategories(categoriesRes.categories || []);
        if (!cachedCategories) {
          const configVersion =
            typeof categoriesRes.configVersion === 'number' && Number.isFinite(categoriesRes.configVersion)
              ? categoriesRes.configVersion
              : undefined;
          if (configVersion !== undefined) {
            userCache.setConfigVersion(configVersion);
          }
          userCache.set('categories', categoriesRes.categories || [], { configVersion });
        }
      }

      if (queueRes.success) {
        const queueItems = (queueRes.queue || []).filter((item: ReviewFile) => {
          const mimeType = item.file?.mimeType || item.mimeType || '';
          return !isExcludedMimeType(mimeType);
        });
        setReviewFiles(queueItems);
        
        // Cache the review queue
        userCache.set(CACHE_KEY, queueItems, {
          ttl: CACHE_TTL,
          configVersion: cachedConfigVersion ?? undefined,
        });
        logger.debug('💾 Cached review queue:', queueItems.length, 'items');
        
        // Debug logging
        logger.debug('Review queue loaded - total items:', queueItems.length);
        if (queueItems.length > 0) {
          logger.debug('First review item:', queueItems[0]);
          logger.debug('First item file object:', queueItems[0].file);
        }
        
        // Animate confidence scores
        const confidenceMap = new Map<string, number>();
        queueItems.forEach((item: ReviewFile) => {
          if (item.confidence) {
            confidenceMap.set(item.id, item.confidence);
          }
        });
        setAnimatedConfidence(confidenceMap);
      } else {
        toast.error('Failed to load review queue');
      }
    } catch (error: any) {
      logger.error('Error loading data:', error);
      toast.error('Failed to load data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const shouldRefresh = (location.state as { refreshReviewQueue?: boolean } | null)?.refreshReviewQueue;
    if (shouldRefresh && !refreshTriggered.current) {
      refreshTriggered.current = true;
      loadData(true);
    }
  }, [location.state]);

  useEffect(() => {
    setCurrentPage(1);
  }, [reviewFiles.length, itemsPerPage]);

  useEffect(() => {
    setSelectedReviewIds(prev => {
      const next = new Set<string>();
      reviewFiles.forEach(file => {
        if (prev.has(file.id)) {
          next.add(file.id);
        }
      });
      return next;
    });
  }, [reviewFiles]);

  // Keyboard navigation: Escape to close dropdowns and modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (aiReasonModalFile) {
          setAiReasonModalFile(null);
        } else if (showFeedbackModal) {
          setShowFeedbackModal(false);
          setFeedbackDraft(null);
        } else if (showManualDropdown) {
          setShowManualDropdown(null);
        } else if (showBulkCategoryDropdown) {
          setShowBulkCategoryDropdown(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [aiReasonModalFile, showFeedbackModal, showManualDropdown, showBulkCategoryDropdown]);

  useEffect(() => {
    const handleClickAway = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (showManualDropdown && manualDropdownRef.current && target && !manualDropdownRef.current.contains(target)) {
        setShowManualDropdown(null);
      }
      if (showBulkCategoryDropdown && target && !(target as HTMLElement).closest('.category-dropdown-container')) {
        setShowBulkCategoryDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickAway);
    return () => document.removeEventListener('mousedown', handleClickAway);
  }, [showManualDropdown, showBulkCategoryDropdown]);

  useEffect(() => {
    return () => {
      const current = removeToastRef.current;
      current.timers.forEach(clearTimeout);
      current.timers = [];
      if (current.id) {
        toast.dismiss(current.id);
        current.id = undefined;
        current.count = 0;
      }
    };
  }, []);

  const showRemovedFromReviewToast = () => {
    const REMOVE_TOAST_DURATION = 4000;
    const ref = removeToastRef.current;
    ref.count += 1;

    const renderToast = () => (
      <div className="toast-panel toast-content review-toast-aggregate">
        {ref.count > 1 && <span className="review-toast-count">{ref.count}</span>}
        <div className="toast-text">Removed from review queue</div>
      </div>
    );

    if (!ref.id) {
      ref.id = toast.custom(() => renderToast(), {
        duration: Infinity,
      });
    } else {
      toast.custom(() => renderToast(), {
        id: ref.id,
        duration: Infinity,
      });
    }

    const timer = setTimeout(() => {
      const current = removeToastRef.current;
      current.count = Math.max(0, current.count - 1);
      if (current.count <= 0) {
        if (current.id) {
          toast.dismiss(current.id);
        }
        current.id = undefined;
        current.timers = [];
        return;
      }
      if (current.id) {
        toast.custom(() => renderToast(), { id: current.id, duration: Infinity });
      }
    }, REMOVE_TOAST_DURATION);

    ref.timers.push(timer);
  };

  const toggleReviewSelection = (id: string) => {
    setSelectedReviewIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAllReviewSelection = () => {
    setSelectedReviewIds(prev => {
      if (reviewFiles.length > 0 && prev.size === reviewFiles.length) {
        return new Set();
      }
      return new Set(reviewFiles.map(file => file.id));
    });
  };

  const clearReviewSelection = () => {
    setSelectedReviewIds(new Set());
  };

  const buildSkippedToast = (label: string, skipped: string[]) => {
    if (skipped.length === 0) return;
    const maxNames = 3;
    const shown = skipped.slice(0, maxNames).join(', ');
    const remaining = skipped.length > maxNames ? ` +${skipped.length - maxNames} more` : '';
    toast(`${label}: ${shown}${remaining}`);
  };

  const bulkAssignToCategory = async (categoryId: string) => {
    if (isBulkProcessing) return;
    const selectedFiles = reviewFiles.filter(file => selectedReviewIds.has(file.id));
    if (selectedFiles.length === 0) return;

    setIsBulkProcessing(true);
    setShowBulkCategoryDropdown(false);
    setRemovingFiles(prev => {
      const next = new Set(prev);
      selectedFiles.forEach(file => next.add(file.id));
      return next;
    });

    const failed: string[] = [];
    const succeededIds: string[] = [];

    for (const file of selectedFiles) {
      const response = await appsScriptClient.reviewOverride(categoryId, file.id, file.fileId);
      if (response.success) {
        succeededIds.push(file.id);
      } else {
        failed.push(file.file?.name || file.fileName || file.id);
      }
    }

    if (succeededIds.length > 0) {
      setReviewFiles(prev => prev.filter(file => !succeededIds.includes(file.id)));
    }

    setRemovingFiles(prev => {
      const next = new Set(prev);
      selectedFiles.forEach(file => next.delete(file.id));
      return next;
    });
    clearReviewSelection();
    setIsBulkProcessing(false);

    if (succeededIds.length > 0) {
      toast.success(`Assigned ${succeededIds.length} file${succeededIds.length > 1 ? 's' : ''}`);
    }
    buildSkippedToast('Failed to assign', failed);
  };

  const bulkAcceptSuggestions = async () => {
    if (isBulkProcessing) return;
    const selectedFiles = reviewFiles.filter(file => selectedReviewIds.has(file.id));
    if (selectedFiles.length === 0) return;

    const withSuggestions = selectedFiles.filter(file => file.suggestedCategoryId || file.suggestedCategory?.id);
    const skipped = selectedFiles.filter(file => !(file.suggestedCategoryId || file.suggestedCategory?.id));

    if (withSuggestions.length === 0) {
      buildSkippedToast('Skipped (no AI suggestion). Try manual', skipped.map(file => file.file?.name || file.fileName || file.id));
      return;
    }

    setIsBulkProcessing(true);
    setRemovingFiles(prev => {
      const next = new Set(prev);
      withSuggestions.forEach(file => next.add(file.id));
      return next;
    });

    const failed: string[] = [];
    const succeededIds: string[] = [];

    for (const file of withSuggestions) {
      const response = await appsScriptClient.reviewAccept(file.id, file.fileId);
      if (response.success) {
        succeededIds.push(file.id);
      } else {
        failed.push(file.file?.name || file.fileName || file.id);
      }
    }

    if (succeededIds.length > 0) {
      setReviewFiles(prev => prev.filter(file => !succeededIds.includes(file.id)));
    }

    setRemovingFiles(prev => {
      const next = new Set(prev);
      withSuggestions.forEach(file => next.delete(file.id));
      return next;
    });
    clearReviewSelection();
    setIsBulkProcessing(false);

    if (succeededIds.length > 0) {
      toast.success(`Auto-assigned ${succeededIds.length} file${succeededIds.length > 1 ? 's' : ''}`);
    }

    if (skipped.length > 0) {
      buildSkippedToast('Skipped (no AI suggestion). Try manual', skipped.map(file => file.file?.name || file.fileName || file.id));
    }
    buildSkippedToast('Failed to assign', failed);
  };

  const bulkSkip = async () => {
    if (isBulkProcessing) return;
    const selectedFiles = reviewFiles.filter(file => selectedReviewIds.has(file.id));
    if (selectedFiles.length === 0) return;

    setIsBulkProcessing(true);
    setRejectingFiles(prev => {
      const next = new Set(prev);
      selectedFiles.forEach(file => next.add(file.id));
      return next;
    });

    const failed: string[] = [];
    const succeededIds: string[] = [];

    for (const file of selectedFiles) {
      const response = await appsScriptClient.reviewSkip(file.id, file.fileId);
      if (response.success) {
        succeededIds.push(file.id);
      } else {
        failed.push(file.file?.name || file.fileName || file.id);
      }
    }

    if (succeededIds.length > 0) {
      setReviewFiles(prev => prev.filter(file => !succeededIds.includes(file.id)));
    }

    setRejectingFiles(prev => {
      const next = new Set(prev);
      selectedFiles.forEach(file => next.delete(file.id));
      return next;
    });
    clearReviewSelection();
    setIsBulkProcessing(false);

    if (succeededIds.length > 0) {
      toast.success(`Skipped ${succeededIds.length} file${succeededIds.length > 1 ? 's' : ''}`);
    }
    buildSkippedToast('Failed to skip', failed);
  };

  const handleBulkDownload = async () => {
    const selectedFiles = reviewFiles.filter(file => selectedReviewIds.has(file.id));
    if (selectedFiles.length === 0) return;

    clearReviewSelection();

    await downloadFilesAsZip(
      selectedFiles.map(file => ({
        id: file.file?.id || file.fileId,
        name: file.file?.name || file.fileName || 'file',
        mimeType: file.file?.mimeType || file.mimeType,
      }))
    );
  };


  // Helper function to get file type from mimeType
  const getFileType = (mimeType?: string): string => {
    if (!mimeType) return 'other';
    if (mimeType.includes('document')) return 'document';
    if (mimeType.includes('image')) return 'image';
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('spreadsheet')) return 'sheet';
    if (mimeType.includes('presentation')) return 'slide';
    if (mimeType.includes('video')) return 'video';
    return 'other';
  };

  // Helper function to get status badge
  const getStatusBadge = (file: ReviewFile) => {
    const source = (file.source || '').toLowerCase();
    if (source === 'rules' || source === 'rule-based') {
      return 'rules-low';
    } else if (source === 'ai') {
      return 'ai-suggested';
    }
    return 'unmatched';
  };

  const handleRejectSuggestion = async (file: ReviewFile) => {
    setRejectingFiles(prev => new Set(prev).add(file.id));
    
    try {
      // Optimistic update is handled automatically by appsScriptClient
      const response = await appsScriptClient.reviewSkip(file.id, file.fileId);
      
      if (response.success) {
        // No need to invalidate caches - optimistic update already handled it
        setTimeout(() => {
          setReviewFiles(prev => prev.filter(f => f.id !== file.id));
          setRejectingFiles(prev => {
            const next = new Set(prev);
            next.delete(file.id);
            return next;
          });
        }, 200);
        
        showRemovedFromReviewToast();
      } else {
        toast.error('Failed to skip review: ' + response.error);
        setRejectingFiles(prev => {
          const next = new Set(prev);
          next.delete(file.id);
          return next;
        });
      }
    } catch (error: any) {
      logger.error('Error skipping review:', error);
      setRejectingFiles(prev => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    }
  };

  const handleManualAssign = async (file: ReviewFile, categoryId: string) => {
    setShowManualDropdown(null);
    setRemovingFiles(prev => new Set(prev).add(file.id));
    
    try {
      // Optimistic update is handled automatically by appsScriptClient
      const response = await appsScriptClient.reviewOverride(categoryId, file.id, file.fileId);
      
      if (response.success) {
        // No need to invalidate caches - optimistic update already handled it
        setTimeout(() => {
          setReviewFiles(prev => prev.filter(f => f.id !== file.id));
          setRemovingFiles(prev => {
            const next = new Set(prev);
            next.delete(file.id);
            return next;
          });
        }, 300);
        
        const category = categories.find(c => c.id === categoryId);
        const fileName = file.file?.name || file.fileName || 'file';
        toast.success(`Assigned ${fileName} to ${category?.name || 'category'}`);

        const suggestedCategoryId = file.suggestedCategoryId || file.suggestedCategory?.id || null;
        if (suggestedCategoryId && suggestedCategoryId !== categoryId) {
          const suggestedCategoryName =
            file.suggestedCategory?.name ||
            categories.find(c => c.id === suggestedCategoryId)?.name;
          const chosenCategoryName = categories.find(c => c.id === categoryId)?.name;

          setFeedbackDraft({
            fileId: file.fileId,
            fileName,
            suggestedCategoryId,
            suggestedCategoryName,
            chosenCategoryId: categoryId,
            chosenCategoryName,
            source: file.source || 'review',
          });
          setShowFeedbackModal(true);
        }
      } else {
        toast.error('Failed to assign category: ' + response.error);
        setRemovingFiles(prev => {
          const next = new Set(prev);
          next.delete(file.id);
          return next;
        });
      }
    } catch (error: any) {
      logger.error('Error assigning category:', error);
      setRemovingFiles(prev => {
        const next = new Set(prev);
        next.delete(file.id);
        return next;
      });
    }
  };

  const totalPages = Math.ceil(reviewFiles.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedReviewFiles = reviewFiles.slice(startIndex, endIndex);

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
    localStorage.setItem('reviewItemsPerPage', String(newValue));
    setCurrentPage(1);
  };

  const handleSaveFeedback = async () => {
    if (!feedbackDraft) {
      setShowFeedbackModal(false);
      return;
    }

    setIsSavingFeedback(true);
    try {
      const response = await appsScriptClient.addAiSuggestionFeedback({
        fileId: feedbackDraft.fileId,
        fileName: feedbackDraft.fileName,
        suggestedCategoryId: feedbackDraft.suggestedCategoryId,
        suggestedCategoryName: feedbackDraft.suggestedCategoryName,
        chosenCategoryId: feedbackDraft.chosenCategoryId,
        chosenCategoryName: feedbackDraft.chosenCategoryName,
        source: feedbackDraft.source,
      });

      if (response.success) {
        toast.success('Feedback saved');
      } else {
        toast.error(response.error || 'Failed to save feedback');
      }
    } catch (error: any) {
      toast.error('Failed to save feedback: ' + error.message);
    } finally {
      setIsSavingFeedback(false);
      setShowFeedbackModal(false);
      setFeedbackDraft(null);
    }
  };

  const handleCloseFeedbackModal = () => {
    if (isSavingFeedback) {
      return;
    }
    setShowFeedbackModal(false);
    setFeedbackDraft(null);
  };

  return (
    <div className="review-queue-page">
      <div className="page-header"></div>

      {/* Review Files List */}
      <div className="review-files-section">
        {isLoading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading review queue...</p>
          </div>
        ) : reviewFiles.length === 0 ? (
          <div className="empty-queue">
            <div className="empty-icon"><i className="fa-solid fa-face-laugh-beam"></i></div>
            <h3>No files pending review</h3>
            <p>All files have been categorized or no files match review criteria</p>
          </div>
        ) : (
          <div className="review-file-list">
            {/* Column Headers */}
            <div className="review-file-list-header">
              <span className="review-header-checkbox">
                <input
                  type="checkbox"
                  checked={reviewFiles.length > 0 && selectedReviewIds.size === reviewFiles.length}
                  onChange={toggleAllReviewSelection}
                />
              </span>
              <span className="review-header-file">File</span>
              <span className="review-header-modified">Modified</span>
              <span className="review-header-type">Type</span>
              <span className="review-header-status">Status</span>
              <span className="review-header-suggestion">Suggestion</span>
              <span className="review-header-actions">Actions</span>
            </div>

            {paginatedReviewFiles.map((file, index) => {
              const status = getStatusBadge(file);
              const suggestedCategory =
                file.suggestedCategory ||
                categories.find(category => category.id === file.suggestedCategoryId);
              const isRemoving = removingFiles.has(file.id);
              const isRejecting = rejectingFiles.has(file.id);
              const canShowAiReason = status === 'ai-suggested' && !!file.reason;

              return (
                <div
                  key={file.id}
                  className={`review-file-row ${
                    isRemoving ? 'removing' : ''
                  } ${
                    isRejecting ? 'rejecting' : ''
                  }`}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="file-checkbox-container">
                    <input
                      type="checkbox"
                      className="file-checkbox"
                      checked={selectedReviewIds.has(file.id)}
                      disabled={isRemoving || isRejecting || isBulkProcessing}
                      onChange={() => toggleReviewSelection(file.id)}
                    />
                  </div>

                  <div className="file-info">
                    <FileThumbnail
                      thumbnailLink={file.file?.thumbnailLink}
                      iconLink={file.file?.iconLink}
                      mimeType={file.file?.mimeType || ''}
                      fileName={file.file?.name || file.fileName || 'Unknown'}
                      size="small"
                    />
                    <div className="file-details">
                      <div 
                        className="file-name clickable"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (file.file) {
                            setPreviewFile({
                              id: file.file.id,
                              name: file.file.name,
                              mimeType: file.file.mimeType
                            });
                          }
                        }}
                      >
                        {file.file?.name || file.fileName || 'Unknown'}
                      </div>
                    </div>
                  </div>

                  <div className="file-modified-column">
                    {file.file?.modifiedTime && (
                      <span className="file-modified-badge">
                        {new Date(file.file.modifiedTime).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <div className="file-type-column">
                    <span className="file-type-badge">{getFileType(file.file?.mimeType)}</span>
                  </div>

                  <div className="status-badge-wrapper">
                    <span className={`status-badge ${status}`}>
                      {status === 'rules-low' && <><i className="fa-solid fa-ruler"></i> Rules - Low Confidence</>}
                      {status === 'ai-suggested' && <><i className="fa-solid fa-robot"></i> AI - Suggested</>}
                      {status === 'unmatched' && 'Unmatched'}
                    </span>
                  </div>

                  <div className="suggestion-info">
                    {suggestedCategory ? (
                      <>
                        <div className="suggested-category">
                          {canShowAiReason ? (
                            <Tooltip content="View AI reason" position="top">
                              <button
                                type="button"
                                className="suggestion-badge-button"
                                onClick={() => setAiReasonModalFile(file)}
                              >
                                <span
                                  className="status-badge suggestion-badge"
                                  style={{ backgroundColor: suggestedCategory.color }}
                                >
                                  <span className="category-icon"><i className={`fa-solid ${suggestedCategory.icon}`}></i></span>
                                  <span>{suggestedCategory.name}</span>
                                </span>
                              </button>
                            </Tooltip>
                          ) : (
                            <span
                              className="status-badge suggestion-badge"
                              style={{ backgroundColor: suggestedCategory.color }}
                            >
                              <span className="category-icon"><i className={`fa-solid ${suggestedCategory.icon}`}></i></span>
                              <span>{suggestedCategory.name}</span>
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="no-suggestion-badge no-suggestion-button"
                        title="AI returned no suggestion"
                      >
                        No Suggestion
                      </button>
                    )}
                  </div>

                  <div className="file-actions">
                    <Tooltip content="Reject/Skip" position="top">
                      <i
                        className="fa-solid fa-xmark action-icon reject"
                        onClick={() => handleRejectSuggestion(file)}
                        style={{ cursor: isRemoving || isRejecting ? 'not-allowed' : 'pointer', opacity: isRemoving || isRejecting ? 0.5 : 1 }}
                      ></i>
                    </Tooltip>

                    <div className="manual-assign-container" ref={showManualDropdown === file.id ? manualDropdownRef : undefined}>
                      <Tooltip content="Assign manually" position="top">
                        <i
                          className="fa-solid fa-layer-group action-icon manual"
                          onClick={() =>
                            setShowManualDropdown(
                              showManualDropdown === file.id ? null : file.id
                            )
                          }
                          style={{ cursor: 'pointer' }}
                        ></i>
                      </Tooltip>

                      {showManualDropdown === file.id && (
                        <div className="manual-dropdown">
                          <div className="dropdown-header">Assign to:</div>
                          {status === 'ai-suggested' && suggestedCategory && (
                            <>
                              <button
                                className="category-option ai-suggestion-option"
                                onClick={() => handleManualAssign(file, suggestedCategory.id)}
                                style={{ borderLeft: `3px solid ${suggestedCategory.color}` }}
                              >
                                <span className="option-icon"><i className="fa-solid fa-robot"></i></span>
                                <span className="option-name">AI suggestion: {suggestedCategory.name}</span>
                              </button>
                              <div className="manual-dropdown-divider"></div>
                            </>
                          )}
                          {categories.map((category) => (
                            <button
                              key={category.id}
                              className="category-option"
                              onClick={() => handleManualAssign(file, category.id)}
                              style={{
                                borderLeft: `3px solid ${category.color}`,
                              }}
                            >
                              <span className="option-icon"><i className={`fa-solid ${category.icon}`}></i></span>
                              <span className="option-name">{category.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk Actions Bar */}
      {selectedReviewIds.size > 0 && (
        <div className="bulk-actions-bar" onClick={(e) => e.stopPropagation()}>
          <div className="bulk-actions-content">
            <span className="selected-count">
              {selectedReviewIds.size} file{selectedReviewIds.size > 1 ? 's' : ''} selected
            </span>

            <div className="bulk-actions-buttons">
              <div className="category-dropdown-container">
                <button
                  className="bulk-action-btn primary"
                  onClick={() => setShowBulkCategoryDropdown(!showBulkCategoryDropdown)}
                  disabled={isBulkProcessing}
                >
                  <i className="fa-solid fa-layer-group action-icon manual bulk-action-icon"></i>
                  <span>{isBulkProcessing ? 'Assigning...' : 'Assign to Category'}</span>
                </button>

                {showBulkCategoryDropdown && !isBulkProcessing && (
                  <div className="category-dropdown">
                    {categories.map(category => (
                      <button
                        key={category.id}
                        className="category-dropdown-item"
                        style={{ '--hover-color': category.color } as React.CSSProperties}
                        onClick={() => bulkAssignToCategory(category.id)}
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

              <button
                className="bulk-action-btn primary"
                onClick={bulkAcceptSuggestions}
                disabled={isBulkProcessing}
              >
                <i className="fa-solid fa-robot"></i>
                <span>Assign AI Suggestions</span>
              </button>

              <button
                className="bulk-action-btn secondary"
                onClick={bulkSkip}
                disabled={isBulkProcessing}
              >
                <span>Skip Selected</span>
              </button>

              <button
                className="bulk-action-btn secondary"
                onClick={handleBulkDownload}
                disabled={isBulkProcessing}
              >
                <i className="fa-solid fa-download"></i>
                <span>Download Zip</span>
              </button>

              <button
                className="bulk-action-btn secondary"
                onClick={clearReviewSelection}
                disabled={isBulkProcessing}
              >
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
            Showing {reviewFiles.length === 0 ? 0 : startIndex + 1}-{Math.min(endIndex, reviewFiles.length)} of {reviewFiles.length}
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
            {' '}of {totalPages || 1}
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

      {previewFile && (
        <FilePreviewModal
          fileId={previewFile.id}
          fileName={previewFile.name}
          mimeType={previewFile.mimeType}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {aiReasonModalFile && (
        <>
          <div
            className="modal-backdrop"
            onClick={() => setAiReasonModalFile(null)}
          />
          <div
            className="ai-reason-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-reason-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="ai-reason-header">
              <div>
                <h3 id="ai-reason-title">AI Reason</h3>
                <p className="ai-reason-subtitle">
                  {aiReasonModalFile.file?.name || aiReasonModalFile.fileName || 'Unknown file'}
                </p>
                <span className="ai-reason-confidence">
                  Confidence: {Math.round((animatedConfidence.get(aiReasonModalFile.id) || aiReasonModalFile.confidence || 0) * 100)}%
                </span>
              </div>
              <button
                className="ai-reason-close"
                type="button"
                onClick={() => setAiReasonModalFile(null)}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="ai-reason-body">
              <p>{aiReasonModalFile.reason || 'No reason provided.'}</p>
            </div>
            <div className="ai-reason-actions">
              <button
                className="modal-btn btn-cancel"
                type="button"
                onClick={() => setAiReasonModalFile(null)}
              >
                Close
              </button>
            </div>
          </div>
        </>
      )}

      {showFeedbackModal && feedbackDraft && (
        <>
          <div
            className="modal-backdrop"
            onClick={handleCloseFeedbackModal}
          />
          <div
            className="feedback-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="feedback-header">
              <div>
                <h3 id="feedback-title">AI Feedback</h3>
                <p className="feedback-subtitle">
                  {feedbackDraft.fileName || 'File'} was assigned to a different category.
                </p>
              </div>
              <button
                className="feedback-close"
                type="button"
                onClick={handleCloseFeedbackModal}
                disabled={isSavingFeedback}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div className="feedback-body">
              <div className="feedback-row">
                <span className="feedback-label">AI suggested</span>
                <span className="feedback-pill">
                  {feedbackDraft.suggestedCategoryName || 'Unknown'}
                </span>
              </div>
              <div className="feedback-row">
                <span className="feedback-label">You chose</span>
                <span className="feedback-pill">
                  {feedbackDraft.chosenCategoryName || 'Unknown'}
                </span>
              </div>
              <p className="feedback-note">
                Saving this helps improve future suggestions.
              </p>
            </div>
            <div className="feedback-actions">
              <button
                className="modal-btn btn-cancel"
                type="button"
                onClick={handleCloseFeedbackModal}
                disabled={isSavingFeedback}
              >
                Not now
              </button>
              <button
                className="modal-btn btn-accept"
                type="button"
                onClick={handleSaveFeedback}
                disabled={isSavingFeedback}
              >
                {isSavingFeedback ? 'Saving...' : 'Save feedback'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );

};

export default ReviewQueuePage;
