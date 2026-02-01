import React, { useState, useEffect } from 'react';
import { logger } from '@/utils/logger';
import toast from 'react-hot-toast';
import Tooltip from '@/components/common/Tooltip';
import { appsScriptClient } from '@/lib/appsScriptClient';
import { config } from '@/lib/config';
import { userCache } from '@/utils/userCache';
import './RulesPage.css';

interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  description?: string;
  keywords?: string[];
  examples?: string[];
  fileCount?: number;
}

interface Rule {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  type: 'keyword' | 'mimetype' | 'owner';
  field?: string;
  operator?: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'matches';
  value: string;
  caseSensitive?: boolean;
  enabled?: boolean;
  confidence?: number;
}

const RulesPage: React.FC = () => {
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [isLoadingRules, setIsLoadingRules] = useState(false);
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);
  const aiSuggestionsLocked = !config.features.aiSuggestionsEnabled;

  const defaultSettings = {
    aiEnabled: false,
    aiPrimary: true,
    aiUseRulesFallback: true,
    aiMinConfidence: 0.9,
  };

  // Form state for rule modal
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [ruleEntries, setRuleEntries] = useState<Array<{
    type: 'keyword' | 'mimetype' | 'owner';
    value: string;
    confidence: number;
  }>>([{ type: 'keyword', value: '', confidence: 75 }]);

  // State for real data
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, { description: string; keywords: string; examples: string }>>({});
  const [settings, setSettings] = useState(defaultSettings);
  const [categoryPageSize, setCategoryPageSize] = useState(5);
  const [currentCategoryPage, setCurrentCategoryPage] = useState(1);

  // Load categories on mount
  useEffect(() => {
    loadCategories();
    loadRules();
    loadSettings();
  }, []);

  const loadCategories = async () => {
    try {
      // Try cache first
      const cachedConfigVersion = userCache.getConfigVersion();
      const cachedCategories = userCache.get<Category[]>('categories', {
        configVersion: cachedConfigVersion ?? undefined,
      });
      if (cachedCategories) {
        logger.debug('📦 Loading categories from user cache');
        setCategories(cachedCategories);
        return;
      }
      
      const response = await appsScriptClient.getCategories();
      if (response.success) {
        const configVersion =
          typeof response.configVersion === 'number' && Number.isFinite(response.configVersion)
            ? response.configVersion
            : undefined;
        if (configVersion !== undefined) {
          userCache.setConfigVersion(configVersion);
        }
        setCategories(response.categories || []);
        userCache.set('categories', response.categories || [], { configVersion });
      } else {
        toast.error('Failed to load categories');
      }
    } catch (error: any) {
      logger.error('Error loading categories:', error);
      toast.error('Failed to load categories: ' + error.message);
    }
  };

  const loadRules = async () => {
    setIsLoadingRules(true);
    try {
      const response = await appsScriptClient.getRules();
      if (response.success) {
        setRules(response.rules || []);
      } else {
        toast.error('Failed to load rules');
      }
    } catch (error: any) {
      logger.error('Error loading rules:', error);
      toast.error('Failed to load rules: ' + error.message);
    } finally {
      setIsLoadingRules(false);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await appsScriptClient.getSettings();
      if (response.success && response.settings) {
        setSettings({ ...defaultSettings, ...response.settings });
      }
    } catch (error: any) {
      logger.error('Error loading settings:', error);
    }
  };

  useEffect(() => {
    if (categories.length === 0) return;
    setCategoryDrafts(prev => {
      const next = { ...prev };
      categories.forEach(category => {
        if (!next[category.id]) {
          next[category.id] = {
            description: category.description || '',
            keywords: (category.keywords || []).join(', '),
            examples: (category.examples || []).join(', '),
          };
        }
      });
      return next;
    });
  }, [categories]);

  const handleDeleteRule = async (ruleId: string) => {
    try {
      const response = await appsScriptClient.deleteRule(ruleId);
      if (response.success) {
        // Reload rules from backend to ensure sync
        await loadRules();
        toast.success('Rule deleted successfully');
      } else {
        toast.error('Failed to delete rule: ' + response.error);
      }
    } catch (error: any) {
      logger.error('Error deleting rule:', error);
      toast.error('Failed to delete rule: ' + error.message);
    }
  };

  const handleOpenModal = (rule?: Rule, categoryId?: string) => {
    if (rule) {
      setEditingRule(rule);
      setSelectedCategoryId(rule.categoryId);
      setRuleEntries([{ type: rule.type, value: rule.value, confidence: rule.confidence ?? 75 }]);
    } else {
      setEditingRule(null);
      setSelectedCategoryId(categoryId || '');
      setRuleEntries([{ type: 'keyword', value: '', confidence: 75 }]);
    }
    setShowRuleModal(true);
  };

  const handleCloseModal = () => {
    setShowRuleModal(false);
    setEditingRule(null);
    setSelectedCategoryId('');
    setRuleEntries([{ type: 'keyword', value: '', confidence: 75 }]);
  };

  const handleSaveRule = async () => {
    const validEntries = ruleEntries.filter(entry => entry.value.trim());
    if (!selectedCategoryId || validEntries.length === 0) {
      toast.error('Please select a category and enter rule values');
      return;
    }

    const category = categories.find(c => c.id === selectedCategoryId);
    if (!category) {
      toast.error('Category not found');
      return;
    }

    setIsSavingRule(true);
    try {
      if (editingRule) {
        // Update existing rule with first entry
        const [firstEntry, ...additionalEntries] = validEntries;
        
        const response = await appsScriptClient.updateRule({
          id: editingRule.id,
          categoryId: selectedCategoryId,
          type: firstEntry.type,
          value: firstEntry.value,
          confidence: firstEntry.confidence,
        });

        if (response.success) {
          // Create new rules for additional entries if any
          if (additionalEntries.length > 0) {
            const newRulesPromises = additionalEntries.map(entry =>
              appsScriptClient.createRule({
                categoryId: selectedCategoryId,
                type: entry.type,
                value: entry.value,
                confidence: entry.confidence,
              })
            );

            await Promise.all(newRulesPromises);
          }

          // Reload rules from backend to ensure sync
          await loadRules();
          toast.success('Rule updated successfully');
        } else {
          toast.error('Failed to update rule: ' + response.error);
        }
      } else {
        // Create new rules for each entry
        const createPromises = validEntries.map(entry =>
          appsScriptClient.createRule({
            categoryId: selectedCategoryId,
            type: entry.type,
            value: entry.value,
            confidence: entry.confidence,
          })
        );

        const responses = await Promise.all(createPromises);
        const successfulCount = responses.filter(r => r.success).length;

        if (successfulCount > 0) {
          // Reload rules from backend to ensure sync
          await loadRules();
          toast.success(`${successfulCount} rule(s) created successfully`);
        } else {
          toast.error('Failed to create rules');
        }
      }

      handleCloseModal();
    } catch (error: any) {
      logger.error('Error saving rule:', error);
      toast.error('Failed to save rule: ' + error.message);
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleAddRuleEntry = () => {
    setRuleEntries([...ruleEntries, { type: 'keyword', value: '', confidence: 75 }]);
  };

  const handleRemoveRuleEntry = (index: number) => {
    if (ruleEntries.length > 1) {
      setRuleEntries(ruleEntries.filter((_, i) => i !== index));
    }
  };

  const handleUpdateRuleEntry = (index: number, field: 'type' | 'value' | 'confidence', value: any) => {
    setRuleEntries(ruleEntries.map((entry, i) => 
      i === index ? { ...entry, [field]: value } : entry
    ));
  };

  const handleSettingsChange = (field: keyof typeof defaultSettings, value: boolean | number) => {
    setSettings(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    try {
      const response = await appsScriptClient.updateSettings(settings);
      if (response.success) {
        if (!settings.aiEnabled) {
          userCache.remove('review_queue');
        }
        toast.success('Settings saved');
      } else {
        toast.error(response.error || 'Failed to save settings');
      }
    } catch (error: any) {
      toast.error('Failed to save settings: ' + error.message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCategoryDraftChange = (categoryId: string, field: 'description' | 'keywords' | 'examples', value: string) => {
    setCategoryDrafts(prev => ({
      ...prev,
      [categoryId]: {
        ...prev[categoryId],
        [field]: value,
      },
    }));
  };

  const parseList = (value: string) =>
    value.split(',').map(item => item.trim()).filter(Boolean);

  const handleSaveCategoryDetails = async (category: Category) => {
    const draft = categoryDrafts[category.id];
    if (!draft) return;

    setSavingCategoryId(category.id);
    try {
      const updatedCategory = {
        ...category,
        description: draft.description,
        keywords: parseList(draft.keywords),
        examples: parseList(draft.examples),
      };

      const response = await appsScriptClient.updateCategory(updatedCategory);
      if (response.success) {
        const updatedCategories = categories.map(cat =>
          cat.id === category.id ? updatedCategory : cat
        );
        setCategories(updatedCategories);
        userCache.set('categories', updatedCategories);
        toast.success('Category details saved');
      } else {
        toast.error(response.error || 'Failed to save category details');
      }
    } catch (error: any) {
      toast.error('Failed to save category details: ' + error.message);
    } finally {
      setSavingCategoryId(null);
    }
  };

  const totalCategoryPages = Math.max(1, Math.ceil(categories.length / categoryPageSize));
  const categoryStartIndex = (currentCategoryPage - 1) * categoryPageSize;
  const categoryEndIndex = Math.min(categoryStartIndex + categoryPageSize, categories.length);
  const pagedCategories = categories.slice(categoryStartIndex, categoryEndIndex);

  useEffect(() => {
    if (currentCategoryPage > totalCategoryPages) {
      setCurrentCategoryPage(totalCategoryPages);
    }
  }, [categories.length, categoryPageSize, currentCategoryPage, totalCategoryPages]);

  const handleCategoryPageSizeChange = (value: number) => {
    setCategoryPageSize(value);
    setCurrentCategoryPage(1);
  };

  const handleCategoryPreviousPage = () => {
    if (currentCategoryPage > 1) {
      setCurrentCategoryPage(currentCategoryPage - 1);
    }
  };

  const handleCategoryNextPage = () => {
    if (currentCategoryPage < totalCategoryPages) {
      setCurrentCategoryPage(currentCategoryPage + 1);
    }
  };

  const getRuleTypeLabel = (type: string) => {
    const labels = {
      keyword: 'Keyword Match',
      mimetype: 'File Type',
      owner: 'Owner/Domain'
    };
    return labels[type as keyof typeof labels];
  };

  return (
    <div className="rules-page">
      <div className="rules-container">
        <div className="section-header">
          <h1 className="page-title">Auto-Categorization Rules</h1>
        </div>

        <div className="ai-settings">
          <div className="ai-settings-header">
            <h2>AI & Rules Settings</h2>
            <button
              className="settings-save-btn"
              onClick={handleSaveSettings}
              disabled={isSavingSettings || aiSuggestionsLocked}
            >
              {isSavingSettings ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
          {aiSuggestionsLocked && (
            <div className="ai-settings-notice">AI suggestions are disabled by the server. Enable VITE_AI_SUGGESTIONS_ENABLED to unlock.</div>
          )}

          <div className="ai-settings-grid">
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.aiEnabled}
                onChange={(e) => handleSettingsChange('aiEnabled', e.target.checked)}
              />
              <span>Enable AI categorization</span>
            </label>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.aiPrimary}
                onChange={(e) => handleSettingsChange('aiPrimary', e.target.checked)}
                disabled={!settings.aiEnabled || aiSuggestionsLocked}
              />
              <span>Use AI before rules</span>
            </label>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.aiUseRulesFallback}
                onChange={(e) => handleSettingsChange('aiUseRulesFallback', e.target.checked)}
                disabled={!settings.aiEnabled || aiSuggestionsLocked}
              />
              <span>Fallback to rules when AI is unsure</span>
            </label>

            <div className="settings-slider">
              <div className="slider-label">
                <span>AI confidence threshold</span>
                <span>{Math.round(settings.aiMinConfidence * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1"
                step="0.05"
                value={settings.aiMinConfidence}
                onChange={(e) => handleSettingsChange('aiMinConfidence', Number(e.target.value))}
                disabled={!settings.aiEnabled || aiSuggestionsLocked}
              />
            </div>
          </div>
        </div>

        {isLoadingRules ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading rules...</p>
          </div>
        ) : (
          <>
            <div className="rules-list">
            {/* Group rules by category */}
            {pagedCategories.map((category) => {
              const categoryRules = rules.filter(r => r.categoryId === category.id);

              return (
                <div key={category.id} className="category-rules-group">
                  <div className="category-group-header">
                    <div className="rule-category">
                      <span
                        className="category-badge"
                        style={{ backgroundColor: category.color }}
                      >
                        <span className="category-icon"><i className={`fa-solid ${category.icon}`}></i></span>
                        <span>{category.name}</span>
                      </span>
                      <span className="rule-count">{categoryRules.length} {categoryRules.length === 1 ? 'rule' : 'rules'}</span>
                    </div>
                    <Tooltip content={`Add rule to ${category.name}`} position="top">
                      {categoryRules.length > 0 ? (
                        <button
                          className="add-category-rule-btn icon-only"
                          onClick={() => handleOpenModal(undefined, category.id)}
                          aria-label={`Add rule to ${category.name}`}
                        >
                          <i className="fa-solid fa-plus"></i>
                        </button>
                      ) : (
                        <button
                          className="add-category-rule-btn"
                          onClick={() => handleOpenModal(undefined, category.id)}
                          aria-label={`Add rule to ${category.name}`}
                        >
                          <span>+</span> Add Rule
                        </button>
                      )}
                    </Tooltip>
                  </div>

                  <div className="category-details">
                    <div className="category-details-header">
                      <span className="details-title">
                        <i className="fa-solid fa-robot"></i>
                        AI Guidance
                      </span>
                      <span className="details-subtitle">Used to help the AI categorize files</span>
                    </div>
                    <div className="details-field">
                      <label>
                        <span className="details-label">AI Description</span>
                        <span className="details-hint">Explain what belongs in this category</span>
                      </label>
                      <textarea
                        value={categoryDrafts[category.id]?.description || ''}
                        onChange={(e) => handleCategoryDraftChange(category.id, 'description', e.target.value)}
                        placeholder="Tell the AI what should go into this category"
                        rows={2}
                      />
                    </div>
                    <div className="details-field">
                      <label>
                        <span className="details-label">AI Keywords</span>
                        <span className="details-hint">Words or phrases the AI should look for</span>
                      </label>
                      <input
                        type="text"
                        value={categoryDrafts[category.id]?.keywords || ''}
                        onChange={(e) => handleCategoryDraftChange(category.id, 'keywords', e.target.value)}
                        placeholder="invoice, receipt, contract"
                      />
                    </div>
                    <div className="details-field">
                      <label>
                        <span className="details-label">AI Examples</span>
                        <span className="details-hint">Sample file names for better matches</span>
                      </label>
                      <input
                        type="text"
                        value={categoryDrafts[category.id]?.examples || ''}
                        onChange={(e) => handleCategoryDraftChange(category.id, 'examples', e.target.value)}
                        placeholder="2024 taxes.pdf, January rent"
                      />
                    </div>
                    <button
                      className="details-save-btn"
                      onClick={() => handleSaveCategoryDetails(category)}
                      disabled={savingCategoryId === category.id}
                    >
                      {savingCategoryId === category.id ? 'Saving...' : 'Save Details'}
                    </button>
                  </div>

                  {categoryRules.length === 0 && (
                    <div className="rules-empty-inline">
                      <span className="rules-empty-title">No rules yet</span>
                      <span className="rules-empty-subtitle">Add a rule to start auto-categorizing.</span>
                    </div>
                  )}

                  {categoryRules.map((rule, index) => (
                    <div
                      key={rule.id}
                      className="rule-card"
                      style={{ animationDelay: `${index * 75}ms` }}
                    >
                      <div className="rule-header">
                        <div className="rule-type-label">{getRuleTypeLabel(rule.type)}</div>
                        <div className="rule-actions">
                          <button
                            className="rule-action-btn edit"
                            onClick={() => handleOpenModal(rule)}
                          >
                            <i className="fa-solid fa-pen"></i>
                          </button>
                          <button
                            className="rule-action-btn delete"
                            onClick={() => handleDeleteRule(rule.id)}
                          >
                            <i className="fa-regular fa-trash-can"></i>
                          </button>
                        </div>
                      </div>

                      <div className="rule-details">
                        <div className="rule-value">{rule.value}</div>
                        <div className="rule-confidence">
                          <span className="confidence-label">Confidence:</span>
                          <span className="confidence-value">{(rule.confidence ?? 75)}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>

      {/* Pagination */}
      <div className="pagination-bar">
        <div className="pagination-left">
          <span className="pagination-info">
            Showing {categories.length == 0 ? 0 : categoryStartIndex + 1}-{categoryEndIndex} of {categories.length}
          </span>
          <div className="items-per-page">
            <label className="items-label">Categories per page:</label>
            <select
              className="items-select"
              value={categoryPageSize}
              onChange={(e) => handleCategoryPageSizeChange(Number(e.target.value))}
            >
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={15}>15</option>
            </select>
          </div>
        </div>
        <div className="pagination-controls">
          <span
            className={`pagination-link \${currentCategoryPage === 1 ? 'disabled' : ''}`}
            onClick={handleCategoryPreviousPage}
          >
            Previous
          </span>
          <span className="pagination-separator">|</span>
          <span className="page-indicator">
            <span className="page-text">Page </span>
            {totalCategoryPages > 1 ? (
              <select
                className="page-select"
                value={currentCategoryPage}
                onChange={(e) => setCurrentCategoryPage(Number(e.target.value))}
              >
                {Array.from({ length: totalCategoryPages }, (_, i) => i + 1).map(pageNum => (
                  <option key={pageNum} value={pageNum}>{pageNum}</option>
                ))}
              </select>
            ) : (
              <span className="current-page-number">{currentCategoryPage}</span>
            )}
            {' '}of {totalCategoryPages || 1}
          </span>
          <span className="pagination-separator">|</span>
          <span
            className={`pagination-link \${currentCategoryPage >= totalCategoryPages || totalCategoryPages == 0 ? 'disabled' : ''}`}
            onClick={handleCategoryNextPage}
          >
            Next
          </span>
        </div>
      </div>

      {/* Rule Modal */}
      {showRuleModal && (
        <div className="modal-backdrop" onClick={handleCloseModal}>
          <div className="rule-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingRule ? 'Edit Rule' : 'Create New Rule'}</h3>
              <button className="modal-close-btn" onClick={handleCloseModal}><i className="fa-solid fa-xmark"></i></button>
            </div>

            <div className="modal-body">
              {/* Category Selector */}
              <div className="form-field">
                <label className="field-label">Target Category</label>
                <select
                  className="field-select"
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                >
                  <option value="">Select a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Rule Entries */}
              <div className="rule-entries-section">
                <div className="rule-entries-header">
                  <label className="field-label">Rules</label>
                  <button className="add-rule-entry-btn" onClick={handleAddRuleEntry}>
                    <span>+</span> Add Rule
                  </button>
                </div>

                {ruleEntries.map((entry, index) => (
                  <div key={index} className="rule-entry-card">
                    {ruleEntries.length > 1 && (
                      <button 
                        className="remove-entry-btn" 
                        onClick={() => handleRemoveRuleEntry(index)}
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    )}

                    {/* Rule Type Selector */}
                    <div className="entry-field">
                      <label className="entry-label">Rule Type</label>
                      <div className="rule-type-options">
                        <button
                          className={`rule-type-btn ${entry.type === 'keyword' ? 'active' : ''}`}
                          onClick={() => handleUpdateRuleEntry(index, 'type', 'keyword')}
                        >
                          <span className="type-icon"><i className="fa-solid fa-font"></i></span>
                          <span>Keyword</span>
                        </button>
                        <button
                          className={`rule-type-btn ${entry.type === 'mimetype' ? 'active' : ''}`}
                          onClick={() => handleUpdateRuleEntry(index, 'type', 'mimetype')}
                        >
                          <span className="type-icon"><i className="fa-solid fa-file"></i></span>
                          <span>File Type</span>
                        </button>
                        <button
                          className={`rule-type-btn ${entry.type === 'owner' ? 'active' : ''}`}
                          onClick={() => handleUpdateRuleEntry(index, 'type', 'owner')}
                        >
                          <span className="type-icon"><i className="fa-solid fa-user"></i></span>
                          <span>Owner</span>
                        </button>
                      </div>
                    </div>

                    {/* Rule Value Input */}
                    <div className="entry-field">
                      <label className="entry-label">
                        {entry.type === 'keyword' && 'Keywords (comma-separated)'}
                        {entry.type === 'mimetype' && 'File Extensions (comma-separated)'}
                        {entry.type === 'owner' && 'Owner Email or Domain'}
                      </label>
                      <input
                        type="text"
                        className="field-input"
                        placeholder={
                          entry.type === 'keyword' ? 'e.g., invoice, receipt, payment' :
                          entry.type === 'mimetype' ? 'e.g., .pdf, .docx, .xlsx' :
                          'e.g., john@company.com or @company.com'
                        }
                        value={entry.value}
                        onChange={(e) => handleUpdateRuleEntry(index, 'value', e.target.value)}
                      />
                    </div>

                    {/* Confidence Slider */}
                    <div className="entry-field">
                      <label className="entry-label">
                        Confidence Level
                        <span className="confidence-display">{entry.confidence}%</span>
                      </label>
                      <input
                        type="range"
                        className="confidence-slider"
                        min="0"
                        max="100"
                        step="5"
                        value={entry.confidence}
                        onChange={(e) => handleUpdateRuleEntry(index, 'confidence', Number(e.target.value))}
                      />
                      <div className="slider-labels">
                        <span>Low (0%)</span>
                        <span>High (100%)</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-footer">
              <button className="modal-btn btn-cancel" onClick={handleCloseModal} disabled={isSavingRule}>
                Cancel
              </button>
              <button 
                className="modal-btn btn-save" 
                onClick={handleSaveRule}
                disabled={isSavingRule || !selectedCategoryId || !ruleEntries.some(e => e.value.trim())}
              >
                {isSavingRule ? (
                  <>
                    <span className="btn-spinner"></span>
                    <span style={{ opacity: 0 }}>{editingRule ? 'Save Changes' : 'Create Rules'}</span>
                  </>
                ) : (
                  editingRule ? 'Save Changes' : 'Create Rules'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RulesPage;