/**
 * Configuration Manager
 * 
 * Manages user configuration (categories, rules, assignments) stored in Drive appDataFolder.
 * Each user has their own config.json file in their Drive, providing complete isolation.
 * 
 * The appDataFolder is a special hidden folder in Drive that:
 * - Only accessible by this app
 * - Not visible in user's Drive UI
 * - Automatically deleted if user revokes app access
 * - Perfect for app-specific configuration
 */

import { driveClient } from './driveClient';

const parseTimestamp = (value?: string): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const CONFIG_FILE_NAME = 'autosortdrive-config.json';
const CONFIG_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export interface Category {
  id: string;
  name: string;
  description: string;
  keywords?: string[];
  examples?: string[];
  color: string;
  icon: string;
  driveFolderId?: string;
  source?: 'manual' | 'drive-folder';
  createdAt: string;
  updatedAt: string;
}

export interface Rule {
  id: string;
  categoryId: string;
  type: 'keyword' | 'mimetype' | 'owner' | 'custom';
  field: string;
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'matches';
  value: string;
  caseSensitive: boolean;
  enabled: boolean;
  confidence?: number;
  createdAt: string;
}

export interface ReviewQueueItem {
  id: string;
  fileId: string;
  fileName?: string;
  mimeType?: string;
  modifiedTime?: string;
  iconLink?: string;
  thumbnailLink?: string;
  file?: {
    id: string;
    name: string;
    mimeType?: string;
    modifiedTime?: string;
    iconLink?: string;
    thumbnailLink?: string;
  };
  status: 'pending' | 'accepted' | 'rejected';
  suggestedCategoryId?: string;
  confidence?: number;
  reason?: string;
  source?: string;
  createdAt?: string;
  addedAt?: string;
}

export interface AiSuggestionFeedback {
  id: string;
  createdAt: string;
  fileId?: string;
  fileName?: string;
  suggestedCategoryId?: string | null;
  suggestedCategoryName?: string;
  chosenCategoryId?: string | null;
  chosenCategoryName?: string;
  source?: string;
}

export interface OnboardingState {
  showFirstLoginModal: boolean;
  dismissedAt?: string;
  autoCategorizeFoldersDecision?: 'accepted' | 'declined' | null;
}

export interface FeedbackState {
  aiSuggestions: AiSuggestionFeedback[];
  summary?: FeedbackSummary;
}

export interface FeedbackSummary {
  text: string;
  updatedAt: string;
  sourceCount: number;
  lastEntryAt?: string;
}

export interface AiDecisionCacheEntry {
  categoryId: string | null;
  confidence: number;
  reason: string;
  model?: string;
  decidedAt: string;
  contextKey?: string;
}

export interface AssignmentMeta {
  source?: string;
  reason?: string;
  confidence?: number;
  model?: string;
  decidedAt?: string;
}

export interface AppConfig {
  version: string;
  createdAt: string;
  updatedAt: string;
  categories: Category[];
  assignments: Record<string, string>; // fileId -> categoryId
  assignmentMeta: Record<string, AssignmentMeta>;
  aiDecisionCache: Record<string, AiDecisionCacheEntry>;
  aiDecisionCacheContextKey?: string;
  rules: Rule[];
  reviewQueue: ReviewQueueItem[];
  ignoredFolderIds?: string[];
  onboarding: OnboardingState;
  feedback: FeedbackState;
  settings: {
    autoCategorizationEnabled: boolean;
    confidenceThreshold: number;
    aiEnabled: boolean;
    aiPrimary: boolean;
    aiUseRulesFallback: boolean;
    aiMinConfidence: number;
  };
}

class ConfigManager {
  private configFileId: string | null = null;
  private cachedConfig: AppConfig | null = null;
  private cachedConfigVersion: number | null = null;
  private cachedConfigAt: number | null = null;

