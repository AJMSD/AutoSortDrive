/**
 * User-Specific Cache Manager
 * 
 * Provides safe caching with automatic cleanup on logout.
 * All cached data is scoped to the current user to prevent data leakage.
 */

import { authStorage } from '@/utils/authStorage';

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  userId: string; // User email to prevent cross-user data leakage
  configVersion?: number; // TODO [CACHE-SYNC-4]: Track config version for cache invalidation
}

interface CacheOptions {
  ttl?: number; // Time-to-live in milliseconds (default: 5 minutes)
  configVersion?: number; // TODO [CACHE-SYNC-4]: Config version for staleness detection
}

class UserCache {
  private static STORAGE_PREFIX = 'autosortdrive_cache_';
  private static DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get current user ID from session storage
   */
  private getCurrentUserId(): string | null {
    try {
      return authStorage.getUserEmail();
    } catch (error) {
      console.error('Failed to get current user ID:', error);
      return null;
    }
  }

  /**
   * Generate cache key with user prefix
   */
  private getCacheKey(key: string, userId: string): string {
    return `${UserCache.STORAGE_PREFIX}${userId}_${key}`;
  }

  /**
   * Set cache data for current user
   */
  set<T>(key: string, data: T, options?: CacheOptions): boolean {
    const userId = this.getCurrentUserId();
    if (!userId) {
      console.warn('⚠️ No user logged in, cannot cache data');
      return false;
    }

    try {
      const cacheKey = this.getCacheKey(key, userId);
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        userId,
        configVersion: options?.configVersion, // TODO [CACHE-SYNC-4]: Store config version
      };

      sessionStorage.setItem(cacheKey, JSON.stringify(entry));
      console.log(`💾 Cached data for user: ${key} (${userId})${options?.configVersion ? ` [v${options.configVersion}]` : ''}`);
      return true;
    } catch (error) {
      console.error('Failed to set cache:', error);
      return false;
    }
  }

  /**
   * Get cache data for current user
   */
  get<T>(key: string, options?: CacheOptions): T | null {
    const userId = this.getCurrentUserId();
    if (!userId) {
      console.warn('⚠️ No user logged in, cannot retrieve cache');
      return null;
    }

    try {
      const cacheKey = this.getCacheKey(key, userId);
      const stored = sessionStorage.getItem(cacheKey);
      
      if (!stored) {
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(stored);

      // Verify cache belongs to current user (safety check)
      if (entry.userId !== userId) {
        console.warn('⚠️ Cache user mismatch, clearing stale cache');
        sessionStorage.removeItem(cacheKey);
        return null;
      }

      // TODO [CACHE-SYNC-4]: Check config version staleness
      // If caller provides a configVersion, verify cached data matches
      if (options?.configVersion !== undefined && entry.configVersion !== undefined) {
        if (entry.configVersion !== options.configVersion) {
          console.log(`🔄 Config version mismatch for ${key} (cached: v${entry.configVersion}, current: v${options.configVersion}), invalidating cache`);
          sessionStorage.removeItem(cacheKey);
          return null;
        }
      }

      // Check if cache is expired
      const ttl = options?.ttl ?? UserCache.DEFAULT_TTL;
      const age = Date.now() - entry.timestamp;
      
      if (age > ttl) {
        console.log(`🕐 Cache expired for ${key} (${Math.round(age / 1000)}s old, ttl: ${ttl / 1000}s)`);
        sessionStorage.removeItem(cacheKey);
        return null;
      }

      console.log(`📦 Cache hit for ${key} (${Math.round(age / 1000)}s old)${entry.configVersion ? ` [v${entry.configVersion}]` : ''}`);
      return entry.data;
    } catch (error) {
      console.error('Failed to get cache:', error);
      return null;
    }
  }

  /**
   * Remove specific cache entry for current user
   */
  remove(key: string): boolean {
    const userId = this.getCurrentUserId();
    if (!userId) return false;

    try {
      const cacheKey = this.getCacheKey(key, userId);
      sessionStorage.removeItem(cacheKey);
      console.log(`🗑️ Removed cache: ${key}`);
      return true;
    } catch (error) {
      console.error('Failed to remove cache:', error);
      return false;
    }
  }

  /**
   * Remove all cache entries for current user that start with a prefix
   */
  removeByPrefix(keyPrefix: string): void {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    try {
      const prefix = this.getCacheKey(keyPrefix, userId);
      const keysToRemove: string[] = [];

      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => sessionStorage.removeItem(key));
      console.log(`🗑️ Removed ${keysToRemove.length} cache entries for prefix: ${keyPrefix}`);
    } catch (error) {
      console.error('Failed to remove cache by prefix:', error);
    }
  }

  /**
   * Clear all cache for current user
   */
  clearUserCache(): void {
    const userId = this.getCurrentUserId();
    if (!userId) return;

    try {
      const prefix = `${UserCache.STORAGE_PREFIX}${userId}_`;
      const keysToRemove: string[] = [];

      // Find all keys for current user
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      // Remove them
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
      console.log(`🗑️ Cleared ${keysToRemove.length} cache entries for user: ${userId}`);
    } catch (error) {
      console.error('Failed to clear user cache:', error);
    }
  }

  /**
   * Clear ALL cached data (all users)
   * Use this on logout to ensure complete cleanup
   */
  clearAllCache(): void {
    try {
      const keysToRemove: string[] = [];

      // Find all cache keys (any user)
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(UserCache.STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }

      // Remove them
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
      console.log(`🗑️ Cleared ALL cache entries: ${keysToRemove.length} items`);
    } catch (error) {
      console.error('Failed to clear all cache:', error);
    }
  }

  /**
   * Check if cache exists and is valid for a key
   */
  has(key: string, options?: CacheOptions): boolean {
    return this.get(key, options) !== null;
  }
}

export const userCache = new UserCache();
