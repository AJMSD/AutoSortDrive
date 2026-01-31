/**
 * Optimistic Update Helper
 * 
 * Provides a generic wrapper for performing optimistic cache updates with automatic rollback.
 * 
 * How it works:
 * 1. Takes a snapshot of the current cache state
 * 2. Applies optimistic updates to the cache immediately
 * 3. Executes the API call in the background
 * 4. On success: keeps the optimistic updates (optionally reconciles with server response)
 * 5. On failure: restores the snapshot and surfaces the error
 * 
 * This creates a snappy, responsive UI while maintaining data consistency.
 */

import { cacheManager } from './cacheManager';
import toast from 'react-hot-toast';

// ============================================================================
// Types
// ============================================================================

export interface OptimisticUpdateOptions<TResult = any> {
  /**
   * Function that applies optimistic updates to the cache
   * Called immediately before the API call
   */
  optimisticUpdate: () => void;

  /**
   * The async API call to execute
   * Should return { success: boolean, error?: string, ... }
   */
  apiCall: () => Promise<TResult>;

  /**
   * Optional: Reconcile cache with server response after successful API call
   * Use this if the server returns updated data that differs from optimistic state
   */
  onSuccess?: (result: TResult) => void;

  /**
   * Optional: Custom error handler
   * Default behavior is to show a toast error
   */
  onError?: (error: Error | string) => void;

  /**
   * Optional: Additional cache keys to snapshot for rollback
   * The main files and review queue caches are always included
   */
  snapshotKeys?: string[];

  /**
   * Optional: Description for logging
   */
  description?: string;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Execute an operation with optimistic cache updates and automatic rollback on failure
 * 
 * @example
 * await withOptimisticUpdate({
 *   optimisticUpdate: () => {
 *     cacheManager.updateFileInCache(fileId, file => ({
 *       ...file,
 *       categoryId: 'cat_123',
 *       categorized: true
 *     }));
 *   },
 *   apiCall: () => unifiedClient.assignCategory(token, fileId, 'cat_123'),
 *   description: 'Assign file to category'
 * });
 */
export async function withOptimisticUpdate<TResult = any>(
  options: OptimisticUpdateOptions<TResult>
): Promise<TResult> {
  const {
    optimisticUpdate,
    apiCall,
    onSuccess,
    onError,
    snapshotKeys = [],
    description = 'Optimistic update',
  } = options;

  // 1. Create snapshot for rollback
  console.log(`📸 ${description}: Creating snapshot...`);
  const snapshot = cacheManager.createSnapshot(snapshotKeys);

  try {
    // 2. Apply optimistic update immediately
    console.log(`⚡ ${description}: Applying optimistic update...`);
    optimisticUpdate();

    // 3. Execute API call in background
    console.log(`📡 ${description}: Executing API call...`);
    const result = await apiCall();

    // 4. Check if API call succeeded
    // We expect results to have a `success` boolean property
    const apiResult = result as any;
    if (apiResult && apiResult.success === false) {
      // API call failed - rollback
      throw new Error(apiResult.error || 'API call failed');
    }

    // 5. Success! Optionally reconcile with server response
    if (onSuccess) {
      console.log(`✅ ${description}: Reconciling with server response...`);
      onSuccess(result);
    }

    console.log(`✅ ${description}: Completed successfully`);
    return result;

  } catch (error: any) {
    // 6. Failure - rollback to snapshot
    console.error(`❌ ${description}: Failed, rolling back...`, error);
    cacheManager.restoreSnapshot(snapshot);

    // 7. Handle error
    if (onError) {
      onError(error);
    } else {
      // Default error handling
      const message = error?.message || error?.toString() || 'Operation failed';
      toast.error(`Failed: ${message}`);
    }

    // Re-throw so caller can handle if needed
    throw error;
  }
}

/**
 * Helper: Execute multiple optimistic updates in parallel
 * Useful for bulk operations where each item can be updated independently
 * 
 * Note: If any operation fails, all will be rolled back to maintain consistency
 */
export async function withOptimisticUpdateBatch<TResult = any>(
  operations: OptimisticUpdateOptions<TResult>[]
): Promise<TResult[]> {
  // Create a single snapshot before all operations
  const snapshot = cacheManager.createSnapshot();

  try {
    // Apply all optimistic updates
    operations.forEach(op => {
      op.optimisticUpdate();
    });

    // Execute all API calls in parallel
    const results = await Promise.all(
      operations.map(op => op.apiCall())
    );

    // Check if any failed
    const failures = results.filter((r: any) => r?.success === false);
    if (failures.length > 0) {
      throw new Error(`${failures.length} operations failed`);
    }

    // Apply all success handlers
    operations.forEach((op, i) => {
      if (op.onSuccess) {
        op.onSuccess(results[i]);
      }
    });

    return results;

  } catch (error: any) {
    // Rollback on any failure
    console.error('❌ Batch operation failed, rolling back...', error);
    cacheManager.restoreSnapshot(snapshot);

    toast.error(`Batch operation failed: ${error.message}`);
    throw error;
  }
}