  /**
   * Get default config structure
   */
  private getDefaultConfig(): AppConfig {
    return {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      categories: [],
      assignments: {},
      assignmentMeta: {},
      aiDecisionCache: {},
      aiDecisionCacheContextKey: '',
      rules: [],
      reviewQueue: [],
      ignoredFolderIds: [],
      onboarding: {
        showFirstLoginModal: true,
        autoCategorizeFoldersDecision: null,
      },
      feedback: {
        aiSuggestions: [],
      },
      settings: {
        autoCategorizationEnabled: false,
        confidenceThreshold: 0.8,
        aiEnabled: false,
        aiPrimary: true,
        aiUseRulesFallback: true,
        aiMinConfidence: 0.9,
      },
    };
  }

  private normalizeConfig(
    rawConfig: Partial<AppConfig> | null,
    options?: { treatMissingOnboardingAsSeen?: boolean }
  ): { config: AppConfig; didChange: boolean } {
    const defaults = this.getDefaultConfig();
    const safeConfig = rawConfig || {};

    const hasOnboarding =
      typeof (safeConfig as any).onboarding === 'object' &&
      (safeConfig as any).onboarding !== null;

    const onboarding = hasOnboarding
      ? { ...defaults.onboarding, ...(safeConfig as any).onboarding }
      : options?.treatMissingOnboardingAsSeen
        ? { ...defaults.onboarding, showFirstLoginModal: false }
        : { ...defaults.onboarding };

    const feedbackRaw = (safeConfig as any).feedback;
    const aiSuggestions = Array.isArray(feedbackRaw?.aiSuggestions)
      ? feedbackRaw.aiSuggestions
      : defaults.feedback.aiSuggestions;
    const summaryRaw = feedbackRaw?.summary;
    const summary =
      summaryRaw && typeof summaryRaw === 'object' && typeof summaryRaw.text === 'string'
        ? {
            text: summaryRaw.text,
            updatedAt: typeof summaryRaw.updatedAt === 'string' ? summaryRaw.updatedAt : defaults.updatedAt,
            sourceCount:
              typeof summaryRaw.sourceCount === 'number'
                ? summaryRaw.sourceCount
                : aiSuggestions.length,
            lastEntryAt: typeof summaryRaw.lastEntryAt === 'string' ? summaryRaw.lastEntryAt : undefined,
          }
        : undefined;
    const feedback = {
      ...defaults.feedback,
      aiSuggestions,
      ...(summary ? { summary } : {}),
    };

    const normalized: AppConfig = {
      ...defaults,
      ...safeConfig,
      categories: Array.isArray((safeConfig as any).categories) ? (safeConfig as any).categories : defaults.categories,
      assignments:
        (safeConfig as any).assignments &&
        typeof (safeConfig as any).assignments === 'object' &&
        !Array.isArray((safeConfig as any).assignments)
          ? (safeConfig as any).assignments
          : defaults.assignments,
      assignmentMeta:
        (safeConfig as any).assignmentMeta &&
        typeof (safeConfig as any).assignmentMeta === 'object' &&
        !Array.isArray((safeConfig as any).assignmentMeta)
          ? (safeConfig as any).assignmentMeta
          : defaults.assignmentMeta,
      aiDecisionCache:
        (safeConfig as any).aiDecisionCache &&
        typeof (safeConfig as any).aiDecisionCache === 'object' &&
        !Array.isArray((safeConfig as any).aiDecisionCache)
          ? (safeConfig as any).aiDecisionCache
          : defaults.aiDecisionCache,
      aiDecisionCacheContextKey:
        typeof (safeConfig as any).aiDecisionCacheContextKey === 'string'
          ? (safeConfig as any).aiDecisionCacheContextKey
          : defaults.aiDecisionCacheContextKey,
      rules: Array.isArray((safeConfig as any).rules) ? (safeConfig as any).rules : defaults.rules,
      reviewQueue: Array.isArray((safeConfig as any).reviewQueue) ? (safeConfig as any).reviewQueue : defaults.reviewQueue,
      onboarding,
      feedback,
      settings: {
        ...defaults.settings,
        ...((safeConfig as any).settings || {}),
      },
    };

    const missingSettings =
      !(safeConfig as any).settings ||
      Object.keys(defaults.settings).some(key => (safeConfig as any).settings?.[key] === undefined);
    const missingCollections =
      !Array.isArray((safeConfig as any).categories) ||
      !Array.isArray((safeConfig as any).rules) ||
      !Array.isArray((safeConfig as any).reviewQueue) ||
      typeof (safeConfig as any).assignments !== 'object' ||
      Array.isArray((safeConfig as any).assignments) ||
      !(safeConfig as any).assignmentMeta ||
      typeof (safeConfig as any).assignmentMeta !== 'object' ||
      Array.isArray((safeConfig as any).assignmentMeta) ||
      !(safeConfig as any).aiDecisionCache ||
      typeof (safeConfig as any).aiDecisionCache !== 'object' ||
      Array.isArray((safeConfig as any).aiDecisionCache);
    const missingOnboarding =
      !hasOnboarding || (safeConfig as any).onboarding?.showFirstLoginModal === undefined;
    const missingFeedback = !feedbackRaw || !Array.isArray(feedbackRaw?.aiSuggestions);
    const missingDecisionCacheKey = typeof (safeConfig as any).aiDecisionCacheContextKey !== 'string';

    const didChange = missingSettings || missingCollections || missingOnboarding || missingFeedback || missingDecisionCacheKey;

    return { config: normalized, didChange };
  }

