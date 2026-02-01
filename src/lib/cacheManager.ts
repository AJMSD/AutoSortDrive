/**
 * Centralized Cache Manager
 * 
 * Provides type-safe, centralized access to all caches in the application.
 * Supports optimistic updates with snapshot/restore for rollback.
 * 
 * Design principles:
 * - Single source of truth: inbox_all_files contains all file metadata
 * - Derived views: category and review caches are derived from inbox cache when possible
 * - Atomic updates: All cache modifications go through this manager
 * - Rollback support: Snapshots enable clean rollback on API failures
 */

import { userCache } from '@/utils/userCache';
import { logger } from '@/utils/logger';

// ============================================================================
// Types
// ============================================================================

export interface FileItem {
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
}

export interface ReviewItem {
  id: string;
  fileId: string;
  fileName?: string;
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
  suggestedCategory?: any;
  confidence?: number;
  reason?: string;
  source?: string;
}

export interface CacheSnapshot {
  inbox_all_files?: FileItem[];
  review_queue?: ReviewItem[];
  category_caches?: Record<string, any>;
  timestamp: number;
}

// ============================================================================
// Cache Keys
// ============================================================================

const CACHE_KEYS = {
  INBOX_FILES: 'inbox_all_files',
  REVIEW_QUEUE: 'review_queue',
  CATEGORIES: 'categories',
  categoryFiles: (categoryId: string) => `category_files_${categoryId}`,
};

// ============================================================================
// CacheManager Class
// ============================================================================

class CacheManager {
  private getCurrentConfigVersion(): number | undefined {
    const version = userCache.getConfigVersion();
    return typeof version === 'number' ? version : undefined;
  }

  /**
   * Get all files from inbox cache (single source of truth)
   */
  getFilesCache(): FileItem[] {
    return userCache.get<FileItem[]>(CACHE_KEYS.INBOX_FILES) || [];
  }

  /**
   * Set all files in inbox cache
   */
  setFilesCache(files: FileItem[], options?: { configVersion?: number }): void {
    const configVersion =
      typeof options?.configVersion === 'number' ? options.configVersion : this.getCurrentConfigVersion();
    userCache.set(CACHE_KEYS.INBOX_FILES, files, { ...options, configVersion });
  }

  /**
   * Update a single file in the cache
   * Uses an updater function to transform the file
   */
  updateFileInCache(fileId: string, updater: (file: FileItem) => FileItem): FileItem | null {
    const files = this.getFilesCache();
    const fileIndex = files.findIndex(f => f.id === fileId);
    
    if (fileIndex === -1) {
      logger.warn(`⚠️ File ${fileId} not found in cache`);
      return null;
    }

    const updatedFile = updater(files[fileIndex]);
    files[fileIndex] = updatedFile;
    
    this.setFilesCache(files);
    logger.debug(`✅ Updated file in cache:`, fileId);
    
    return updatedFile;
  }

  /**
   * Update multiple files in the cache
   * More efficient than calling updateFileInCache multiple times
   */
  updateFilesInCache(updates: Array<{ fileId: string; updater: (file: FileItem) => FileItem }>): FileItem[] {
    const files = this.getFilesCache();
    const updatedFiles: FileItem[] = [];
    
    updates.forEach(({ fileId, updater }) => {
      const fileIndex = files.findIndex(f => f.id === fileId);
      if (fileIndex !== -1) {
        files[fileIndex] = updater(files[fileIndex]);
        updatedFiles.push(files[fileIndex]);
      } else {
        logger.warn(`⚠️ File ${fileId} not found in cache`);
      }
    });
    
    this.setFilesCache(files);
    logger.debug(`✅ Updated ${updatedFiles.length} files in cache`);
    
    return updatedFiles;
  }

  /**
   * Get review queue from cache
   */
  getReviewQueueCache(): ReviewItem[] {
    return userCache.get<ReviewItem[]>(CACHE_KEYS.REVIEW_QUEUE) || [];
  }

  /**
   * Set review queue in cache
   */
  setReviewQueueCache(items: ReviewItem[]): void {
    const configVersion = this.getCurrentConfigVersion();
    userCache.set(CACHE_KEYS.REVIEW_QUEUE, items, { ttl: 2 * 60 * 1000, configVersion }); // 2 min TTL
  }

