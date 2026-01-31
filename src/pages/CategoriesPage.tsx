import React, { useState, useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { userCache } from '@/utils/userCache';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Tooltip from '@/components/common/Tooltip';
import { appsScriptClient } from '@/lib/appsScriptClient';
import './CategoriesPage.css';

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
  createdAt?: string;
  updatedAt?: string;
}

interface CategoryFormData {
  name: string;
  description: string;
  color: string;
  icon: string;
  createShortcut: boolean;
}

const CategoriesPage: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);

  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirmation, setShowBulkDeleteConfirmation] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const lastSelectedIndexRef = useRef<number | null>(null);
  const lastAutoCreatedToastRef = useRef<{ key: string; at: number } | null>(null);
  const [animatedCounts, setAnimatedCounts] = useState<Map<string, number>>(new Map());
  const [formData, setFormData] = useState<CategoryFormData>({
    name: '',
    description: '',
    color: '#0ea5e9',
    icon: 'fa-folder',
    createShortcut: true,
  });

  const selectedCategoryInfo = selectedCategory
    ? categories.find(cat => cat.id === selectedCategory)
    : null;
  const isFolderBacked = !!selectedCategoryInfo?.driveFolderId;

  const colorOptions = [
    { value: '#0ea5e9', label: 'Blue' },
    { value: '#10b981', label: 'Green' },
    { value: '#8b5cf6', label: 'Purple' },
    { value: '#f59e0b', label: 'Orange' },
    { value: '#ef4444', label: 'Red' },
    { value: '#ec4899', label: 'Pink' },
  ];

  const iconOptions = ['fa-folder', 'fa-sack-dollar', 'fa-palette', 'fa-chart-simple', 'fa-file-lines', 'fa-house', 'fa-graduation-cap', 'fa-briefcase', 'fa-wrench', 'fa-camera'];

  const toggleCategorySelection = (id: string) => {
    setSelectedCategoryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCategoryClick = (id: string, index: number, event: React.MouseEvent) => {
    if (event.shiftKey && lastSelectedIndexRef.current !== null) {
      const start = Math.min(lastSelectedIndexRef.current, index);
      const end = Math.max(lastSelectedIndexRef.current, index);
      const rangeIds = categories.slice(start, end + 1).map(cat => cat.id);
      setSelectedCategoryIds(prev => {
        const next = new Set(prev);
        rangeIds.forEach(rangeId => next.add(rangeId));
        return next;
      });
      setSelectedCategory(null);
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      toggleCategorySelection(id);
      setSelectedCategory(null);
      lastSelectedIndexRef.current = index;
      return;
    }

    if (selectedCategoryIds.size > 0) {
      toggleCategorySelection(id);
      setSelectedCategory(null);
      lastSelectedIndexRef.current = index;
      return;
    }

    setSelectedCategory(selectedCategory === id ? null : id);
    lastSelectedIndexRef.current = index;
  };

  const handleCategoryCheckbox = (id: string, index: number, event: React.MouseEvent) => {
    event.stopPropagation();
    if (event.shiftKey && lastSelectedIndexRef.current !== null) {
      const start = Math.min(lastSelectedIndexRef.current, index);
      const endIndex = Math.max(lastSelectedIndexRef.current, index);
      const rangeIds = categories.slice(start, endIndex + 1).map(cat => cat.id);
      setSelectedCategoryIds(prev => {
        const next = new Set(prev);
        rangeIds.forEach(rangeId => next.add(rangeId));
        return next;
      });
      setSelectedCategory(null);
    } else {
      toggleCategorySelection(id);
      setSelectedCategory(null);
    }
    lastSelectedIndexRef.current = index;
  };

  const clearCategorySelection = () => {
    setSelectedCategoryIds(new Set());
  };

  const handleCreateCategory = () => {
    setSelectedCategory(null);
    setEditingCategory(null);
    setFormData({
      name: '',
      description: '',
      color: '#0ea5e9',
      icon: '📁',
      createShortcut: true,
    });
    setShowModal(true);
  };

  // Derive counts from locally cached inbox files when available to avoid stale backend counts
  const applyLocalFileCounts = (cats: Category[]) => {
    const cachedConfigVersion = userCache.getConfigVersion();
    const inbox = userCache.get<any[]>('inbox_all_files', {
      configVersion: cachedConfigVersion ?? undefined,
    });
    if (!inbox || !Array.isArray(inbox)) return cats;

    const folderCategoryById = new Map<string, string>();
    cats.forEach(cat => {
      if (cat.driveFolderId) {
        folderCategoryById.set(cat.driveFolderId, cat.id);
      }
    });

    const categoryFileIds = new Map<string, Set<string>>();
    const addToCategory = (categoryId: string | undefined, fileId: string) => {
      if (!categoryId) return;
      if (!categoryFileIds.has(categoryId)) {
        categoryFileIds.set(categoryId, new Set<string>());
      }
      categoryFileIds.get(categoryId)!.add(fileId);
    };

    inbox.forEach((file: any) => {
      if (file.categoryId) {
        addToCategory(file.categoryId, file.id);
      }

      const parents = Array.isArray(file.parents) ? file.parents : [];
      parents.forEach((parentId: string) => {
        const folderCategoryId = folderCategoryById.get(parentId);
        if (folderCategoryId) {
          addToCategory(folderCategoryId, file.id);
        }
      });
    });

    return cats.map(cat => ({
      ...cat,
      fileCount: categoryFileIds.get(cat.id)?.size ?? 0,
    }));
  };

  // Load categories from backend with stale-while-revalidate pattern
  const loadCategories = async (bypassCache: boolean = false) => {
    // If not bypassing cache, show cached data immediately while fetching fresh
    if (!bypassCache) {
      const cachedConfigVersion = userCache.getConfigVersion();
      const cachedData = userCache.get<typeof categories>('categories', {
        ttl: 30 * 60 * 1000,
        configVersion: cachedConfigVersion ?? undefined,
      }); // 30 min TTL
      if (cachedData) {
        setCategories(applyLocalFileCounts(cachedData));
        setIsLoading(false);
        logger.debug('📦 Showing cached categories, fetching fresh data in background...');
        
        // Fetch fresh data in background
        fetchFreshCategories();
        return;
      }
    }
    
    // No cache or bypassing - show loading state
    setIsLoading(true);
    await fetchFreshCategories();
  };
  
  // Fetch fresh categories from backend
  const fetchFreshCategories = async () => {
    try {
      const response = await appsScriptClient.getCategories(true); // Always bypass cache in client
      if (response.success) {
        const configVersion = typeof response.configVersion === 'number' && Number.isFinite(response.configVersion)
          ? response.configVersion
          : undefined;
        if (configVersion !== undefined) {
          userCache.setConfigVersion(configVersion);
        }
        const withCounts = applyLocalFileCounts(response.categories);
        setCategories(withCounts);
        userCache.set('categories', withCounts, { configVersion }); // Update cache with fresh data
        logger.debug('✅ Loaded fresh categories:', response.categories.length);
        if (response.autoCreatedCount && response.autoCreatedCount > 0) {
          const toastKey = `${response.autoCreatedCount}-${response.categories.length}`;
          const now = Date.now();
          const lastToast = lastAutoCreatedToastRef.current;
          if (!lastToast || lastToast.key !== toastKey || now - lastToast.at > 10000) {
            lastAutoCreatedToastRef.current = { key: toastKey, at: now };
            toast.success(`Created ${response.autoCreatedCount} folder categor${response.autoCreatedCount === 1 ? 'y' : 'ies'} from Drive folders`);
          }
        }
      } else {
        toast.error('Failed to load categories');
        logger.error('❌ Failed to load categories:', response.error);
      }
    } catch (error: any) {
      toast.error('Error loading categories');
      logger.error('❌ Error loading categories:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Load categories on mount
  useEffect(() => {
    loadCategories();
  }, []);

  // Auto-reload categories when page becomes visible (e.g., coming back from InboxPage)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Bypass cache to get fresh file counts
        loadCategories(true);
      }
    };

    const handleFocus = () => {
      // Bypass cache to get fresh file counts
      loadCategories(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Keyboard navigation: Escape to close modals
  useEffect(() => {
    if (selectedCategoryIds.size > 0) {
      setSelectedCategory(null);
    }
  }, [selectedCategoryIds]);

  useEffect(() => {
    setSelectedCategoryIds(prev => {
      const next = new Set<string>();
      categories.forEach(cat => {
        if (prev.has(cat.id)) {
          next.add(cat.id);
        }
      });
      return next;
    });
  }, [categories]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDeleteConfirmation) {
          setShowDeleteConfirmation(false);
        } else if (showModal) {
          setShowModal(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showModal, showDeleteConfirmation]);
  const handleEditCategory = () => {
    const category = categories.find(c => c.id === selectedCategory);
    if (!category) return;
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description,
      color: category.color,
      icon: category.icon,
      createShortcut: true,
    });
    setShowModal(true);
  };

  const handleSaveCategory = async () => {
    setIsSaving(true);
    
    try {
      if (editingCategory) {
        // Update existing category
        const response = await appsScriptClient.updateCategory({
          id: editingCategory.id,
          name: formData.name,
          description: formData.description,
          color: formData.color,
          icon: formData.icon,
        });
        
        if (response.success) {
          // Update local state with the updated category
          setCategories(categories.map(cat => 
            cat.id === editingCategory.id 
              ? { ...cat, ...response.category, fileCount: cat.fileCount }
              : cat
          ));
          
          // Update cache with modified category
          const updatedCategories = categories.map(cat => 
            cat.id === editingCategory.id 
              ? { ...cat, ...response.category, fileCount: cat.fileCount }
              : cat
          );
          const currentConfigVersion = userCache.getConfigVersion();
          userCache.set('categories', updatedCategories, { configVersion: currentConfigVersion ?? undefined });
          logger.debug('🔄 Updated category in cache');
          
          toast.success(`Category "${formData.name}" updated successfully!`);
          setShowModal(false);
        } else {
          toast.error(response.error || 'Failed to update category');
        }
      } else {
        // Create new category
        const response = await appsScriptClient.createCategory({
          name: formData.name,
          description: formData.description,
          color: formData.color,
          icon: formData.icon,
        });
        
        if (response.success) {
          // Add new category to local state
          const newCategory: Category = {
            ...response.category,
            fileCount: 0,
          };
          setCategories([...categories, newCategory]);
          
          // Update cache with new category
          const currentConfigVersion = userCache.getConfigVersion();
          userCache.set('categories', [...categories, newCategory], { configVersion: currentConfigVersion ?? undefined });
          logger.debug('🔄 Added new category to cache');
          
          toast.success(`Category "${formData.name}" created successfully!`);
          setShowModal(false);
        } else {
          toast.error(response.error || 'Failed to create category');
        }
      }
    } catch (error: any) {
      toast.error('Error saving category');
      logger.error('❌ Error saving category:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!selectedCategory) return;
    const category = categories.find(c => c.id === selectedCategory);
    if (!category) return;
    
    try {
      // Check if category has files assigned
      const hasFiles = category.fileCount > 0;
      
      // Trigger deletion animation
      setDeletingCategory(selectedCategory);
      
      // Delete from backend
      const response = await appsScriptClient.deleteCategory(selectedCategory, hasFiles);
      
      if (response.success) {
        // Remove from local state after animation
        setTimeout(() => {
          const updatedCategories = categories.filter(cat => cat.id !== selectedCategory);
          setCategories(updatedCategories);
          
          // Remove from cache
          const currentConfigVersion = userCache.getConfigVersion();
          userCache.set('categories', updatedCategories, { configVersion: currentConfigVersion ?? undefined });
          logger.debug('🔄 Removed category from cache');
          
          setShowModal(false);
          setShowDeleteConfirmation(false);
          setDeletingCategory(null);
          setSelectedCategory(null);
          
          if (response.removedAssignments > 0) {
            toast.success(`Category "${category.name}" deleted. ${response.removedAssignments} file assignments removed.`);
          } else {
            toast.success(`Category "${category.name}" deleted successfully!`);
          }
        }, 200);
      } else {
        setDeletingCategory(null);
        toast.error(response.error || 'Failed to delete category');
      }
    } catch (error: any) {
      setDeletingCategory(null);
      toast.error('Error deleting category');
      logger.error('❌ Error deleting category:', error);
    }
  };

  const handleBulkDeleteCategories = async () => {
    const selectedIds = Array.from(selectedCategoryIds);
    if (selectedIds.length === 0) return;

    setIsBulkDeleting(true);
    const failed: string[] = [];
    const succeeded: string[] = [];

    for (const categoryId of selectedIds) {
      const category = categories.find(cat => cat.id === categoryId);
      if (!category) continue;

      const hasFiles = category.fileCount > 0;
      const response = await appsScriptClient.deleteCategory(categoryId, hasFiles);
      if (response.success) {
        succeeded.push(categoryId);
      } else {
        failed.push(category.name);
      }
    }

    if (succeeded.length > 0) {
      const updatedCategories = categories.filter(cat => !succeeded.includes(cat.id));
      setCategories(updatedCategories);
      const currentConfigVersion = userCache.getConfigVersion();
      userCache.set('categories', updatedCategories, { configVersion: currentConfigVersion ?? undefined });
    }

    clearCategorySelection();
    setShowBulkDeleteConfirmation(false);
    setIsBulkDeleting(false);

    if (succeeded.length > 0) {
      toast.success(`Deleted ${succeeded.length} categor${succeeded.length === 1 ? 'y' : 'ies'}`);
    }
    if (failed.length > 0) {
      const shown = failed.slice(0, 3).join(', ');
      const remaining = failed.length > 3 ? ` +${failed.length - 3} more` : '';
      toast.error(`Failed to delete: ${shown}${remaining}`);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedCategory(expandedCategory === id ? null : id);
  };

  // Animate file counts on mount and when counts change
  React.useEffect(() => {
    categories.forEach(category => {
      const currentAnimated = animatedCounts.get(category.id) ?? 0;
      if (currentAnimated !== category.fileCount) {
        const targetCount = category.fileCount;
        let currentValue = currentAnimated;
        const duration = 300;
        const steps = 15;
        const increment = (targetCount - currentValue) / steps;
        const stepDuration = duration / steps;

        const timer = setInterval(() => {
          currentValue += increment;
          if ((increment > 0 && currentValue >= targetCount) || (increment < 0 && currentValue <= targetCount)) {
            currentValue = targetCount;
            clearInterval(timer);
          }
          setAnimatedCounts(prev => new Map(prev).set(category.id, Math.round(currentValue)));
        }, stepDuration);
      }
    });
  }, [categories]);

  return (
    <div className="categories-page">
      {/* Category Cards */}
      <div className="category-grid">
        {isLoading ? (
          <>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="skeleton-category-card">
                <div className="skeleton-category-header">
                  <div className="skeleton skeleton-category-icon"></div>
                  <div className="skeleton-category-info">
                    <div className="skeleton skeleton-category-name"></div>
                    <div className="skeleton skeleton-category-count"></div>
                  </div>
                </div>
                <div className="skeleton skeleton-category-description"></div>
              </div>
            ))}
          </>
        ) : (
          categories.map((category, index) => (
          <div
            key={category.id}
            className={`category-card ${
              deletingCategory === category.id ? 'deleting' : ''
            } ${
              (selectedCategory === category.id || selectedCategoryIds.has(category.id)) ? 'selected' : ''
            }`}
            style={{ animationDelay: `${index * 100}ms` }}
            onClick={(event) => handleCategoryClick(category.id, index, event)}
          >
            <div className="category-card-header">
              <label
                className="category-select-checkbox"
                onClick={(event) => handleCategoryCheckbox(category.id, index, event)}
              >
                <input
                  type="checkbox"
                  checked={selectedCategoryIds.has(category.id)}
                  onChange={() => {}}
                />
              </label>
              <div className="category-icon-container">
                <span 
                  className="category-icon"
                  style={{ backgroundColor: category.color }}
                >
                  <i className={`fa-solid ${category.icon}`}></i>
                </span>
              </div>
              <div className="category-info">
                <h3 className="category-name">{category.name}</h3>
                <div className="category-count">
                  <span className="count-badge">{animatedCounts.get(category.id) ?? category.fileCount}</span>
                  <span className="count-label">files</span>
                </div>
              </div>
            </div>

            <div className="category-description-container">
              <p className={`category-description ${expandedCategory === category.id ? 'expanded' : ''}`}>
                {category.description || ''}
              </p>
              {category.description && category.description.length > 60 && (
                <button
                  className="expand-btn"
                  onClick={() => toggleExpanded(category.id)}
                >
                  {expandedCategory === category.id ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>

            <div className="category-footer">
              <button 
                className="view-files-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/categories/${category.id}`);
                }}
              >
                View Files
              </button>
            </div>
          </div>
        ))
        )}
      </div>

      {/* Create/Edit Category Modal */}
      {showModal && (
        <>
          <div className="modal-backdrop" onClick={() => setShowModal(false)} />
          <div 
            className="category-modal"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && formData.name.trim() && !isSaving) {
                e.preventDefault();
                handleSaveCategory();
              }
            }}
          >
            <div className="modal-header">
              <h2 className="modal-title">
                {editingCategory ? 'Edit Category' : 'Create New Category'}
              </h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Category Name *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter category name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-textarea"
                  placeholder="Describe what files belong in this category"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Color</label>
                <div className="color-picker">
                  {colorOptions.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      className={`color-option ${formData.color === color.value ? 'selected' : ''}`}
                      style={{ backgroundColor: color.value }}
                      onClick={() => setFormData({ ...formData, color: color.value })}
                      title={color.label}
                    />
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Icon</label>
                <div className="icon-picker">
                  {iconOptions.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      className={`icon-option ${formData.icon === icon ? 'selected' : ''}`}
                      onClick={() => setFormData({ ...formData, icon: icon })}
                    >
                      <i className={`fa-solid ${icon}`}></i>
                    </button>
                  ))}
                </div>
              </div>

            </div>

            <div className="modal-footer">
              {editingCategory && (
                <button
                  className="delete-category-btn"
                  onClick={() => setShowDeleteConfirmation(true)}
                >
                  Delete Category
                </button>
              )}
              <div className="modal-actions">
                <button className="cancel-btn" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button
                  className={`save-btn ${isSaving ? 'btn-loading' : ''}`}
                  onClick={handleSaveCategory}
                  disabled={!formData.name.trim() || isSaving}
                >
                  {editingCategory ? 'Save Changes' : 'Create Category'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {selectedCategoryIds.size > 0 && (
        <div className="bulk-actions-bar" onClick={(e) => e.stopPropagation()}>
          <div className="bulk-actions-content">
            <span className="selected-count">
              {selectedCategoryIds.size} categor{selectedCategoryIds.size === 1 ? 'y' : 'ies'} selected
            </span>
            <div className="bulk-actions-buttons">
              <button
                className="bulk-action-btn primary"
                onClick={() => setShowBulkDeleteConfirmation(true)}
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? 'Deleting...' : 'Delete Selected'}
              </button>
              <button
                className="bulk-action-btn secondary"
                onClick={clearCategorySelection}
                disabled={isBulkDeleting}
              >
                Clear Selection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Buttons */}
      {!selectedCategory ? (
        <Tooltip content="Create new category" position="left">
          <button className="floating-add-btn" onClick={handleCreateCategory}>
            <i className="fa-solid fa-plus"></i>
          </button>
        </Tooltip>
      ) : (
        <>
          <Tooltip content="Edit category" position="left">
            <button className="floating-edit-btn" onClick={handleEditCategory}>
              <i className="fa-solid fa-pen"></i>
            </button>
          </Tooltip>
          <Tooltip content="Delete category" position="left">
            <button className="floating-delete-btn" onClick={() => setShowDeleteConfirmation(true)}>
              <i className="fa-regular fa-trash-can"></i>
            </button>
          </Tooltip>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmation && (
        <>
          <div className="modal-backdrop" onClick={() => setShowDeleteConfirmation(false)} />
          <div className="confirmation-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon warning"><i className="fa-solid fa-triangle-exclamation"></i></div>
            <h3 className="confirmation-title">Delete Category?</h3>
            <p className="confirmation-message">
              {isFolderBacked
                ? 'Are you sure you want to delete this category? The linked Drive folder will remain in Drive, but this category will be removed and will not reappear.'
                : 'Are you sure you want to delete this category? Files will remain in your Drive but will be uncategorized.'}
            </p>
            <div className="confirmation-actions">
              <button className="cancel-btn" onClick={() => setShowDeleteConfirmation(false)}>
                Cancel
              </button>
              <button className="confirm-delete-btn" onClick={handleDeleteCategory}>
                Delete Category
              </button>
            </div>
          </div>
        </>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteConfirmation && (
        <>
          <div className="modal-backdrop" onClick={() => setShowBulkDeleteConfirmation(false)} />
          <div className="confirmation-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon warning"><i className="fa-solid fa-triangle-exclamation"></i></div>
            <h3 className="confirmation-title">Delete Categories?</h3>
            <p className="confirmation-message">
              Delete {selectedCategoryIds.size} categor{selectedCategoryIds.size === 1 ? 'y' : 'ies'}? This cannot be undone.
            </p>
            <div className="confirmation-actions">
              <button className="cancel-btn" onClick={() => setShowBulkDeleteConfirmation(false)} disabled={isBulkDeleting}>
                Cancel
              </button>
              <button className="confirm-delete-btn" onClick={handleBulkDeleteCategories} disabled={isBulkDeleting}>
                {isBulkDeleting ? 'Deleting...' : 'Delete Categories'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default CategoriesPage;