  /**
   * Initialize or load config from user's Drive appDataFolder
   */
  async initialize(accessToken: string): Promise<{ success: boolean; config?: AppConfig; error?: string }> {
    console.log('⚙️ Initializing config from Drive appDataFolder...');

    try {
      // Search for existing config file in appDataFolder
      const searchResult = await driveClient.listAppDataFiles(
        accessToken,
        `name='${CONFIG_FILE_NAME}'`
      );

      if (!searchResult.success) {
        return {
          success: false,
          error: searchResult.error,
        };
      }

      // If config file exists, load it
      if (searchResult.files && searchResult.files.length > 0) {
        const configFile = searchResult.files[0];
        this.configFileId = configFile.id;

        console.log('✅ Found existing config file:', configFile.id);

        // Download and parse config
        const downloadResult = await driveClient.downloadAppDataFile(accessToken, configFile.id);
        
        if (!downloadResult.success) {
          return {
            success: false,
            error: downloadResult.error,
          };
        }

        const parsedConfig = typeof downloadResult.content === 'string'
          ? JSON.parse(downloadResult.content)
          : downloadResult.content;

        const { config, didChange } = this.normalizeConfig(parsedConfig, {
          treatMissingOnboardingAsSeen: true,
        });

        this.cachedConfig = config;
        this.cachedConfigVersion = parseTimestamp(config.updatedAt);
        this.cachedConfigAt = Date.now();
        console.log('✅ Config loaded:', {
          categories: config.categories?.length || 0,
          assignments: Object.keys(config.assignments || {}).length,
          rules: config.rules?.length || 0,
        });

        if (didChange) {
          const updateResult = await this.updateConfig(accessToken, config);
          if (!updateResult.success) {
            console.warn('Failed to persist config defaults:', updateResult.error);
          }
        }

        return {
          success: true,
          config,
        };
      }

      // No config file exists, create a new one
      console.log('📝 Creating new config file in appDataFolder...');
      const defaultConfig = this.getDefaultConfig();
      const createResult = await driveClient.createAppDataFile(
        accessToken,
        CONFIG_FILE_NAME,
        JSON.stringify(defaultConfig, null, 2)
      );

      if (!createResult.success) {
        return {
          success: false,
          error: createResult.error,
        };
      }

      this.configFileId = createResult.file.id;
      this.cachedConfig = defaultConfig;
      this.cachedConfigVersion = parseTimestamp(defaultConfig.updatedAt);
      this.cachedConfigAt = Date.now();

      console.log('✅ New config file created:', createResult.file.id);

      return {
        success: true,
        config: defaultConfig,
      };

    } catch (error: any) {
      console.error('❌ Failed to initialize config:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get current config (from cache or Drive)
   */
  async getConfig(accessToken: string, forceRefresh: boolean = false): Promise<AppConfig | null> {
    // Return cached if available and not forcing refresh
    if (this.cachedConfig && !forceRefresh) {
      if (this.cachedConfigAt && Date.now() - this.cachedConfigAt < CONFIG_CACHE_TTL_MS) {
        return this.cachedConfig;
      }
    }

    // Initialize or reload from Drive
    const result = await this.initialize(accessToken);
    return result.success ? result.config! : null;
  }

  /**
   * Update config in Drive
   */
  async updateConfig(accessToken: string, config: AppConfig): Promise<{ success: boolean; error?: string }> {
    if (!this.configFileId) {
      return {
        success: false,
        error: 'Config not initialized. Call initialize() first.',
      };
    }

    try {
      console.log('💾 Saving config to Drive...');
      
      // Update timestamp
      config.updatedAt = new Date().toISOString();

      // Save to Drive
      const result = await driveClient.updateAppDataFile(
        accessToken,
        this.configFileId,
        JSON.stringify(config, null, 2)
      );

      if (result.success) {
        this.cachedConfig = config;
        this.cachedConfigVersion = parseTimestamp(config.updatedAt);
        this.cachedConfigAt = Date.now();
        console.log('✅ Config saved successfully');
      }

      return result;

    } catch (error: any) {
      console.error('❌ Failed to update config:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Add or update a category
   */
  async saveCategory(
    accessToken: string,
    category: Omit<Category, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }
  ): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig(accessToken);
    if (!config) {
      return { success: false, error: 'Failed to load config' };
    }

    const now = new Date().toISOString();
    const existingIndex = config.categories.findIndex(c => c.id === category.id);

    if (existingIndex >= 0) {
      // Update existing
      config.categories[existingIndex] = {
        ...category,
        createdAt: config.categories[existingIndex].createdAt,
        updatedAt: now,
      } as Category;
    } else {
      // Add new
      config.categories.push({
        ...category,
        createdAt: now,
        updatedAt: now,
      } as Category);
    }

    return await this.updateConfig(accessToken, config);
  }

  /**
   * Delete a category
   */
  async deleteCategory(accessToken: string, categoryId: string): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig(accessToken);
    if (!config) {
      return { success: false, error: 'Failed to load config' };
    }

    config.categories = config.categories.filter(c => c.id !== categoryId);
    
    // Remove assignments for this category
    Object.keys(config.assignments).forEach(fileId => {
      if (config.assignments[fileId] === categoryId) {
        delete config.assignments[fileId];
        if (config.assignmentMeta) {
          delete config.assignmentMeta[fileId];
        }
      }
    });

    return await this.updateConfig(accessToken, config);
  }

  /**
   * Assign file to category
   */
  async assignCategory(
    accessToken: string,
    fileId: string,
    categoryId: string | null
  ): Promise<{ success: boolean; error?: string }> {
    const config = await this.getConfig(accessToken);
    if (!config) {
      return { success: false, error: 'Failed to load config' };
    }

    if (categoryId === null) {
      delete config.assignments[fileId];
      if (config.assignmentMeta) {
        delete config.assignmentMeta[fileId];
      }
    } else {
      config.assignments[fileId] = categoryId;
      if (config.assignmentMeta) {
        delete config.assignmentMeta[fileId];
      }
    }

    return await this.updateConfig(accessToken, config);
  }

  /**
   * Clear cache (useful for logout)
   */
  clearCache() {
    this.configFileId = null;
    this.cachedConfig = null;
    this.cachedConfigVersion = null;
    this.cachedConfigAt = null;
  }

  getCachedConfigVersion(): number | null {
    return this.cachedConfigVersion;
  }
}

export const configManager = new ConfigManager();