  /**
   * Add item to review queue cache
   */
  addToReviewQueueCache(item: ReviewItem): void {
    const queue = this.getReviewQueueCache();
    
    // Check if already exists
    const existingIndex = queue.findIndex(q => q.fileId === item.fileId);
    if (existingIndex >= 0) {
      queue[existingIndex] = item;
    } else {
      queue.push(item);
    }
    
    this.setReviewQueueCache(queue);
    logger.debug(`✅ Added/updated item in review queue:`, item.fileId);
  }

  /**
   * Remove item from review queue cache
   */
  removeFromReviewQueueCache(fileId: string): void {
    const queue = this.getReviewQueueCache();
    const filtered = queue.filter(item => item.fileId !== fileId);
    
    this.setReviewQueueCache(filtered);
    logger.debug(`✅ Removed item from review queue:`, fileId);
  }

  /**
   * Invalidate category-specific cache
   */
  invalidateCategoryCache(categoryId: string): void {
    userCache.remove(CACHE_KEYS.categoryFiles(categoryId));
    logger.debug(`🗑️ Invalidated category cache:`, categoryId);
  }

  /**
   * Invalidate review queue cache
   */
  invalidateReviewQueueCache(): void {
    userCache.remove(CACHE_KEYS.REVIEW_QUEUE);
    logger.debug('Invalidated review queue cache');
  }

  /**
   * Invalidate all category caches
   */
  invalidateAllCategoryCaches(): void {
    // This is a bit brute-force, but necessary for bulk operations
    // In the future, we could track which category caches exist
    userCache.remove('categories');
    userCache.removeByPrefix('category_files_');
    logger.debug(`🗑️ Invalidated all category caches`);
  }

  /**
   * Create a snapshot of current cache state for rollback
   */
  createSnapshot(keys: string[] = []): CacheSnapshot {
    const snapshot: CacheSnapshot = {
      timestamp: Date.now(),
    };

    // Always snapshot the main files cache
    const files = this.getFilesCache();
    if (files.length > 0) {
      snapshot.inbox_all_files = JSON.parse(JSON.stringify(files));
    }

    // Snapshot review queue
    const queue = this.getReviewQueueCache();
    if (queue.length > 0) {
      snapshot.review_queue = JSON.parse(JSON.stringify(queue));
    }

    // Snapshot specific category caches if requested
    if (keys.length > 0) {
      snapshot.category_caches = {};
      keys.forEach(key => {
        const cached = userCache.get(key);
        if (cached) {
          snapshot.category_caches![key] = JSON.parse(JSON.stringify(cached));
        }
      });
    }

    logger.debug('📸 Created cache snapshot:', {
      files: snapshot.inbox_all_files?.length || 0,
      queue: snapshot.review_queue?.length || 0,
      categories: Object.keys(snapshot.category_caches || {}).length,
    });

    return snapshot;
  }

  /**
   * Restore cache state from a snapshot (rollback)
   */
  restoreSnapshot(snapshot: CacheSnapshot): void {
    logger.debug('🔄 Restoring cache from snapshot...');

    if (snapshot.inbox_all_files) {
      this.setFilesCache(snapshot.inbox_all_files);
    }

    if (snapshot.review_queue) {
      this.setReviewQueueCache(snapshot.review_queue);
    }

    if (snapshot.category_caches) {
      Object.entries(snapshot.category_caches).forEach(([key, value]) => {
        userCache.set(key, value);
      });
    }

    logger.debug('✅ Cache restored from snapshot');
  }

  /**
   * Update category count in categories cache
   * This is a lightweight alternative to invalidating the entire cache
   */
  updateCategoryCount(categoryId: string, delta: number): void {
    const categories = userCache.get<any[]>(CACHE_KEYS.CATEGORIES);
    if (!categories || !Array.isArray(categories)) {
      logger.warn('⚠️ Categories cache not found');
      return;
    }

    const updated = categories.map(cat =>
      cat.id === categoryId
        ? { ...cat, fileCount: Math.max(0, (cat.fileCount || 0) + delta) }
        : cat
    );

    const configVersion = this.getCurrentConfigVersion();
    userCache.set(CACHE_KEYS.CATEGORIES, updated, { configVersion });
    logger.debug(`✅ Updated category count: ${categoryId} (${delta > 0 ? '+' : ''}${delta})`);
  }

  /**
   * Clear all caches (useful for logout or hard refresh)
   */
  clearAll(): void {
    userCache.clearUserCache();
    logger.debug('🗑️ Cleared all caches');
  }
}

export const cacheManager = new CacheManager();
