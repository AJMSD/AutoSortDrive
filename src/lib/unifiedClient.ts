/**
 * Unified API Client
 * 
 * Combines Drive API (for files) and Config Manager (for categories/rules/assignments).
 * This replaces the Apps Script backend for multi-user support.
 * 
 * Architecture:
 * - User's Drive files: Accessed via Drive API v3
 * - User's config: Stored in Drive appDataFolder (isolated per user)
 * - No backend needed for basic operations
 * - Apps Script can be kept for future AI features only
 * 
 * Optimistic Updates:
 * - Single-file operations use optimistic cache updates for instant UI response
 * - Bulk operations still use full cache invalidation for safety
 * - All operations support automatic rollback on failure
 */

import { driveClient } from './driveClient';
import { logger } from '@/utils/logger';
import toast from 'react-hot-toast';
import { configManager, type AppConfig, type Category, type Rule, type AiSuggestionFeedback, type FeedbackSummary, type AiDecisionCacheEntry, type OnboardingState, type AssignmentMeta } from './configManager';
import { cacheManager } from './cacheManager';
import { withOptimisticUpdate } from './optimisticUpdate';

const GEMINI_MODEL = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) || 'gemma-3n-e4b-it';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';
const FOLDER_SYNC_WINDOW_MS = 5 * 60 * 1000;
const FOLDER_CATEGORY_COLORS = ['#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899'];
const DEFAULT_FOLDER_ICON = 'fa-folder';

const isExcludedMimeType = (mimeType?: string) =>
  mimeType === FOLDER_MIME_TYPE || mimeType === SHORTCUT_MIME_TYPE;

const DEFAULT_AI_SETTINGS = {
  aiEnabled: false,
  aiPrimary: true,
  aiUseRulesFallback: true,
  aiMinConfidence: 0.9,
};

let aiCooldownUntil = 0;
const AI_COOLDOWN_WINDOW_MS = 60 * 1000;
let aiBudgetWarningShown = false;

type AiSettings = {
  aiEnabled: boolean;
  aiPrimary: boolean;
  aiUseRulesFallback: boolean;
  aiMinConfidence: number;
};

const normalizeAiSettings = (settings?: Partial<AiSettings>): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  ...(settings || {}),
});

const pruneAiDecisionCache = (config: AppConfig, options?: { maxEntries?: number; maxAgeDays?: number }) => {
  const cache = config.aiDecisionCache || {};
  const entries = Object.entries(cache);
  if (entries.length === 0) return;

  const maxEntries = options?.maxEntries ?? 500;
  const maxAgeDays = options?.maxAgeDays ?? 30;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  const filtered = entries.filter(([, entry]) => {
    const decidedAt = Date.parse(entry?.decidedAt || '');
    return Number.isFinite(decidedAt) && decidedAt >= cutoff;
  });

  filtered.sort((a, b) => Date.parse(b[1].decidedAt || '') - Date.parse(a[1].decidedAt || ''));
  const trimmed = filtered.slice(0, maxEntries);

  config.aiDecisionCache = Object.fromEntries(trimmed);
};

const pruneAiFeedback = (config: AppConfig, options?: { maxEntries?: number }) => {
  if (!config.feedback || !Array.isArray(config.feedback.aiSuggestions)) return;
  const maxEntries = options?.maxEntries ?? 200;
  const sorted = config.feedback.aiSuggestions
    .slice()
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  config.feedback.aiSuggestions = sorted.slice(0, maxEntries);
};

const cleanList = (values?: string[]) =>
  (values || []).map(value => value.trim()).filter(Boolean);

const FEEDBACK_SUMMARY_RECENT_LIMIT = 40;
const FEEDBACK_SUMMARY_MAX_GROUPS = 6;
const FEEDBACK_SUMMARY_MAX_EXAMPLES = 2;
const FEEDBACK_SUMMARY_MAX_LABEL_LENGTH = 32;
const FEEDBACK_SUMMARY_MAX_EXAMPLE_LENGTH = 28;
const FEEDBACK_SUMMARY_MAX_TOTAL_CHARS = 800;

