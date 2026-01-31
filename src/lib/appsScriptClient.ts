import { unifiedClient } from '@/lib/unifiedClient';
import { authStorage } from '@/utils/authStorage';

/**
 * Apps Script API Client
 * 
 * UPDATED: Now uses Drive API + Config Manager for multi-user support
 * Apps Script backend is optional (can be used for AI features later)
 * 
 * This wrapper maintains API compatibility while switching to direct Drive API calls.
 * All file operations now use user's OAuth token to access their Drive directly.
 */
class AppsScriptClient {
  constructor() {
    // No axios client needed - all calls go through unifiedClient
  }

  /**
   * Get user's access token from localStorage
   */
  private getAccessToken(): string | null {
    try {
      return authStorage.getAccessToken();
    } catch (error) {
      console.error('Failed to get access token:', error);
      return null;
    }
  }

  /**
   * Test connection - now tests Drive API access
   */
  async testConnection(): Promise<{ success: boolean; message: string; data?: any }> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return {
        success: false,
        message: 'No access token found. Please sign in.',
      };
    }

    try {
      // Test by initializing config
      const result = await unifiedClient.initialize(accessToken);
      return {
        success: result.success,
        message: result.success ? 'Connected to Drive API' : result.error || 'Connection failed',
        data: result.config,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Connection failed',
      };
    }
  }

  /**
   * Initialize config for current user
   */
  async initializeConfig(): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.initialize(accessToken);
  }

  /**
   * List files with filters - now uses Drive API directly
   */
  async listFiles(params?: {
    cursor?: string;
    pageSize?: number;
    filters?: any;
  }): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token', files: [] };
    }

    return await unifiedClient.listFiles(accessToken, {
      pageToken: params?.cursor,
      pageSize: params?.pageSize,
      query: params?.filters?.query,
    });
  }

  /**
   * Assign a category to a file
   * Now uses optimistic updates for instant UI feedback
   */
  async assignCategory(fileId: string, categoryId: string | null): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    // Use optimistic version by default
    return await unifiedClient.assignCategoryOptimistic(accessToken, fileId, categoryId);
  }

  /**
   * Assign categories to multiple files at once
   * Now uses optimistic updates for instant UI feedback
   */
  async assignCategoriesBulk(assignments: Array<{ fileId: string; categoryId: string | null }>): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    // Use optimistic version by default
    return await unifiedClient.assignCategoriesBulkOptimistic(accessToken, assignments);
  }

  /**
   * Get all categories (with caching)
   */
  async getCategories(_bypassCache: boolean = false): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token', categories: [] };
    }

    return await unifiedClient.getCategories(accessToken);
  }

  async getSettings(): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token', settings: null };
    }

    return await unifiedClient.getSettings(accessToken);
  }

  async updateSettings(settings: {
    aiEnabled?: boolean;
    aiPrimary?: boolean;
    aiUseRulesFallback?: boolean;
    aiMinConfidence?: number;
  }): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.updateSettings(accessToken, settings);
  }

  async getOnboardingState(): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token', onboarding: null };
    }

    return await unifiedClient.getOnboardingState(accessToken);
  }

  async updateOnboardingState(updates: { showFirstLoginModal?: boolean; dismissedAt?: string; autoCategorizeFoldersDecision?: 'accepted' | 'declined' | null }): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.updateOnboardingState(accessToken, updates);
  }

  async addAiSuggestionFeedback(feedback: {
    id?: string;
    createdAt?: string;
    fileId?: string;
    fileName?: string;
    suggestedCategoryId?: string | null;
    suggestedCategoryName?: string;
    chosenCategoryId?: string | null;
    chosenCategoryName?: string;
    source?: string;
  }): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.addAiSuggestionFeedback(accessToken, feedback);
  }

  /**
   * Create a new category
   */
  async createCategory(category: {
    name: string;
    description?: string;
    color?: string;
    icon?: string;
  }): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    // Generate a temporary ID for new categories
    const categoryWithId = {
      ...category,
      id: 'cat_' + Date.now(),
    };

    return await unifiedClient.saveCategory(accessToken, categoryWithId);
  }

  /**
   * Update an existing category
   */
  async updateCategory(category: {
    id: string;
    name?: string;
    description?: string;
    keywords?: string[];
    examples?: string[];
    color?: string;
    icon?: string;
  }): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.saveCategory(accessToken, category);
  }

  /**
   * Delete a category
   */
  async deleteCategory(categoryId: string, _removeAssignments: boolean = false): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.deleteCategory(accessToken, categoryId);
  }

  /**
   * Get all rules or rules for a specific category
   */
  async getRules(_categoryId?: string): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token', rules: [] };
    }

    return await unifiedClient.getRules(accessToken);
  }

  /**
   * Create a new rule
   */
  async createRule(rule: {
    categoryId: string;
    type: 'keyword' | 'mimetype' | 'owner';
    value: string;
    field?: string;
    operator?: 'contains' | 'equals' | 'startsWith' | 'endsWith';
    caseSensitive?: boolean;
    enabled?: boolean;
    confidence?: number;
  }): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.createRule(accessToken, rule as any);
  }

  /**
   * Update an existing rule
   */
  async updateRule(rule: {
    id: string;
    categoryId?: string;
    type?: 'keyword' | 'mimetype' | 'owner';
    value?: string;
    field?: string;
    operator?: 'contains' | 'equals' | 'startsWith' | 'endsWith';
    caseSensitive?: boolean;
    enabled?: boolean;
    confidence?: number;
  }): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.updateRule(accessToken, rule.id, rule);
  }

  /**
   * Delete a rule
   */
  async deleteRule(ruleId: string): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.deleteRule(accessToken, ruleId);
  }

  /**
   * Apply rules to files for auto-categorization
   */
  async applyRules(fileIds?: string[], confidenceThreshold?: number): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.applyRules(accessToken, fileIds, confidenceThreshold);
  }

  /**
   * Get review queue items
   */
  async getReviewQueue(_status?: string): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token', queue: [] };
    }

    return await unifiedClient.getReviewQueue(accessToken);
  }

  /**
   * Accept a review suggestion
   * Now uses optimistic updates for instant UI feedback
   */
  async reviewAccept(reviewId?: string, fileId?: string): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    // Use optimistic version by default
    return await unifiedClient.reviewAcceptOptimistic(accessToken, reviewId, fileId);
  }

  /**
   * Override a review suggestion with a different category
   * Now uses optimistic updates for instant UI feedback
   */
  async reviewOverride(categoryId: string, reviewId?: string, fileId?: string): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    // Use optimistic version by default
    return await unifiedClient.reviewOverrideOptimistic(accessToken, categoryId, reviewId, fileId);
  }

  /**
   * Skip a review item without categorizing
   * Now uses optimistic updates for instant UI feedback
   */
  async reviewSkip(reviewId?: string, fileId?: string): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    // Use optimistic version by default
    return await unifiedClient.reviewSkipOptimistic(accessToken, reviewId, fileId);
  }

  /**
   * Auto-assign a single file using rules
   */
  async autoAssign(fileId: string): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.autoAssign(accessToken, fileId);
  }

  /**
   * Auto-assign multiple files using rules (batch operation)
   * Uses optimistic updates for instant UI feedback
   */
  async batchAutoAssign(fileIds: string[]): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.batchAutoAssignOptimistic(accessToken, fileIds);
  }

  /**
   * Get file view URL for preview
   */
  async getFileViewUrl(fileId: string): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.getFileViewUrl(accessToken, fileId);
  }

  /**
   * Get file download URL
   */
  async getFileDownloadUrl(fileId: string, exportFormat?: string): Promise<any> {
    const accessToken = this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'No access token' };
    }

    return await unifiedClient.getFileDownloadUrl(accessToken, fileId, exportFormat);
  }
}

export const appsScriptClient = new AppsScriptClient();