const truncateText = (value: string, maxLength: number) => {
  if (!value) return '';
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const parseTimestamp = (value?: string): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const getFileModifiedTimestamp = (file: any): number => {
  if (!file) return 0;
  if (typeof file.modifiedTime === 'string') {
    return parseTimestamp(file.modifiedTime);
  }
  if (file.modifiedDate instanceof Date) {
    return file.modifiedDate.getTime();
  }
  if (typeof file.modifiedDate === 'string') {
    return parseTimestamp(file.modifiedDate);
  }
  return 0;
};

const buildDecisionContextKey = (
  categories: Category[],
  rules: Rule[],
  settings: AiSettings
): string => {
  const normalizedCategories = (categories || [])
    .map(category => ({
      id: category.id,
      name: category.name || '',
      description: category.description || '',
      keywords: cleanList(category.keywords),
      examples: cleanList(category.examples),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const normalizedRules = (rules || [])
    .map(rule => ({
      id: rule.id,
      categoryId: rule.categoryId,
      type: rule.type,
      field: rule.field || rule.type,
      operator: rule.operator || 'contains',
      value: rule.value,
      caseSensitive: Boolean(rule.caseSensitive),
      enabled: rule.enabled !== false,
      confidence: rule.confidence ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const normalizedSettings = normalizeAiSettings(settings);
  const payload = JSON.stringify({
    categories: normalizedCategories,
    rules: normalizedRules,
    settings: normalizedSettings,
    model: GEMINI_MODEL || 'unknown',
  });

  return `ctx_${hashString(payload)}_${payload.length}`;
};

const buildFeedbackSummary = (
  feedback: AiSuggestionFeedback[],
  categories: Category[]
): FeedbackSummary | null => {
  const overrides = (feedback || []).filter(entry => {
    const suggested = entry.suggestedCategoryId;
    const chosen = entry.chosenCategoryId;
    return Boolean(suggested && chosen && suggested !== chosen);
  });

  if (overrides.length === 0) {
    return null;
  }

  const categoryNameById = new Map(categories.map(category => [category.id, category.name]));
  const sorted = overrides.slice().sort((a, b) => parseTimestamp(b.createdAt) - parseTimestamp(a.createdAt));
  const recent = sorted.slice(0, FEEDBACK_SUMMARY_RECENT_LIMIT);
  const groups = new Map<
    string,
    {
      suggestedId: string;
      chosenId: string;
      suggestedName: string;
      chosenName: string;
      count: number;
      examples: string[];
      lastSeen: number;
    }
  >();

  recent.forEach(entry => {
    const suggestedId = entry.suggestedCategoryId as string;
    const chosenId = entry.chosenCategoryId as string;
    const key = `${suggestedId}__${chosenId}`;
    const suggestedName = truncateText(
      entry.suggestedCategoryName || categoryNameById.get(suggestedId) || suggestedId,
      FEEDBACK_SUMMARY_MAX_LABEL_LENGTH
    );
    const chosenName = truncateText(
      entry.chosenCategoryName || categoryNameById.get(chosenId) || chosenId,
      FEEDBACK_SUMMARY_MAX_LABEL_LENGTH
    );

    const lastSeen = parseTimestamp(entry.createdAt);
    const group = groups.get(key) || {
      suggestedId,
      chosenId,
      suggestedName,
      chosenName,
      count: 0,
      examples: [],
      lastSeen,
    };

    group.count += 1;
    group.lastSeen = Math.max(group.lastSeen, lastSeen);

    if (entry.fileName && group.examples.length < FEEDBACK_SUMMARY_MAX_EXAMPLES) {
      const example = truncateText(entry.fileName, FEEDBACK_SUMMARY_MAX_EXAMPLE_LENGTH);
      if (example && !group.examples.includes(example)) {
        group.examples.push(example);
      }
    }

    groups.set(key, group);
  });

  const lines = Array.from(groups.values())
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, FEEDBACK_SUMMARY_MAX_GROUPS)
    .map(group => {
      const base = `${group.suggestedName} -> ${group.chosenName} (${group.count})`;
      if (group.examples.length > 0) {
        return `- ${base}: ${group.examples.join('; ')}`;
      }
      return `- ${base}`;
    });

  let text = lines.join('\n').trim();
  if (!text) {
    return null;
  }

  if (text.length > FEEDBACK_SUMMARY_MAX_TOTAL_CHARS) {
    const trimmedLines = [...lines];
    while (trimmedLines.length > 1 && trimmedLines.join('\n').length > FEEDBACK_SUMMARY_MAX_TOTAL_CHARS) {
      trimmedLines.pop();
    }
    text = trimmedLines.join('\n').trim();
    if (text.length > FEEDBACK_SUMMARY_MAX_TOTAL_CHARS) {
      text = truncateText(text, FEEDBACK_SUMMARY_MAX_TOTAL_CHARS);
    }
  }

  return {
    text,
    updatedAt: new Date().toISOString(),
    sourceCount: overrides.length,
    lastEntryAt: sorted[0]?.createdAt,
  };
};

const buildAiPrompt = (file: any, categories: Category[], feedbackSummary?: string) => {
  const fileName = file?.name || file?.fileName || '';
  const categoryLines = categories.map(category => {
    const keywords = cleanList(category.keywords).join(', ');
    const examples = cleanList(category.examples).join(', ');
    const description = category.description || '';
    return `- ${category.id}: ${category.name}\n  description: ${description}\n  keywords: ${keywords}\n  examples: ${examples}`;
  }).join('\n');

  const summaryText = feedbackSummary?.trim();

  return [
    'You are a file categorization assistant.',
    'Choose the best category ID for the file using the category descriptions, keywords, and examples.',
    'Treat category descriptions and constraints as hard rules.',
    'Only choose a category when there is clear positive evidence from name, keywords, or examples.',
    'If there is any ambiguity or conflict, return null for categoryId.',
    'Use recent corrections as guidance to avoid repeating mistakes.',
    'Only use the provided category IDs or the exact category name. If none fit, return null for categoryId.',
    'Return a single-line JSON object only (no markdown, no code fences, no extra text).',
    'The JSON must be in this exact shape with categoryId first:',
    '{"categoryId":"cat_id_or_null","confidence":0.0,"reason":"short reason (<=12 words)"}',
    ...(summaryText
      ? ['', 'Recent user corrections (suggested -> chosen):', summaryText]
      : []),
    '',
    `File name: ${fileName}`,
    `File type: ${file?.mimeType || ''}`,
    '',
    'Categories:',
    categoryLines,
  ].join('\n');
};

const extractJson = (text: string): string | null => {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
};

const extractStringField = (text: string, field: string): string | null => {
  const quotedField = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, 'i');
  const quotedMatch = text.match(quotedField);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();

  const unquotedField = new RegExp(`${field}\\s*:\\s*"([^"]+)"`, 'i');
  const unquotedMatch = text.match(unquotedField);
  if (unquotedMatch?.[1]) return unquotedMatch[1].trim();

  const lenientField = new RegExp(`"${field}"\\s*:\\s*"([^"\\n}]*)`, 'i');
  const lenientMatch = text.match(lenientField);
  if (lenientMatch?.[1]) return lenientMatch[1].trim();

  return null;
};

const extractNumberField = (text: string, field: string): number | null => {
  const numberMatch = text.match(new RegExp(`"${field}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, 'i'));
  if (!numberMatch?.[1]) return null;
  const value = Number(numberMatch[1]);
  return Number.isFinite(value) ? value : null;
};

const normalizeAiCategoryId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'null' || lowered === 'none') return null;
  return trimmed;
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
};

const asyncPool = async <T, R>(
  limit: number,
  items: T[],
  iterator: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  const executing: Promise<void>[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const currentIndex = index;
    const p = (async () => {
      results[currentIndex] = await iterator(items[currentIndex], currentIndex);
    })();
    const wrapped = p.then(() => {
      const execIndex = executing.indexOf(wrapped);
      if (execIndex >= 0) {
        executing.splice(execIndex, 1);
      }
    });
    executing.push(wrapped);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
};

const pickFolderColor = (folderId: string) => {
  if (!folderId) return FOLDER_CATEGORY_COLORS[0];
  const index = Math.abs(hashString(folderId)) % FOLDER_CATEGORY_COLORS.length;
  return FOLDER_CATEGORY_COLORS[index];
};

const getFolderCategoryIdForFile = (file: any, folderCategoryMap: Map<string, Category>): string | null => {
  if (!file || folderCategoryMap.size === 0) return null;
  const parents = Array.isArray(file.parents) ? file.parents : [];
  for (const parentId of parents) {
    const category = folderCategoryMap.get(parentId);
    if (category) return category.id;
  }
  return null;
};

const buildFolderCategory = (folder: any): Category => {
  const now = new Date().toISOString();
  const name = folder?.name || 'Untitled Folder';
  return {
    id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    name,
    description: '',
    color: pickFolderColor(folder?.id || name),
    icon: DEFAULT_FOLDER_ICON,
    driveFolderId: folder?.id,
    source: 'drive-folder',
    createdAt: now,
    updatedAt: now,
  };
};

const callGemini = async (prompt: string) => {
  const payload = {
    prompt,
    model: GEMINI_MODEL,
    temperature: 0.2,
    maxOutputTokens: 512,
  };

  const requestJson = async (url: string, contentType: string) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: JSON.stringify(payload),
    });

    if (response.headers.get('x-ai-budget-warning') === 'true' && !aiBudgetWarningShown) {
      aiBudgetWarningShown = true;
      toast.error('AI usage is nearing the daily limit. Suggestions may be limited.', { duration: 6000 });
    }

    if (!response.ok) {
      const error: any = new Error(`AI request failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    if (!data?.success) {
      const error: any = new Error(data?.error || 'AI request failed');
      error.status = response.status;
      throw error;
    }

    const text = typeof data?.text === 'string' ? data.text : '';
    if (!text.trim()) {
      logger.warn('AI response missing text');
      return null;
    }
    return text;
  };

  try {
    return await requestJson('/api/ai-categorize', 'application/json');
  } catch (error) {
    throw error;
  }
};

type AutoAssignResult = {
  success: boolean;
  assigned?: boolean;
  error?: string;
  categoryId?: string;
  fileId: string;
  fileName: string;
  mimeType?: string;
  modifiedTime?: string;
  addedToReview?: boolean;
};

/**
 * Evaluate if a file matches any rules
 * Returns true if the file matches at least one rule
 */
function evaluateFileAgainstRules(file: any, rules: Rule[]): boolean {
  if (!rules || rules.length === 0) return false;
  
  for (const rule of rules) {
    let matches = false;
    const fieldValue = getFileFieldValue(file, rule.field);
    
    if (fieldValue === null || fieldValue === undefined) continue;
    
    switch (rule.operator) {
      case 'contains':
        matches = String(fieldValue).toLowerCase().includes(String(rule.value).toLowerCase());
        break;
      case 'equals':
        matches = String(fieldValue).toLowerCase() === String(rule.value).toLowerCase();
        break;
      case 'startsWith':
        matches = String(fieldValue).toLowerCase().startsWith(String(rule.value).toLowerCase());
        break;
      case 'endsWith':
        matches = String(fieldValue).toLowerCase().endsWith(String(rule.value).toLowerCase());
        break;
      case 'matches':
        try {
          const regex = new RegExp(String(rule.value), 'i');
          matches = regex.test(String(fieldValue));
        } catch (e) {
          matches = false;
        }
        break;
    }
    
    if (matches) return true;
  }
  
  return false;
}

/**
 * Get field value from file object
 */
function getFileFieldValue(file: any, field: string): any {
  switch (field) {
    case 'filename':
    case 'keyword':
    case 'name':
      return file.name;
    case 'mimetype':
    case 'mimeType':
      return file.mimeType;
    case 'modifiedTime':
      return file.modifiedTime;
    case 'createdTime':
      return file.createdTime;
    case 'size':
      return file.size;
    case 'owner':
      return file.owners?.[0]?.emailAddress || '';
    default:
      return null;
  }
}

const getRuleMatchCategoryId = (file: any, rules: Rule[]): string | null => {
  if (!rules || rules.length === 0) return null;

  for (const rule of rules.filter(r => r.enabled !== false)) {
    let fileValue = '';
    switch (rule.field || rule.type) {
      case 'filename':
      case 'keyword':
      case 'name':
        fileValue = file.name || '';
        break;
      case 'mimeType':
      case 'mimetype':
        fileValue = file.mimeType || '';
        break;
      case 'owner':
        fileValue = file.owners?.[0]?.emailAddress || '';
        break;
      default:
        fileValue = '';
        break;
    }

    let ruleValue = rule.caseSensitive ? rule.value : rule.value.toLowerCase();
    fileValue = rule.caseSensitive ? fileValue : fileValue.toLowerCase();

    const operator = rule.operator || 'contains';
    let matches = false;

    if (operator === 'contains' && (rule.field === 'filename' || rule.type === 'keyword' || rule.field === 'name')) {
      const keywords = ruleValue.split(',').map(k => k.trim()).filter(k => k);
      matches = keywords.some(keyword => fileValue.includes(keyword));
    } else {
      switch (operator) {
        case 'contains':
          matches = fileValue.includes(ruleValue);
          break;
        case 'equals':
          matches = fileValue === ruleValue;
          break;
        case 'startsWith':
          matches = fileValue.startsWith(ruleValue);
          break;
        case 'endsWith':
          matches = fileValue.endsWith(ruleValue);
          break;
        default:
          matches = false;
      }
    }

    if (matches) {
      return rule.categoryId;
    }
  }

  return null;
};

class UnifiedClient {
  private lastFolderSyncAt: number = 0;
  private folderSyncPromise: Promise<{ config: AppConfig; createdCount: number }> | null = null;
  private folderNonEmptyCache = new Map<string, { hasChildren: boolean; checkedAt: number }>();
  private static readonly FOLDER_NON_EMPTY_TTL_MS = 30 * 60 * 1000;

  private async syncFolderCategories(
    accessToken: string,
    config: AppConfig,
    options?: { force?: boolean }
  ): Promise<{ config: AppConfig; createdCount: number }> {
    const decision = config.onboarding?.autoCategorizeFoldersDecision;
    if (decision !== 'accepted') {
      return { config, createdCount: 0 };
    }

    const now = Date.now();
    if (!options?.force && now - this.lastFolderSyncAt < FOLDER_SYNC_WINDOW_MS) {
      return { config, createdCount: 0 };
    }

    if (this.folderSyncPromise) {
      return this.folderSyncPromise;
    }

    this.folderSyncPromise = (async () => {
      let createdCount = 0;
      let didChange = false;

      const folderCategoryMap = new Map<string, Category>();
      const ignoredFolderIds = new Set<string>((config as any).ignoredFolderIds || []);
      const categoryNameMap = new Map<string, Category>();

      (config.categories || []).forEach(category => {
        if (category.driveFolderId) {
          folderCategoryMap.set(category.driveFolderId, category);
        } else if (category.name) {
          categoryNameMap.set(category.name.trim().toLowerCase(), category);
        }
      });

      const folders: any[] = [];
      let pageToken: string | null = null;
      let pageCount = 0;
      const MAX_PAGES = 50;

      do {
        const result = await driveClient.listFiles(accessToken, {
          pageSize: 1000,
          pageToken: pageToken || undefined,
          q: `mimeType = '${FOLDER_MIME_TYPE}' and trashed = false`,
          excludeFolders: false,
        });

        if (!result.success) {
          logger.warn('Failed to list folders for category sync:', result.error);
          break;
        }

        folders.push(...(result.files || []));
        pageToken = result.nextPageToken || null;
        pageCount += 1;
      } while (pageToken && pageCount < MAX_PAGES);

      for (const folder of folders) {
        if (!folder?.id) continue;
        if (ignoredFolderIds.has(folder.id)) continue;

        const cachedNonEmpty = this.folderNonEmptyCache.get(folder.id);
        let hasChildren: boolean | null = null;

        if (cachedNonEmpty && Date.now() - cachedNonEmpty.checkedAt < UnifiedClient.FOLDER_NON_EMPTY_TTL_MS) {
          hasChildren = cachedNonEmpty.hasChildren;
        }

        if (hasChildren === null) {
          const childCheck = await driveClient.listFiles(accessToken, {
            pageSize: 1,
            q: `'${folder.id}' in parents and trashed = false`,
            excludeFolders: false,
          });

          if (!childCheck.success) {
            logger.warn('Failed to check folder contents, skipping folder category:', childCheck.error);
            continue;
          }

          hasChildren = (childCheck.files || []).length > 0;
          this.folderNonEmptyCache.set(folder.id, { hasChildren, checkedAt: Date.now() });
        }

        if (!hasChildren) {
          continue;
        }

        const existingById = folderCategoryMap.get(folder.id);
        if (existingById) continue;

        const normalizedName = (folder.name || '').trim().toLowerCase();
        const existingByName = normalizedName ? categoryNameMap.get(normalizedName) : undefined;
        if (existingByName && !existingByName.driveFolderId) {
          existingByName.driveFolderId = folder.id;
          existingByName.source = existingByName.source || 'drive-folder';
          existingByName.updatedAt = new Date().toISOString();
          folderCategoryMap.set(folder.id, existingByName);
          didChange = true;
          continue;
        }

        const newCategory = buildFolderCategory(folder);
        config.categories.push(newCategory);
        folderCategoryMap.set(folder.id, newCategory);
        createdCount += 1;
        didChange = true;
      }

      if (didChange) {
        const updateResult = await configManager.updateConfig(accessToken, config);
        if (!updateResult.success) {
          logger.warn('Failed to persist folder categories:', updateResult.error);
        }
      }

      this.lastFolderSyncAt = Date.now();
      return { config, createdCount };
    })();

    try {
      return await this.folderSyncPromise;
    } finally {
      this.folderSyncPromise = null;
    }
  }

  private async getFeedbackSummaryText(
    accessToken: string,
    config: AppConfig,
    categories: Category[]
  ): Promise<string> {
    const feedbackEntries = config.feedback?.aiSuggestions || [];
    const summary = buildFeedbackSummary(feedbackEntries, categories);
    const existing = config.feedback?.summary;

    if (!summary) {
      if (existing) {
        if (config.feedback) {
          delete config.feedback.summary;
        }
        const updateResult = await configManager.updateConfig(accessToken, config);
        if (!updateResult.success) {
          logger.warn('Failed to clear feedback summary:', updateResult.error);
        }
      }
      return '';
    }

    const hasSameSummary =
      existing &&
      existing.text === summary.text &&
      existing.sourceCount === summary.sourceCount &&
      existing.lastEntryAt === summary.lastEntryAt;

    if (!hasSameSummary) {
      if (!config.feedback) {
        config.feedback = { aiSuggestions: [] };
      }
      config.feedback.summary = summary;
      const updateResult = await configManager.updateConfig(accessToken, config);
      if (!updateResult.success) {
        logger.warn('Failed to persist feedback summary:', updateResult.error);
      }
    }

    return summary.text;
  }

  private async ensureAiDecisionCacheContext(
    accessToken: string,
    config: AppConfig,
    categories: Category[],
    rules: Rule[],
    settings: AiSettings
  ): Promise<string> {
    const contextKey = buildDecisionContextKey(categories, rules, settings);

    if (config.aiDecisionCacheContextKey !== contextKey) {
      config.aiDecisionCache = {};
      config.aiDecisionCacheContextKey = contextKey;
      const updateResult = await configManager.updateConfig(accessToken, config);
      if (!updateResult.success) {
        logger.warn('Failed to reset AI decision cache context:', updateResult.error);
      }
    }

    if (!config.aiDecisionCache) {
      config.aiDecisionCache = {};
    }

    return contextKey;
  }

  private getCachedAiDecision(
    config: AppConfig,
    fileId: string,
    file: any,
    categories: Category[],
    contextKey: string
  ): AiDecisionCacheEntry | null {
    const cache = config.aiDecisionCache || {};
    const entry = cache[fileId];
    if (!entry) return null;

    if (entry.contextKey && entry.contextKey !== contextKey) {
      return null;
    }
    if (!entry.contextKey && config.aiDecisionCacheContextKey && config.aiDecisionCacheContextKey !== contextKey) {
      return null;
    }

    const decidedAt = parseTimestamp(entry.decidedAt);
    if (!decidedAt) return null;

    const modifiedAt = getFileModifiedTimestamp(file);
    if (modifiedAt && modifiedAt > decidedAt) {
      return null;
    }

    if (entry.categoryId) {
      const exists = categories.some(category => category.id === entry.categoryId);
      if (!exists) return null;
    }

    return entry;
  }

  private async resolveAiDecision(
    accessToken: string,
    config: AppConfig,
    file: any,
    fileId: string,
    categories: Category[],
    rules: Rule[],
    settings: AiSettings
  ): Promise<{ decision: AiDecisionCacheEntry | null; fromCache: boolean; contextKey: string }> {
    const contextKey = await this.ensureAiDecisionCacheContext(accessToken, config, categories, rules, settings);
    const cached = this.getCachedAiDecision(config, fileId, file, categories, contextKey);
    if (cached) {
      return { decision: cached, fromCache: true, contextKey };
    }

    const feedbackSummary = await this.getFeedbackSummaryText(accessToken, config, categories);
    const aiResult = await this.aiCategorizeFile(file, categories, settings, feedbackSummary);
    if (!aiResult) {
      return { decision: null, fromCache: false, contextKey };
    }

    const decision: AiDecisionCacheEntry = {
      categoryId: aiResult.categoryId ?? null,
      confidence: Number.isFinite(aiResult.confidence) ? aiResult.confidence : 0,
      reason: aiResult.reason || 'AI suggestion',
      model: GEMINI_MODEL,
      decidedAt: new Date().toISOString(),
      contextKey,
    };

    return { decision, fromCache: false, contextKey };
  }

  private async aiCategorizeFile(
    file: any,
    categories: Category[],
    settings: AiSettings,
    feedbackSummary?: string
  ): Promise<{ categoryId: string | null; confidence: number; reason: string } | null> {
    if (!settings.aiEnabled) {
      return null;
    }
    if (!categories || categories.length === 0) {
      return null;
    }

    if (aiCooldownUntil && Date.now() < aiCooldownUntil) {
      return null;
    }

    const prompt = buildAiPrompt(file, categories, feedbackSummary);
    const fileLabel = file?.name || file?.fileName || file?.id || 'unknown';

    try {
      const responseText = await callGemini(prompt);
      if (!responseText) {
        logger.warn('AI response empty or missing', { file: fileLabel });
        return null;
      }

      let parsed: {
        categoryId?: string | null;
        confidence?: number;
        reason?: string;
      } | null = null;
      const jsonText = extractJson(responseText);
      if (jsonText) {
        try {
          parsed = JSON.parse(jsonText) as {
            categoryId?: string | null;
            confidence?: number;
            reason?: string;
          };
        } catch (error) {
          logger.warn('AI response JSON parse failed:', { file: fileLabel, error });
        }
      }

      if (!parsed) {
        const hasNullCategoryId = /"categoryId"\s*:\s*null/i.test(responseText);
        const fallbackCategoryId = extractStringField(responseText, 'categoryId');
        const fallbackConfidence = extractNumberField(responseText, 'confidence');
        const fallbackReason = extractStringField(responseText, 'reason');
        if (hasNullCategoryId || fallbackCategoryId || fallbackConfidence !== null || fallbackReason) {
          parsed = {
            categoryId: hasNullCategoryId ? null : fallbackCategoryId,
            confidence: fallbackConfidence ?? undefined,
            reason: fallbackReason ?? undefined,
          };
        }
      }

      if (!parsed) {
        logger.warn('AI response missing JSON payload', { file: fileLabel });
        return null;
      }

      let categoryId: string | null = null;
      const rawCategoryId = normalizeAiCategoryId(parsed.categoryId);
      if (rawCategoryId) {
        const matchedById = categories.find(category => category.id === rawCategoryId);
        if (matchedById) {
          categoryId = matchedById.id;
        } else {
          const normalized = rawCategoryId.trim().toLowerCase();
          const matchedByName = categories.find(category => category.name.trim().toLowerCase() === normalized);
          if (matchedByName) {
            categoryId = matchedByName.id;
          }
        }
      }

      let confidence = Number(parsed.confidence);
      if (!Number.isFinite(confidence)) {
        confidence = categoryId ? settings.aiMinConfidence : 0;
      }
      if (confidence > 1) confidence = confidence / 100;
      confidence = Math.max(0, Math.min(1, confidence));

      const reason = typeof parsed.reason === 'string' ? parsed.reason : 'AI suggestion';

      if (!categoryId) {
        logger.warn('AI response returned no suggestion', {
          file: fileLabel,
          parsed,
          normalizedCategoryId: rawCategoryId,
          confidence,
          reason,
        });
      }

      return { categoryId, confidence, reason };
    } catch (error: any) {
      const status = error?.status;
      if (status === 401) {
        logger.warn('AI categorization unauthorized:', { file: fileLabel });
        return null;
      }
      if (status === 429 || status === 503) {
        aiCooldownUntil = Date.now() + AI_COOLDOWN_WINDOW_MS;
        logger.warn('AI rate limited or unavailable:', { file: fileLabel, status });
        return null;
      }
      logger.error('AI categorization failed:', { file: fileLabel, error });
      return null;
    }
  }
  /**
   * Initialize config for user
   * Call this once after login
   */
  async initialize(accessToken: string) {
    logger.debug('🔧 Initializing user config...');
    return await configManager.initialize(accessToken);
  }

  /**
   * List files from user's Drive with category assignments and review status
   */
  async listFiles(
    accessToken: string,
    params?: {
      pageSize?: number;
      pageToken?: string;
      query?: string;
    }
  ) {
    // Get files from Drive
    const filesResult = await driveClient.listFiles(accessToken, {
      pageSize: params?.pageSize || 100,
      pageToken: params?.pageToken,
      q: params?.query,
    });

    if (!filesResult.success) {
      return filesResult;
    }

    // Get config to add category assignments and evaluate rules
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
        files: [],
        nextPageToken: filesResult.nextPageToken || null,
      };
    }

    const syncResult = await this.syncFolderCategories(accessToken, config, { force: false });
    const effectiveConfig = syncResult.config;
    const rules = effectiveConfig.rules || [];
    const reviewQueue = effectiveConfig.reviewQueue || [];
    const assignmentMeta = effectiveConfig.assignmentMeta || {};
    
    const configVersion = effectiveConfig.updatedAt ? new Date(effectiveConfig.updatedAt).getTime() : Date.now();
    logger.debug('� listFiles: Config loaded - rules:', rules.length, 'reviewQueue:', reviewQueue.length);
    
    logger.debug('� listFiles: Config loaded - rules:', rules.length, 'reviewQueue:', reviewQueue.length);
    
    // Create a Set of file IDs in review queue for fast lookup
    const reviewFileIds = new Set(reviewQueue.map((item: any) => item.fileId));
    
    if (reviewFileIds.size > 0) {
      logger.debug('📋 listFiles: Files in review queue:', Array.from(reviewFileIds));
    }
    
    const folderCategoryMap = new Map<string, Category>();
    effectiveConfig.categories.forEach(category => {
      if (category.driveFolderId) {
        folderCategoryMap.set(category.driveFolderId, category);
      }
    });

    // Enhance files with category info and review status
    const enhancedFiles = (filesResult.files || [])
      .filter((file: any) => !isExcludedMimeType(file?.mimeType))
      .map((file: any) => {
        const assignedCategoryId = effectiveConfig.assignments[file.id] || null;
        const folderCategoryId = assignedCategoryId
          ? null
          : getFolderCategoryIdForFile(file, folderCategoryMap);
        const categoryId = assignedCategoryId || folderCategoryId || null;
        const categorized = !!categoryId;
      
      // A file is "in review" if:
      // 1. It's in the stored review queue, OR
      // 2. It's uncategorized AND matches at least one rule
      const inStoredQueue = reviewFileIds.has(file.id);
      const matchesRules = !categorized && evaluateFileAgainstRules(file, rules);
      const inReview = inStoredQueue || matchesRules;
      
      if (inReview) {
        logger.debug('✅ listFiles: File marked inReview:', file.name, '(inQueue:', inStoredQueue, 'matchesRules:', matchesRules, ')');
      }
      
        return {
          ...file,
          categoryId,
          categorized,
          inReview,
          assignmentMeta: assignedCategoryId ? assignmentMeta[file.id] || undefined : undefined,
        };
      });

    return {
      ...filesResult,
      files: enhancedFiles,
      configVersion,
    };
  }

  /**
   * Get all categories
   */
  async getCategories(accessToken: string, forceRefresh: boolean = false) {
    const config = await configManager.getConfig(accessToken, forceRefresh);
    
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
        categories: [],
      };
    }

    const syncResult = await this.syncFolderCategories(accessToken, config, { force: true });
    const effectiveConfig = syncResult.config;
    const configVersion = parseTimestamp(effectiveConfig.updatedAt) || Date.now();

    // Add file counts to categories
    const categoriesWithCounts = effectiveConfig.categories.map(cat => ({
      ...cat,
      fileCount: Object.values(effectiveConfig.assignments).filter(cid => cid === cat.id).length,
    }));

    return {
      success: true,
      categories: categoriesWithCounts,
      autoCreatedCount: syncResult.createdCount,
      configVersion,
    };
  }

  async getSettings(accessToken: string) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
        settings: normalizeAiSettings(),
      };
    }

    return {
      success: true,
      settings: {
        ...config.settings,
        ...normalizeAiSettings(config.settings),
      },
    };
  }

  async updateSettings(accessToken: string, settings: Partial<AiSettings>) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    const prevSettings = { ...config.settings };
    config.settings = {
      ...config.settings,
      ...settings,
    };

    const nextSettings = normalizeAiSettings(config.settings);
    const settingsChanged =
      prevSettings.aiEnabled !== nextSettings.aiEnabled ||
      prevSettings.aiPrimary !== nextSettings.aiPrimary ||
      prevSettings.aiUseRulesFallback !== nextSettings.aiUseRulesFallback ||
      prevSettings.aiMinConfidence !== nextSettings.aiMinConfidence;

    if (!nextSettings.aiEnabled && Array.isArray(config.reviewQueue)) {
      config.reviewQueue = config.reviewQueue.map(item => {
        const sourceValue = (item.source || '').toLowerCase();
        const isRuleBased = sourceValue === 'rule-based';
        const hasSuggestion = Boolean(item.suggestedCategoryId || item.reason || (item.confidence && item.confidence > 0));

        if (isRuleBased || !hasSuggestion) {
          return item;
        }

        return {
          ...item,
          suggestedCategoryId: undefined,
          confidence: 0,
          reason: undefined,
          source: 'auto-assign',
        };
      });

      cacheManager.invalidateReviewQueueCache();
    } else if (settingsChanged) {
      cacheManager.invalidateReviewQueueCache();
    }

    return await configManager.updateConfig(accessToken, config);
  }

  async getOnboardingState(accessToken: string) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
        onboarding: null,
      };
    }

    return {
      success: true,
      onboarding: config.onboarding,
    };
  }

  async updateOnboardingState(accessToken: string, updates: Partial<OnboardingState>) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    config.onboarding = {
      ...config.onboarding,
      ...updates,
    };

    return await configManager.updateConfig(accessToken, config);
  }

  async addAiSuggestionFeedback(
    accessToken: string,
    feedback: Omit<AiSuggestionFeedback, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
  ) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    if (!config.feedback) {
      config.feedback = { aiSuggestions: [] };
    }

    const entry: AiSuggestionFeedback = {
      id: feedback.id || `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: feedback.createdAt || new Date().toISOString(),
      ...feedback,
    };

    config.feedback.aiSuggestions = [
      ...(config.feedback.aiSuggestions || []),
      entry,
    ];
    pruneAiFeedback(config);

    const summary = buildFeedbackSummary(config.feedback.aiSuggestions || [], config.categories || []);
    if (summary) {
      config.feedback.summary = summary;
    } else if (config.feedback.summary) {
      delete config.feedback.summary;
    }

    return await configManager.updateConfig(accessToken, config);
  }

  /**
   * Create or update category
   */
  async saveCategory(accessToken: string, category: Partial<Category> & { id: string }) {
    const result = await configManager.saveCategory(accessToken, category as any);
    return {
      ...result,
      category,
    };
  }

  /**
   * Delete category
   */
  async deleteCategory(accessToken: string, categoryId: string) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return { success: false, error: 'Failed to load config' };
    }

    const category = config.categories.find(cat => cat.id === categoryId);
    if (!category) {
      return { success: false, error: 'Category not found' };
    }

    const isFolderCategory = !!category.driveFolderId;
    if (isFolderCategory && category.driveFolderId) {
      if (!config.ignoredFolderIds) {
        config.ignoredFolderIds = [];
      }
      if (!config.ignoredFolderIds.includes(category.driveFolderId)) {
        config.ignoredFolderIds.push(category.driveFolderId);
      }

      config.rules = (config.rules || []).filter(rule => rule.categoryId !== categoryId);

      if (Array.isArray(config.reviewQueue)) {
        config.reviewQueue = config.reviewQueue.map(item => {
          if (item.suggestedCategoryId === categoryId) {
            return {
              ...item,
              suggestedCategoryId: undefined,
              confidence: 0,
              reason: undefined,
            };
          }
          return item;
        });
      }

      if (config.feedback?.aiSuggestions) {
        config.feedback.aiSuggestions = config.feedback.aiSuggestions.filter(entry => (
          entry.suggestedCategoryId !== categoryId && entry.chosenCategoryId !== categoryId
        ));
      }
    }

    if (config.feedback?.aiSuggestions) {
      const summary = buildFeedbackSummary(config.feedback.aiSuggestions || [], config.categories || []);
      if (summary) {
        config.feedback.summary = summary;
      } else if (config.feedback.summary) {
        delete config.feedback.summary;
      }
    }

    config.categories = config.categories.filter(c => c.id !== categoryId);

    Object.keys(config.assignments).forEach(fileId => {
      if (config.assignments[fileId] === categoryId) {
        delete config.assignments[fileId];
        if (config.assignmentMeta) {
          delete config.assignmentMeta[fileId];
        }
      }
    });

    return await configManager.updateConfig(accessToken, config);
  }


  /**
   * Assign file to category
   */
  async assignCategory(accessToken: string, fileId: string, categoryId: string | null) {
    return await configManager.assignCategory(accessToken, fileId, categoryId);
  }

  /**
   * Bulk assign categories
   */
  async assignCategoriesBulk(
    accessToken: string,
    assignments: Array<{ fileId: string; categoryId: string | null }>
  ) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    // Update all assignments
    if (!config.assignmentMeta) {
      config.assignmentMeta = {};
    }
    assignments.forEach(({ fileId, categoryId }) => {
      if (categoryId === null) {
        delete config.assignments[fileId];
      } else {
        config.assignments[fileId] = categoryId;
      }
      delete config.assignmentMeta[fileId];
    });

    return await configManager.updateConfig(accessToken, config);
  }

  /**
   * Assign file to category with optimistic cache update
   * This version provides instant UI feedback with automatic rollback on failure
   */
  async assignCategoryOptimistic(
    accessToken: string,
    fileId: string,
    categoryId: string | null,
    options?: { skipCacheUpdate?: boolean }
  ) {
    // If skipCacheUpdate is true, just call the normal method
    if (options?.skipCacheUpdate) {
      return await this.assignCategory(accessToken, fileId, categoryId);
    }

    return await withOptimisticUpdate({
      optimisticUpdate: () => {
        // Update file in cache
        const updated = cacheManager.updateFileInCache(fileId, (file) => ({
          ...file,
          categoryId: categoryId,
          categorized: !!categoryId,
          inReview: false, // Categorizing removes from review
          assignmentMeta: undefined,
        }));

        if (updated) {
          // Remove from review queue if present
          cacheManager.removeFromReviewQueueCache(fileId);

          // Update category counts
          if (updated.categoryId && updated.categoryId !== categoryId) {
            // File was in a different category - decrement old
            cacheManager.updateCategoryCount(updated.categoryId, -1);
          }
          if (categoryId) {
            // Increment new category count
            cacheManager.updateCategoryCount(categoryId, 1);
            // Invalidate category cache to force refresh
            cacheManager.invalidateCategoryCache(categoryId);
          }
        }
      },
      apiCall: () => this.assignCategory(accessToken, fileId, categoryId),
      description: `Assign file ${fileId} to category ${categoryId}`,
    });
  }

  /**
   * Bulk assign categories with optimistic updates
   * For large batches, uses full cache invalidation for safety
   */
  async assignCategoriesBulkOptimistic(
    accessToken: string,
    assignments: Array<{ fileId: string; categoryId: string | null }>
  ) {
    // For bulk operations, we use optimistic updates but with full category cache invalidation
    // This is safer than trying to update hundreds of files individually
    return await withOptimisticUpdate({
      optimisticUpdate: () => {
        // Update all files in cache
        const updates = assignments.map(({ fileId, categoryId }) => ({
          fileId,
          updater: (file: any) => ({
            ...file,
            categoryId: categoryId,
            categorized: !!categoryId,
            inReview: false,
            assignmentMeta: undefined,
          }),
        }));

        cacheManager.updateFilesInCache(updates);

        // Remove from review queue
        assignments.forEach(({ fileId }) => {
          cacheManager.removeFromReviewQueueCache(fileId);
        });

        // Invalidate all category caches (safer for bulk)
        cacheManager.invalidateAllCategoryCaches();
      },
      apiCall: () => this.assignCategoriesBulk(accessToken, assignments),
      description: `Bulk assign ${assignments.length} files`,
    });
  }

  /**
   * Get rules
   */
  async getRules(accessToken: string, categoryId?: string) {
    const config = await configManager.getConfig(accessToken);
    
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
        rules: [],
      };
    }

    let rules = config.rules;
    if (categoryId) {
      rules = rules.filter(r => r.categoryId === categoryId);
    }

    return {
      success: true,
      rules,
    };
  }

  /**
   * Create rule
   */
  async createRule(accessToken: string, rule: Omit<Rule, 'id' | 'createdAt'>) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    // Set defaults for rule fields based on type
    const newRule: Rule = {
      ...rule,
      field: rule.field || (rule.type === 'keyword' ? 'filename' : rule.type === 'mimetype' ? 'mimeType' : 'owner'),
      operator: rule.operator || 'contains',
      caseSensitive: rule.caseSensitive ?? false,
      enabled: rule.enabled ?? true,
      id: 'rule_' + Date.now(),
      createdAt: new Date().toISOString(),
    };

    config.rules.push(newRule);
    const result = await configManager.updateConfig(accessToken, config);
    if (result.success) {
      cacheManager.invalidateReviewQueueCache();
    }

    return {
      ...result,
      rule: newRule,
    };
  }

  /**
   * Update rule
   */
  async updateRule(accessToken: string, ruleId: string, updates: Partial<Rule>) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    const ruleIndex = config.rules.findIndex(r => r.id === ruleId);
    if (ruleIndex === -1) {
      return {
        success: false,
        error: 'Rule not found',
      };
    }

    config.rules[ruleIndex] = {
      ...config.rules[ruleIndex],
      ...updates,
    };

    const result = await configManager.updateConfig(accessToken, config);
    if (result.success) {
      cacheManager.invalidateReviewQueueCache();
    }
    return result;
  }

  /**
   * Delete rule
   */
  async deleteRule(accessToken: string, ruleId: string) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    config.rules = config.rules.filter(r => r.id !== ruleId);
    const result = await configManager.updateConfig(accessToken, config);
    if (result.success) {
      cacheManager.invalidateReviewQueueCache();
    }
    return result;
  }

  /**
   * Get review queue - combines stored review items + dynamically generated rule matches
   * Note: Apps Script backend call skipped due to CORS preflight limitations
   */
  async getReviewQueue(accessToken: string, status?: string) {
    logger.debug('🔍 getReviewQueue: Starting...');
    
    // Load config to get rules, categories, assignments, and stored review queue
    const config = await configManager.getConfig(accessToken);
    
    if (!config) {
      logger.error('❌ getReviewQueue: Failed to load config');
      return {
        success: false,
        error: 'Failed to load config',
        queue: [],
      };
    }

    const syncResult = await this.syncFolderCategories(accessToken, config, { force: false });
    const effectiveConfig = syncResult.config;
    const rules = effectiveConfig.rules || [];
    const categories = effectiveConfig.categories || [];
    const assignments = effectiveConfig.assignments || {};
    const storedReviewQueue = effectiveConfig.reviewQueue || [];

    const folderCategoryMap = new Map<string, Category>();
    categories.forEach(category => {
      if (category.driveFolderId) {
        folderCategoryMap.set(category.driveFolderId, category);
      }
    });

    logger.debug('🔍 getReviewQueue: Config loaded', {
      rulesCount: rules.length,
      categoriesCount: categories.length,
      assignmentsCount: Object.keys(assignments).length,
      storedReviewCount: storedReviewQueue.length,
    });

    // Start with stored review queue items (manually added, no rules matched)
    const enhancedQueue: any[] = [];
    const cachedFiles = cacheManager.getFilesCache();
    const cachedFileMap = new Map<string, any>();
    cachedFiles.forEach(file => cachedFileMap.set(file.id, file));
    const storedItems = storedReviewQueue.filter(item => !status || item.status === status);
    const missingFileIds = new Set<string>();

    const normalizeCachedFile = (file: any) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      modifiedTime:
        file.modifiedTime ||
        (file.modifiedDate instanceof Date ? file.modifiedDate.toISOString() : undefined),
      iconLink: file.iconLink,
      thumbnailLink: file.thumbnailLink,
    });

    storedItems.forEach(item => {
      const file = item.file;
      const hasMetadata = file && file.name && file.name !== 'Unknown';
      if (!hasMetadata && !cachedFileMap.has(item.fileId)) {
        missingFileIds.add(item.fileId);
      }
    });

    const fetchedFileMap = new Map<string, any>();
    if (missingFileIds.size > 0) {
      const ids = Array.from(missingFileIds);
      const results = await asyncPool(4, ids, async (fileId) => {
        try {
          const fileResult = await driveClient.getFile(accessToken, fileId);
          if (fileResult.success && fileResult.file) {
            return {
              fileId,
              file: {
                id: fileResult.file.id,
                name: fileResult.file.name,
                mimeType: fileResult.file.mimeType,
                modifiedTime: fileResult.file.modifiedTime,
                iconLink: fileResult.file.iconLink,
                thumbnailLink: fileResult.file.thumbnailLink,
              },
            };
          }
        } catch (error) {
          logger.error('  ❌ Error fetching file:', error);
        }
        return { fileId, file: null };
      });

      results.forEach(result => {
        if (result?.fileId && result.file) {
          fetchedFileMap.set(result.fileId, result.file);
        }
      });
    }

    // Add stored review items - fetch file metadata from Drive if needed
    for (const item of storedItems) {
      logger.debug('🔍 Processing stored review item:', item.id, item.fileId);

      let file = item.file;
      const hasMetadata = file && file.name && file.name !== 'Unknown';

      if (!hasMetadata) {
        const cachedFile = cachedFileMap.get(item.fileId);
        if (cachedFile) {
          file = normalizeCachedFile(cachedFile);
        } else if (fetchedFileMap.has(item.fileId)) {
          file = fetchedFileMap.get(item.fileId);
        } else {
          file = {
            id: item.fileId,
            name: item.fileName || 'Unknown',
            mimeType: item.mimeType || '',
            modifiedTime: item.modifiedTime || '',
            iconLink: item.iconLink || '',
            thumbnailLink: item.thumbnailLink || '',
          };
        }
      }

      if (isExcludedMimeType(file?.mimeType)) {
        logger.debug('  ⏭️ Skipping excluded mime type for review queue:', file?.mimeType, file?.name);
        continue;
      }

      // Get suggested category if available
      let suggestedCategory = null;
      if (item.suggestedCategoryId) {
        suggestedCategory = categories.find((cat: any) => cat.id === item.suggestedCategoryId) || null;
      }

      enhancedQueue.push({
        id: item.id,
        fileId: item.fileId,
        file: file,
        suggestedCategoryId: item.suggestedCategoryId || null,
        suggestedCategory: suggestedCategory,
        confidence: item.confidence || 0,
        reason: item.reason || 'No matching rules found',
        source: item.source || 'manual',
        status: item.status || 'pending',
        addedAt: item.addedAt || item.createdAt || new Date().toISOString(),
      });
      
      const fileName = file?.name || item.fileName || 'Unknown';
      logger.debug('  ✅ Added to queue:', fileName);
    }

    logger.debug('🔍 getReviewQueue: After stored items:', enhancedQueue.length);

    // If rules exist, also evaluate uncategorized files
    if (rules.length > 0) {
      logger.debug('🔍 getReviewQueue: Fetching files from Drive to evaluate rules...');

      const filesForRules: any[] = [];
      if (cachedFiles.length > 0) {
        cachedFiles.forEach(file => {
          const modifiedTime =
            (file as any).modifiedTime ||
            (file.modifiedDate instanceof Date ? file.modifiedDate.toISOString() : undefined);
          filesForRules.push({
            ...file,
            modifiedTime,
          });
        });
      } else {
        const MAX_PAGES = 20;
        const PAGE_SIZE = 500;
        let pageToken: string | null = null;
        let pageCount = 0;

        do {
          const filesResult = await driveClient.listFiles(accessToken, {
            pageSize: PAGE_SIZE,
            pageToken: pageToken || undefined,
            q: 'trashed = false',
          });

          if (!filesResult.success) {
            break;
          }

          filesForRules.push(...(filesResult.files || []));
          pageToken = filesResult.nextPageToken || null;
          pageCount += 1;
        } while (pageToken && pageCount < MAX_PAGES);
      }

      if (filesForRules.length > 0) {
        logger.debug('🔍 getReviewQueue: Got files from Drive:', filesForRules.length);

        const uncategorizedFiles = filesForRules.filter((file: any) => {
          if (isExcludedMimeType(file?.mimeType)) return false;
          if (assignments[file.id]) return false;
          if (getFolderCategoryIdForFile(file, folderCategoryMap)) return false;
          return true;
        });
        logger.debug('🔍 getReviewQueue: Uncategorized files:', uncategorizedFiles.length);

        // Evaluate each uncategorized file against rules
        uncategorizedFiles.forEach((file: any) => {
          // Skip if already in stored review queue
          if (storedReviewQueue.find((item: any) => item.fileId === file.id)) {
            return;
          }

          // Find matching rules for this file
          const matchingRules: any[] = [];
          let suggestedCategoryId: string | null = null;

          for (const rule of rules) {
            if (evaluateFileAgainstRules(file, [rule])) {
              matchingRules.push(rule);
              // Use the first matching rule's category
              if (!suggestedCategoryId) {
                suggestedCategoryId = rule.categoryId;
              }
            }
          }

          // If file matches at least one rule, add to queue
          if (matchingRules.length > 0) {
            const category = categories.find((cat: any) => cat.id === suggestedCategoryId);
            const confidence = Math.min(matchingRules.length / rules.length, 1) * 100;
            
            const matchedRuleDescs = matchingRules.map(r => 
              `${r.field} ${r.operator} "${r.value}"`
            ).join(', ');
            
            const reason = `Matched ${matchingRules.length} rule(s): ${matchedRuleDescs}`;

            enhancedQueue.push({
              id: `auto-${file.id}`,
              fileId: file.id,
              file: {
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                modifiedTime: file.modifiedTime,
                iconLink: file.iconLink,
                thumbnailLink: file.thumbnailLink,
              },
              suggestedCategoryId: suggestedCategoryId,
              suggestedCategory: category ? {
                id: category.id,
                name: category.name,
                color: category.color,
                icon: category.icon,
              } : null,
              confidence: confidence,
              reason: reason,
              source: 'rules',
              status: 'pending',
              createdAt: new Date().toISOString(),
            });
          }
        });
        
        logger.debug('🔍 getReviewQueue: After rule evaluation:', enhancedQueue.length);
      }
    }

    // Sort by confidence (highest first)
    enhancedQueue.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    logger.debug('✅ getReviewQueue: Final queue:', enhancedQueue.length, 'items');
    if (enhancedQueue.length > 0) {
      logger.debug('  First item:', enhancedQueue[0]);
    }

    return {
      success: true,
      queue: enhancedQueue,
      total: enhancedQueue.length,
    };
  }

  /**
   * Accept review suggestion
   */
  async reviewAccept(accessToken: string, reviewId?: string, fileId?: string) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    // Find review item
    const reviewItem = config.reviewQueue.find(
      item => (reviewId && item.id === reviewId) || (fileId && item.fileId === fileId)
    );

    if (!reviewItem) {
      return {
        success: false,
        error: 'Review item not found',
      };
    }

    // Assign the suggested category
    config.assignments[reviewItem.fileId] = reviewItem.suggestedCategoryId!;
    if (!config.assignmentMeta) {
      config.assignmentMeta = {};
    }
    if (reviewItem.source === 'AI') {
      config.assignmentMeta[reviewItem.fileId] = {
        source: 'AI',
        reason: reviewItem.reason || 'No reason provided.',
        confidence: reviewItem.confidence,
        decidedAt: new Date().toISOString(),
      };
    } else {
      delete config.assignmentMeta[reviewItem.fileId];
    }
    
    // Remove from review queue
    config.reviewQueue = config.reviewQueue.filter(item => item.id !== reviewItem.id);
    
    return await configManager.updateConfig(accessToken, config);
  }

  /**
   * Override review suggestion
   */
  async reviewOverride(accessToken: string, categoryId: string, reviewId?: string, fileId?: string) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    // Find review item
    const reviewItem = config.reviewQueue.find(
      item => (reviewId && item.id === reviewId) || (fileId && item.fileId === fileId)
    );

    if (!reviewItem) {
      return {
        success: false,
        error: 'Review item not found',
      };
    }

    // Assign the override category
    config.assignments[reviewItem.fileId] = categoryId;
    if (config.assignmentMeta) {
      delete config.assignmentMeta[reviewItem.fileId];
    }
    
    // Remove from review queue
    config.reviewQueue = config.reviewQueue.filter(item => item.id !== reviewItem.id);
    
    return await configManager.updateConfig(accessToken, config);
  }

  /**
   * Skip review item
   */
  async reviewSkip(accessToken: string, reviewId?: string, fileId?: string) {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    // Remove from review queue
    config.reviewQueue = config.reviewQueue.filter(
      item => !(reviewId && item.id === reviewId) && !(fileId && item.fileId === fileId)
    );
    
    return await configManager.updateConfig(accessToken, config);
  }

  /**
   * Accept review suggestion with optimistic update
   */
  async reviewAcceptOptimistic(
    accessToken: string,
    reviewId?: string,
    fileId?: string,
    options?: { skipCacheUpdate?: boolean }
  ) {
    if (options?.skipCacheUpdate) {
      return await this.reviewAccept(accessToken, reviewId, fileId);
    }

    // First, get the review item to know what category to assign
    const queue = cacheManager.getReviewQueueCache();
    const reviewItem = queue.find(
      item => (reviewId && item.id === reviewId) || (fileId && item.fileId === fileId)
    );

    if (!reviewItem || !reviewItem.suggestedCategoryId) {
      // Fallback to non-optimistic if item not in cache
      return await this.reviewAccept(accessToken, reviewId, fileId);
    }

    const targetFileId = reviewItem.fileId;
    const targetCategoryId = reviewItem.suggestedCategoryId;
    const assignmentMeta =
      reviewItem.source === 'AI'
        ? {
            source: 'AI',
            reason: reviewItem.reason || 'No reason provided.',
            confidence: reviewItem.confidence,
            decidedAt: new Date().toISOString(),
          }
        : undefined;

    return await withOptimisticUpdate({
      optimisticUpdate: () => {
        // Update file: assign category and remove from review
        cacheManager.updateFileInCache(targetFileId, (file) => ({
          ...file,
          categoryId: targetCategoryId,
          categorized: true,
          inReview: false,
          assignmentMeta: assignmentMeta || undefined,
        }));

        // Remove from review queue
        cacheManager.removeFromReviewQueueCache(targetFileId);

        // Update category count
        cacheManager.updateCategoryCount(targetCategoryId, 1);
        cacheManager.invalidateCategoryCache(targetCategoryId);
      },
      apiCall: () => this.reviewAccept(accessToken, reviewId, fileId),
      description: `Accept review for file ${targetFileId}`,
    });
  }

  /**
   * Override review suggestion with optimistic update
   */
  async reviewOverrideOptimistic(
    accessToken: string,
    categoryId: string,
    reviewId?: string,
    fileId?: string,
    options?: { skipCacheUpdate?: boolean }
  ) {
    if (options?.skipCacheUpdate) {
      return await this.reviewOverride(accessToken, categoryId, reviewId, fileId);
    }

    // Get review item to find file ID
    const queue = cacheManager.getReviewQueueCache();
    const reviewItem = queue.find(
      item => (reviewId && item.id === reviewId) || (fileId && item.fileId === fileId)
    );

    if (!reviewItem) {
      // Fallback to non-optimistic if item not in cache
      return await this.reviewOverride(accessToken, categoryId, reviewId, fileId);
    }

    const targetFileId = reviewItem.fileId;

    return await withOptimisticUpdate({
      optimisticUpdate: () => {
        // Update file: assign override category and remove from review
        cacheManager.updateFileInCache(targetFileId, (file) => ({
          ...file,
          categoryId: categoryId,
          categorized: true,
          inReview: false,
          assignmentMeta: undefined,
        }));

        // Remove from review queue
        cacheManager.removeFromReviewQueueCache(targetFileId);

        // Update category count
        cacheManager.updateCategoryCount(categoryId, 1);
        cacheManager.invalidateCategoryCache(categoryId);
      },
      apiCall: () => this.reviewOverride(accessToken, categoryId, reviewId, fileId),
      description: `Override review for file ${targetFileId} to category ${categoryId}`,
    });
  }

  /**
   * Skip review item with optimistic update
   */
  async reviewSkipOptimistic(
    accessToken: string,
    reviewId?: string,
    fileId?: string,
    options?: { skipCacheUpdate?: boolean }
  ) {
    if (options?.skipCacheUpdate) {
      return await this.reviewSkip(accessToken, reviewId, fileId);
    }

    // Get review item to find file ID
    const queue = cacheManager.getReviewQueueCache();
    const reviewItem = queue.find(
      item => (reviewId && item.id === reviewId) || (fileId && item.fileId === fileId)
    );

    if (!reviewItem) {
      // Fallback to non-optimistic if item not in cache
      return await this.reviewSkip(accessToken, reviewId, fileId);
    }

    const targetFileId = reviewItem.fileId;

    return await withOptimisticUpdate({
      optimisticUpdate: () => {
        // Update file: remove from review (but don't categorize)
        cacheManager.updateFileInCache(targetFileId, (file) => ({
          ...file,
          inReview: false,
        }));

        // Remove from review queue
        cacheManager.removeFromReviewQueueCache(targetFileId);
      },
      apiCall: () => this.reviewSkip(accessToken, reviewId, fileId),
      description: `Skip review for file ${targetFileId}`,
    });
  }

  /**
   * Apply rules to files
   */
  async applyRules(accessToken: string, fileIds?: string[], _confidenceThreshold?: number) {
    // Get config and files
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
      };
    }

    // Get files to process
    let filesToProcess: string[] = [];
    if (fileIds && fileIds.length > 0) {
      filesToProcess = fileIds;
    } else {
      // Process all uncategorized files
      const filesResult = await this.listFiles(accessToken, { pageSize: 1000 });
      if (!filesResult.success) {
        return filesResult;
      }
      filesToProcess = filesResult.files
        .filter((f: any) => !f.categoryId)
        .map((f: any) => f.id);
    }

    // Apply rules to each file
    let assigned = 0;
    for (const fileId of filesToProcess) {
      const result = await this.autoAssign(accessToken, fileId);
      if (result.success && result.assigned) {
        assigned++;
      }
    }

    return {
      success: true,
      processed: filesToProcess.length,
      assigned,
    };
  }

  /**
   * Auto-assign single file using rules
   */
  async autoAssign(accessToken: string, fileId: string): Promise<AutoAssignResult> {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
        fileId,
        fileName: 'Unknown',
      };
    }

    const fileResult = await driveClient.getFile(accessToken, fileId);

    if (!fileResult.success || !fileResult.file) {
      return {
        success: false,
        error: fileResult.error || 'File not found',
        fileId,
        fileName: 'Unknown',
      };
    }

    const file = fileResult.file;
    const settings = normalizeAiSettings(config.settings);
    const categories = config.categories || [];
    const rules = config.rules || [];

    const setAssignmentMeta = (meta?: AssignmentMeta) => {
      if (!config.assignmentMeta) {
        config.assignmentMeta = {};
      }
      if (meta) {
        config.assignmentMeta[fileId] = meta;
      } else {
        delete config.assignmentMeta[fileId];
      }
    };

    const recordAiDecision = (decision?: AiDecisionCacheEntry) => {
      if (!decision) return;
      if (!config.aiDecisionCache) {
        config.aiDecisionCache = {};
      }
      config.aiDecisionCache[fileId] = decision;
      if (decision.contextKey) {
        config.aiDecisionCacheContextKey = decision.contextKey;
      }
      pruneAiDecisionCache(config);
    };

    const assignCategory = async (categoryId: string, meta?: AssignmentMeta) => {
      config.assignments[fileId] = categoryId;
      setAssignmentMeta(meta);
      await configManager.updateConfig(accessToken, config);
      return {
        success: true,
        assigned: true,
        categoryId,
        fileId,
        fileName: file.name,
      };
    };

    const addToReviewQueue = async (data: {
      suggestedCategoryId?: string | null;
      confidence?: number;
      reason?: string;
      source?: string;
    }) => {
      if (!config.reviewQueue) {
        config.reviewQueue = [];
      }

      const existingIndex = config.reviewQueue.findIndex(item => item.fileId === fileId);

      const reviewItem = {
        id: existingIndex >= 0 ? config.reviewQueue[existingIndex].id : 'review_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        iconLink: file.iconLink,
        thumbnailLink: file.thumbnailLink,
        status: 'pending' as const,
        suggestedCategoryId: data.suggestedCategoryId || undefined,
        confidence: data.confidence ?? 0,
        reason: data.reason || 'No matching rules found',
        source: data.source || 'auto-assign',
        createdAt: new Date().toISOString(),
      };

      if (existingIndex >= 0) {
        config.reviewQueue[existingIndex] = reviewItem;
      } else {
        config.reviewQueue.push(reviewItem);
      }

      await configManager.updateConfig(accessToken, config);
      cacheManager.invalidateReviewQueueCache();

      if (typeof window !== 'undefined') {
        const { userCache } = await import('@/utils/userCache');
        userCache.remove('inbox_all_files');
      }

      return {
        success: true,
        assigned: false,
        fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        addedToReview: true,
      };
    };

    const attemptRules = () => getRuleMatchCategoryId(file, rules);

    if (settings.aiEnabled && settings.aiPrimary) {
      const { decision, fromCache } = await this.resolveAiDecision(
        accessToken,
        config,
        file,
        fileId,
        categories,
        rules,
        settings
      );

      if (decision && !fromCache) {
        recordAiDecision(decision);
      }

      if (decision?.categoryId && decision.confidence >= settings.aiMinConfidence) {
        return await assignCategory(decision.categoryId, {
          source: 'AI',
          reason: decision.reason || 'No reason provided.',
          confidence: decision.confidence,
          model: decision.model || GEMINI_MODEL,
          decidedAt: decision.decidedAt,
        });
      }

      if (decision?.categoryId) {
        return await addToReviewQueue({
          suggestedCategoryId: decision.categoryId,
          confidence: decision.confidence,
          reason: decision.reason,
          source: 'AI',
        });
      }

      if (settings.aiUseRulesFallback) {
        const matchedCategoryId = attemptRules();
        if (matchedCategoryId) {
          return await assignCategory(matchedCategoryId);
        }
      }

      return await addToReviewQueue({
        reason: 'No matching AI suggestion',
        source: 'AI',
      });
    }

    const matchedCategoryId = attemptRules();
    if (matchedCategoryId) {
      return await assignCategory(matchedCategoryId);
    }

    if (settings.aiEnabled) {
      const { decision, fromCache } = await this.resolveAiDecision(
        accessToken,
        config,
        file,
        fileId,
        categories,
        rules,
        settings
      );

      if (decision && !fromCache) {
        recordAiDecision(decision);
      }

      if (decision?.categoryId && decision.confidence >= settings.aiMinConfidence) {
        return await assignCategory(decision.categoryId, {
          source: 'AI',
          reason: decision.reason || 'No reason provided.',
          confidence: decision.confidence,
          model: decision.model || GEMINI_MODEL,
          decidedAt: decision.decidedAt,
        });
      }
      if (decision?.categoryId) {
        return await addToReviewQueue({
          suggestedCategoryId: decision.categoryId,
          confidence: decision.confidence,
          reason: decision.reason,
          source: 'AI',
        });
      }
    }

    return await addToReviewQueue({
      reason: 'No matching rules found',
      source: settings.aiEnabled ? 'AI' : 'auto-assign',
    });
  }

  /**
   * Auto-assign a single file with optimistic cache updates
   * This version provides instant UI feedback without cache invalidation
   */
  async autoAssignOptimistic(accessToken: string, fileId: string): Promise<AutoAssignResult> {
    const config = await configManager.getConfig(accessToken);
    if (!config) {
      return {
        success: false,
        error: 'Failed to load config',
        fileId,
        fileName: 'Unknown',
      };
    }

    let file = cacheManager.getFilesCache().find(f => f.id === fileId);

    if (!file) {
      const fileResult = await driveClient.getFile(accessToken, fileId);
      if (!fileResult.success || !fileResult.file) {
        return {
          success: false,
          error: fileResult.error || 'File not found',
          fileId,
          fileName: 'Unknown',
        };
      }
      file = fileResult.file as any;
    }

    const settings = normalizeAiSettings(config.settings);
    const categories = config.categories || [];
    const rules = config.rules || [];

    const setAssignmentMeta = (meta?: AssignmentMeta) => {
      if (!config.assignmentMeta) {
        config.assignmentMeta = {};
      }
      if (meta) {
        config.assignmentMeta[fileId] = meta;
      } else {
        delete config.assignmentMeta[fileId];
      }
    };

    const recordAiDecision = (decision?: AiDecisionCacheEntry) => {
      if (!decision) return;
      if (!config.aiDecisionCache) {
        config.aiDecisionCache = {};
      }
      config.aiDecisionCache[fileId] = decision;
      if (decision.contextKey) {
        config.aiDecisionCacheContextKey = decision.contextKey;
      }
      pruneAiDecisionCache(config);
    };

    const assignOptimistic = async (categoryId: string, meta?: AssignmentMeta) => {
      return await withOptimisticUpdate({
        optimisticUpdate: () => {
          const updated = cacheManager.updateFileInCache(fileId, (f) => ({
            ...f,
            categoryId,
            categorized: true,
            inReview: false,
            assignmentMeta: meta || undefined,
          }));

          if (updated) {
            cacheManager.removeFromReviewQueueCache(fileId);

            if (updated.categoryId && updated.categoryId !== categoryId) {
              cacheManager.updateCategoryCount(updated.categoryId, -1);
            }
            cacheManager.updateCategoryCount(categoryId, 1);
            cacheManager.invalidateCategoryCache(categoryId);
          }
        },
        apiCall: async () => {
          config.assignments[fileId] = categoryId;
          setAssignmentMeta(meta);
          return await configManager.updateConfig(accessToken, config);
        },
        onSuccess: () => {
          logger.debug(`? Successfully assigned ${file!.name} to category ${categoryId}`);
        },
        description: `Auto-assign file ${fileId} to category ${categoryId}`,
      }).then(() => ({
        success: true,
        assigned: true,
        categoryId,
        fileId,
        fileName: file!.name,
      }));
    };

    const addToReviewOptimistic = async (data: {
      suggestedCategoryId?: string | null;
      confidence?: number;
      reason?: string;
      source?: string;
    }) => {
      return await withOptimisticUpdate({
        optimisticUpdate: () => {
          cacheManager.updateFileInCache(fileId, (f) => ({
            ...f,
            inReview: true,
          }));
        },
        apiCall: async () => {
          if (!config.reviewQueue) {
            config.reviewQueue = [];
          }

          const existingIndex = config.reviewQueue.findIndex(item => item.fileId === fileId);
          const reviewItem = {
            id: existingIndex >= 0 ? config.reviewQueue[existingIndex].id : 'review_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            fileId,
            fileName: file!.name,
            mimeType: file!.mimeType,
            modifiedTime: (file as any).modifiedTime || (file as any).modified,
            iconLink: (file as any).iconLink,
            thumbnailLink: (file as any).thumbnailLink,
            status: 'pending' as const,
            suggestedCategoryId: data.suggestedCategoryId || undefined,
            confidence: data.confidence ?? 0,
            reason: data.reason || 'No matching rules found',
            source: data.source || 'auto-assign',
            createdAt: new Date().toISOString(),
          };

          if (existingIndex >= 0) {
            config.reviewQueue[existingIndex] = reviewItem;
          } else {
            config.reviewQueue.push(reviewItem);
          }

          return await configManager.updateConfig(accessToken, config);
        },
        onSuccess: () => {
          logger.debug(`? Successfully added ${file!.name} to review queue`);
          cacheManager.invalidateReviewQueueCache();
        },
        description: `Add file ${fileId} to review queue`,
      }).then(() => ({
        success: true,
        assigned: false,
        fileId,
        fileName: file!.name,
        mimeType: file!.mimeType,
        modifiedTime: (file as any).modifiedTime || (file as any).modified,
        addedToReview: true,
      }));
    };

    const attemptRules = () => getRuleMatchCategoryId(file, rules);

    if (settings.aiEnabled && settings.aiPrimary) {
      const { decision, fromCache } = await this.resolveAiDecision(
        accessToken,
        config,
        file,
        fileId,
        categories,
        rules,
        settings
      );

      if (decision && !fromCache) {
        recordAiDecision(decision);
      }

      if (decision?.categoryId && decision.confidence >= settings.aiMinConfidence) {
        return await assignOptimistic(decision.categoryId, {
          source: 'AI',
          reason: decision.reason || 'No reason provided.',
          confidence: decision.confidence,
          model: decision.model || GEMINI_MODEL,
          decidedAt: decision.decidedAt,
        });
      }

      if (decision?.categoryId) {
        return await addToReviewOptimistic({
          suggestedCategoryId: decision.categoryId,
          confidence: decision.confidence,
          reason: decision.reason,
          source: 'AI',
        });
      }

      if (settings.aiUseRulesFallback) {
        const matchedCategoryId = attemptRules();
        if (matchedCategoryId) {
          return await assignOptimistic(matchedCategoryId);
        }
      }

      return await addToReviewOptimistic({
        reason: 'No matching AI suggestion',
        source: 'AI',
      });
    }

    const matchedCategoryId = attemptRules();
    if (matchedCategoryId) {
      return await assignOptimistic(matchedCategoryId);
    }

    if (settings.aiEnabled) {
      const { decision, fromCache } = await this.resolveAiDecision(
        accessToken,
        config,
        file,
        fileId,
        categories,
        rules,
        settings
      );

      if (decision && !fromCache) {
        recordAiDecision(decision);
      }

      if (decision?.categoryId && decision.confidence >= settings.aiMinConfidence) {
        return await assignOptimistic(decision.categoryId, {
          source: 'AI',
          reason: decision.reason || 'No reason provided.',
          confidence: decision.confidence,
          model: decision.model || GEMINI_MODEL,
          decidedAt: decision.decidedAt,
        });
      }
      if (decision?.categoryId) {
        return await addToReviewOptimistic({
          suggestedCategoryId: decision.categoryId,
          confidence: decision.confidence,
          reason: decision.reason,
          source: 'AI',
        });
      }
    }

    return await addToReviewOptimistic({
      reason: 'No matching rules found',
      source: settings.aiEnabled ? 'AI' : 'auto-assign',
    });
  }

  /**
   * Batch auto-assign files with optimistic cache updates
   */
  async batchAutoAssignOptimistic(accessToken: string, fileIds: string[]) {
    const assignedList: Array<{ fileId: string; fileName: string; categoryId: string }> = [];
    const noMatchList: Array<{ fileId: string; fileName: string; mimeType: string; modifiedTime: string }> = [];
    const errorsList: Array<{ fileId: string; error: string }> = [];

    const results = await asyncPool(4, fileIds, async (fileId) => {
      try {
        const result = await this.autoAssignOptimistic(accessToken, fileId);
        return { fileId, result };
      } catch (error: any) {
        return { fileId, error: error.message || 'Unknown error' };
      }
    });

    results.forEach(({ fileId, result, error }) => {
      if (error) {
        errorsList.push({ fileId, error });
        return;
      }
      if (!result?.success) {
        errorsList.push({ fileId, error: result?.error || 'Unknown error' });
      } else if (result.assigned) {
        assignedList.push({
          fileId: result.fileId!,
          fileName: result.fileName!,
          categoryId: result.categoryId!,
        });
      } else {
        noMatchList.push({
          fileId: result.fileId!,
          fileName: result.fileName!,
          mimeType: result.mimeType || '',
          modifiedTime: result.modifiedTime || '',
        });
      }
    });

    return {
      success: true,
      results: {
        assigned: assignedList,
        noMatch: noMatchList,
        errors: errorsList,
      },
      summary: {
        total: fileIds.length,
        assigned: assignedList.length,
        noMatch: noMatchList.length,
        errors: errorsList.length,
      },
    };
  }

  /**
   * Batch auto-assign files
   * TODO [CACHE-SYNC-2]: Returns detailed results including full file metadata
   * for files added to review queue (noMatch array) to enable immediate UI updates
   */
  async batchAutoAssign(accessToken: string, fileIds: string[]) {
    const assignedList: Array<{ fileId: string; fileName: string; categoryId: string }> = [];
    const noMatchList: Array<{ fileId: string; fileName: string; mimeType: string; modifiedTime: string }> = [];
    const errorsList: Array<{ fileId: string; error: string }> = [];

    const results = await asyncPool(4, fileIds, async (fileId) => {
      try {
        const result = await this.autoAssign(accessToken, fileId);
        return { fileId, result };
      } catch (error: any) {
        return { fileId, error: error.message || 'Unknown error' };
      }
    });

    results.forEach(({ fileId, result, error }) => {
      if (error) {
        errorsList.push({ fileId, error });
        return;
      }
      if (!result?.success) {
        errorsList.push({ fileId, error: result?.error || 'Unknown error' });
      } else if (result.assigned) {
        assignedList.push({
          fileId: result.fileId!,
          fileName: result.fileName!,
          categoryId: result.categoryId!,
        });
      } else {
        // TODO [CACHE-SYNC-2]: Include full file metadata for immediate UI updates
        noMatchList.push({
          fileId: result.fileId!,
          fileName: result.fileName!,
          mimeType: result.mimeType || '',
          modifiedTime: result.modifiedTime || '',
        });
      }
    });

    return {
      success: true,
      results: {
        assigned: assignedList,
        noMatch: noMatchList, // Now includes full metadata
        errors: errorsList,
      },
      summary: {
        total: fileIds.length,
        assigned: assignedList.length,
        noMatch: noMatchList.length,
        errors: errorsList.length,
      },
    };
  }

  /**
   * Get file view URL for preview with authenticated access
   * Uses OAuth token to generate URLs that work regardless of browser's logged-in Google account
   */
  async getFileViewUrl(accessToken: string, fileId: string) {
    try {
      // Get file metadata from Drive API
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,thumbnailLink,iconLink,size`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Failed to get file metadata');
      }

      const file = await response.json();
      
      // Determine view type and generate authenticated preview URL
      let viewType = 'external';
      let embedUrl = null;
      let authenticatedPreviewUrl = null;

      // Google Docs - use native preview URL
      if (file.mimeType === 'application/vnd.google-apps.document') {
        viewType = 'embed';
        embedUrl = `https://docs.google.com/document/d/${fileId}/preview`;
        authenticatedPreviewUrl = embedUrl;
      }
      // Google Sheets - use native preview URL
      else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
        viewType = 'embed';
        embedUrl = `https://docs.google.com/spreadsheets/d/${fileId}/preview`;
        authenticatedPreviewUrl = embedUrl;
      }
      // Google Slides - use native preview URL
      else if (file.mimeType === 'application/vnd.google-apps.presentation') {
        viewType = 'embed';
        embedUrl = `https://docs.google.com/presentation/d/${fileId}/preview`;
        authenticatedPreviewUrl = embedUrl;
      }
      // PDFs - use authenticated download URL with blob viewer
      else if (file.mimeType === 'application/pdf') {
        viewType = 'pdf';
        // Return the authenticated download URL that will be fetched and displayed as blob
        authenticatedPreviewUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        embedUrl = authenticatedPreviewUrl;
      }
      // Images - use authenticated download URL with blob viewer
      else if (file.mimeType?.startsWith('image/')) {
        viewType = 'image';
        // Return the authenticated download URL that will be fetched and displayed as blob
        authenticatedPreviewUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        embedUrl = authenticatedPreviewUrl;
      }
      // Other Google Workspace files (Forms, Drawings, etc) - use webViewLink
      else if (file.mimeType?.includes('google-apps')) {
        viewType = 'embed';
        embedUrl = file.webViewLink;
        authenticatedPreviewUrl = file.webViewLink;
      }
      // Plain text files
      else if (file.mimeType === 'text/plain' || 
               file.mimeType === 'text/html' ||
               file.mimeType === 'text/css' ||
               file.mimeType === 'text/javascript' ||
               file.mimeType === 'application/json' ||
               file.mimeType === 'application/xml') {
        viewType = 'text';
        authenticatedPreviewUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
        embedUrl = authenticatedPreviewUrl;
      }

      return {
        success: true,
        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          webViewLink: file.webViewLink,
          embedLink: embedUrl,
          authenticatedPreviewUrl,
          viewType,
          thumbnailLink: file.thumbnailLink,
          iconLink: file.iconLink,
          size: file.size,
        },
      };
    } catch (error: any) {
      logger.error('getFileViewUrl error:', error);
      return {
        success: false,
        error: error.message || 'Failed to get file view URL',
      };
    }
  }

  /**
   * Get file download URL with export format options for Google Workspace files
   */
  async getFileDownloadUrl(accessToken: string, fileId: string, exportFormat?: string) {
    try {
      // Get file metadata
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,webContentLink`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to get file metadata');
      }

      const file = await response.json();
      const isGoogleWorkspace = file.mimeType?.includes('google-apps');
      
      let downloadUrl = file.webContentLink;
      const fallbackDownloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      let exportFormats: any[] = [];

      if (isGoogleWorkspace) {
        exportFormats = this.getExportFormats(file.mimeType);
        
        // Generate export URL
        const format = exportFormat || exportFormats[0]?.format;
        const exportMimeType = exportFormats.find(f => f.format === format)?.mimeType;
        
        if (exportMimeType) {
          downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`;
        }
      }


      if (!isGoogleWorkspace && !downloadUrl) {
        downloadUrl = fallbackDownloadUrl;
      }
      return {
        success: true,
        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          downloadUrl,
          size: file.size,
          isGoogleWorkspace,
          exportFormats,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get file download URL',
      };
    }
  }

  /**
   * Get export formats for Google Workspace files
   */
  private getExportFormats(mimeType: string) {
    const formats: any[] = [];

    if (mimeType === 'application/vnd.google-apps.document') {
      formats.push(
        { format: 'pdf', mimeType: 'application/pdf', label: 'PDF' },
        { format: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word (.docx)' },
        { format: 'txt', mimeType: 'text/plain', label: 'Plain Text (.txt)' },
        { format: 'html', mimeType: 'text/html', label: 'HTML (.html)' }
      );
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      formats.push(
        { format: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel (.xlsx)' },
        { format: 'pdf', mimeType: 'application/pdf', label: 'PDF' },
        { format: 'csv', mimeType: 'text/csv', label: 'CSV (first sheet)' }
      );
    } else if (mimeType === 'application/vnd.google-apps.presentation') {
      formats.push(
        { format: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint (.pptx)' },
        { format: 'pdf', mimeType: 'application/pdf', label: 'PDF' }
      );
    } else if (mimeType === 'application/vnd.google-apps.drawing') {
      formats.push(
        { format: 'png', mimeType: 'image/png', label: 'PNG' },
        { format: 'pdf', mimeType: 'application/pdf', label: 'PDF' }
      );
    }

    return formats;
  }

  /**
   * Clear config cache (call on logout)
   */
  clearCache() {
    configManager.clearCache();
  }
}

export const unifiedClient = new UnifiedClient();
