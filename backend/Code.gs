/**
 * AutoSortDrive - Google Apps Script Backend
 * 
 * CRITICAL DEPLOYMENT REQUIREMENTS FOR MULTI-USER APP:
 * =====================================================
 * This web app MUST be deployed with:
 * 
 * 1. Execute as: "User accessing the web app"
 * 2. Who has access: "Anyone" (or "Anyone with Google account")
 * 
 * WHY "User accessing the web app"?
 * - Each user's Drive files are accessed under THEIR account
 * - Config (categories, rules, assignments) is stored in THEIR Drive
 * - Users have isolated data - no cross-user contamination
 * 
 * IMPORTANT FRONTEND REQUIREMENT:
 * - Frontend MUST use OAuth redirect mode (NOT popup mode)
 * - Popup mode with "User accessing" triggers CORS-breaking redirects
 * - Redirect mode avoids CORS preflight issues entirely
 * 
 * DEPLOYMENT INSTRUCTIONS:
 * ========================
 * 1. Go to https://script.google.com
 * 2. Create a new project (or open existing)
 * 3. Copy this entire file into Code.gs
 * 4. Enable "Drive API" in Services (+ icon, search "Drive API")
 * 5. Click "Deploy" > "New deployment"
 * 6. Type: "Web app"
 * 7. Execute as: "User accessing the web app" (CRITICAL!)
 * 8. Who has access: "Anyone" (CRITICAL!)
 * 9. Click "Deploy" and authorize
 * 10. Copy the Web app URL to your .env file (VITE_APPS_SCRIPT_DEPLOY_URL)
 * 
 * GOOGLE CLOUD CONSOLE SETUP:
 * ============================
 * Add to "Authorized redirect URIs":
 * - http://localhost:5173/auth/callback
 * - https://yourdomain.com/auth/callback
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  APP_NAME: 'AutoSortDrive',
  VERSION: '0.1.0',
  CONFIG_FOLDER_NAME: '.autosortdrive',
  CONFIG_FILE_NAME: 'config.json',
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  DEBUG: false,
  AI_ENABLED: false,
};

// ============================================================================
// WEB APP ENDPOINTS (doGet, doPost)
// ============================================================================

/**
 * NOTE ON doOptions() and CORS Preflight:
 * 
 * Google Apps Script web apps DO NOT call doOptions() for browser preflight requests.
 * The Apps Script hosting layer handles OPTIONS requests before they reach our code,
 * and it does NOT forward our custom headers. Therefore, any doOptions() implementation
 * is USELESS for CORS.
 * 
 * This means:
 * - We cannot support "preflighted" requests (those with custom headers like Content-Type: application/json)
 * - Frontend MUST use "simple requests" (GET/POST without custom headers)
 * - Only GET/POST requests actually reach our code and can include CORS headers
 * 
 * For a proper CORS API, use:
 * - A Node.js/Express proxy server
 * - Cloud Functions/Lambda
 * - Host frontend inside Apps Script with HtmlService (same-origin, no CORS)
 */

/**
 * Handle GET requests
 * 
 * All errors are caught and returned as JSON to ensure our CORS headers
 * are always present. Without this, Apps Script returns HTML error pages
 * that don't include our headers, causing CORS failures.
 */
function doGet(e) {
  const path = e.parameter.path || '';
  
  try {
    let response;
    
    switch (path) {
      case 'health':
        response = handleHealth();
        break;
      case 'version':
        response = handleVersion();
        break;
      case 'files':
        response = handleListFiles(e.parameter);
        break;
      case 'categories':
        response = handleGetCategories();
        break;
      case 'rules':
        response = handleGetRules(e.parameter);
        break;
      case 'review-queue':
        response = handleGetReviewQueue(e.parameter);
        break;
      case 'file-view':
        response = handleGetFileViewUrl(e.parameter);
        break;
      case 'file-download':
        response = handleGetFileDownloadUrl(e.parameter);
        break;
      default:
        response = {
          success: true,
          message: 'AutoSortDrive Backend is running!',
          timestamp: new Date().toISOString(),
          endpoints: {
            health: '?path=health',
            version: '?path=version',
            init: 'POST ?path=init',
          }
        };
    }
    
    // Return JSON response
    return ContentService
      .createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    // CRITICAL: Always return JSON errors through ContentService
    // Otherwise Apps Script returns an HTML error page.
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message,
        ...(CONFIG.DEBUG ? { stack: error.stack } : {}),
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle POST requests
 * 
 * All errors are caught and returned as JSON to ensure our CORS headers
 * are always present. Without this, Apps Script returns HTML error pages
 * that don't include our headers, causing CORS failures.
 */
function doPost(e) {
  try {
    const path = e.parameter.path || '';
    let body = {};

    if (path === 'ai-categorize') {
      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          error: 'AI endpoint disabled',
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Parse JSON body if present
    if (e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (parseError) {
        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: 'Invalid JSON in request body: ' + parseError.message,
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    let response;
    
    switch (path) {
      case 'init':
        response = handleInit();
        break;
      case 'assign-category':
        response = handleAssignCategory(body);
        break;
      case 'assign-categories-bulk':
        response = handleAssignCategoriesBulk(body);
        break;
      case 'category':
        // CREATE or UPDATE category based on presence of id
        if (body.id) {
          response = handleUpdateCategory(body);
        } else {
          response = handleCreateCategory(body);
        }
        break;
      case 'delete-category':
        response = handleDeleteCategory(body);
        break;
      case 'create-rule':
        response = handleCreateRule(body);
        break;
      case 'update-rule':
        response = handleUpdateRule(body);
        break;
      case 'delete-rule':
        response = handleDeleteRule(body);
        break;
      case 'apply-rules':
        response = handleApplyRules(body);
        break;
      case 'auto-assign':
        response = handleAutoAssign(body);
        break;
      case 'batch-auto-assign':
        response = handleBatchAutoAssign(body);
        break;
      case 'review-accept':
        response = handleReviewAccept(body);
        break;
      case 'review-override':
        response = handleReviewOverride(body);
        break;
      case 'review-skip':
        response = handleReviewSkip(body);
        break;
      case 'review-add':
        response = handleReviewAdd(body);
        break;
      default:
        response = {
          success: false,
          error: 'Unknown endpoint: ' + path,
        };
    }
    
    // Return JSON response
    return ContentService
      .createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    // CRITICAL: Always return JSON errors through ContentService
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: error.message,
        ...(CONFIG.DEBUG ? { stack: error.stack } : {}),
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================================
// ENDPOINT HANDLERS
// ============================================================================

/**
 * Health check endpoint
 */
function handleHealth() {
  return {
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: CONFIG.VERSION,
  };
}

/**
 * Version endpoint
 */
function handleVersion() {
  return {
    success: true,
    version: CONFIG.VERSION,
    appName: CONFIG.APP_NAME,
  };
}

/**
 * Initialize configuration
 */
function handleInit() {
  try {
    // Check if config folder exists
    const folders = DriveApp.getFoldersByName(CONFIG.CONFIG_FOLDER_NAME);
    let configFolder;
    
    if (folders.hasNext()) {
      configFolder = folders.next();
    } else {
      // Create config folder
      configFolder = DriveApp.createFolder(CONFIG.CONFIG_FOLDER_NAME);
      configFolder.setDescription('AutoSortDrive configuration folder (auto-generated)');
    }
    
    // Check if config file exists
    const files = configFolder.getFilesByName(CONFIG.CONFIG_FILE_NAME);
    let configFile;
    let config;
    
    if (files.hasNext()) {
      // Load existing config
      configFile = files.next();
      config = JSON.parse(configFile.getBlob().getDataAsString());
    } else {
      // Create default config
      config = {
        version: CONFIG.VERSION,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        categories: [],
        assignments: {},
        rules: [],
        reviewQueue: [],
        feedbackLog: [],
        settings: {
          autoCategorizationEnabled: false,
          confidenceThreshold: 0.8,
          aiEnabled: false,
        },
      };
      
      // Save config
      configFile = configFolder.createFile(
        CONFIG.CONFIG_FILE_NAME,
        JSON.stringify(config, null, 2),
        MimeType.PLAIN_TEXT
      );
    }
    
    return {
      success: true,
      initialized: true,
      config: config,
      configFileId: configFile.getId(),
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}
/**
 * List Drive files with filters and pagination
 */
function handleListFiles(params) {
  try {
    // Get pagination parameters
    const pageSize = Math.min(
      parseInt(params.pageSize) || CONFIG.DEFAULT_PAGE_SIZE,
      CONFIG.MAX_PAGE_SIZE
    );
    const pageToken = params.pageToken || null;
    
    // Build query based on filters
    let query = buildFileQuery(params);
    
    // Get files from Drive
    const options = {
      pageSize: pageSize,
      orderBy: 'modifiedTime desc',
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, createdTime, size, owners, parents, webViewLink, iconLink, thumbnailLink)',
    };
    
    if (pageToken) {
      options.pageToken = pageToken;
    }
    
    if (query) {
      options.q = query;
    }
    
    // Use Drive API (Advanced Drive Service)
    const response = Drive.Files.list(options);
    
    // Load category assignments from config
    const config = readConfig();
    const assignments = config ? config.assignments : {};
    const rules = config ? (config.rules || []) : [];
    
    // Determine which files are in review by evaluating against rules
    // A file is "in review" if:
    // 1. It's uncategorized AND
    // 2. It matches at least one rule
    const reviewFileIds = new Set();
    
    // Only evaluate if rules exist
    if (rules.length > 0) {
      response.files.forEach(file => {
        // Skip if already categorized
        if (assignments[file.id]) return;
        
        // Check if file matches any rules
        const matches = evaluateFileAgainstRules(file, rules);
        if (matches.length > 0) {
          reviewFileIds.add(file.id);
        }
      });
    }
    
    // DEBUG: Log review queue info
    Logger.log('🔍 DEBUG handleListFiles: reviewQueue info:');
    Logger.log('Total files in response: ' + response.files.length);
    Logger.log('Rules count: ' + rules.length);
    Logger.log('Files marked as inReview: ' + reviewFileIds.size);
    Logger.log('Review file IDs: ' + JSON.stringify(Array.from(reviewFileIds)));
    
    // Enhance files with category info and review status
    const files = response.files.map(file => {
      const categoryId = assignments[file.id] || null;
      const inReview = reviewFileIds.has(file.id);
      
      // DEBUG: Log if file is in review
      if (inReview) {
        Logger.log('✅ File in review: ' + file.name + ' (ID: ' + file.id + ')');
      }
      
      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        createdTime: file.createdTime,
        size: file.size,
        owners: file.owners,
        parents: file.parents,
        webViewLink: file.webViewLink,
        iconLink: file.iconLink,
        thumbnailLink: file.thumbnailLink,
        categoryId: categoryId,
        categorized: !!categoryId,
        inReview: inReview,
      };
    });
    
    return {
      success: true,
      files: files,
      nextPageToken: response.nextPageToken || null,
      totalReturned: files.length,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Build Drive API query based on filters
 */
function buildFileQuery(params) {
  const conditions = [];
  
  // Exclude trashed files
  conditions.push('trashed = false');
  
  // Exclude the config folder itself
  conditions.push(`name != '${CONFIG.CONFIG_FOLDER_NAME}'`);

  // Exclude folders and shortcuts
  conditions.push("mimeType != 'application/vnd.google-apps.folder'");
  conditions.push("mimeType != 'application/vnd.google-apps.shortcut'");
  
  // Filter by MIME type (file type)
  if (params.mimeType) {
    const mimeTypes = params.mimeType.split(',');
    if (mimeTypes.length === 1) {
      conditions.push(`mimeType = '${mimeTypes[0]}'`);
    } else {
      const mimeConditions = mimeTypes.map(type => `mimeType = '${type}'`);
      conditions.push(`(${mimeConditions.join(' or ')})`);
    }
  }
  
  // Filter by file type category (convenience filters)
  if (params.fileType) {
    const typeConditions = getFileTypeConditions(params.fileType);
    if (typeConditions) {
      conditions.push(typeConditions);
    }
  }
  
  // Filter by date range
  if (params.modifiedAfter) {
    conditions.push(`modifiedTime > '${params.modifiedAfter}'`);
  }
  if (params.modifiedBefore) {
    conditions.push(`modifiedTime < '${params.modifiedBefore}'`);
  }
  
  // Search by filename
  if (params.search) {
    conditions.push(`name contains '${params.search.replace(/'/g, "\\'")}'`);
  }
  
  return conditions.join(' and ');
}

/**
 * Get MIME type conditions for file type categories
 */
function getFileTypeConditions(fileType) {
  const typeMap = {
    'docs': "mimeType = 'application/vnd.google-apps.document'",
    'sheets': "mimeType = 'application/vnd.google-apps.spreadsheet'",
    'slides': "mimeType = 'application/vnd.google-apps.presentation'",
    'pdfs': "mimeType = 'application/pdf'",
    'images': "mimeType contains 'image/'",
    'videos': "mimeType contains 'video/'",
    'folders': "mimeType = 'application/vnd.google-apps.folder'",
  };
  
  return typeMap[fileType.toLowerCase()] || null;
}

/**
 * Assign a category to a single file
 */
function handleAssignCategory(body) {
  try {
    const { fileId, categoryId } = body;
    
    if (!fileId) {
      return {
        success: false,
        error: 'fileId is required',
      };
    }
    
    // Load config
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    // Initialize assignments object if it doesn't exist
    if (!config.assignments) {
      config.assignments = {};
    }
    
    // Update or remove assignment
    if (categoryId === null || categoryId === '') {
      // Remove category assignment
      delete config.assignments[fileId];
    } else {
      // Assign category
      config.assignments[fileId] = categoryId;
    }
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      fileId: fileId,
      categoryId: categoryId,
      message: categoryId ? 'Category assigned successfully' : 'Category removed successfully',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Assign categories to multiple files at once (bulk operation)
 */
function handleAssignCategoriesBulk(body) {
  try {
    const { assignments } = body; // Array of { fileId, categoryId }
    
    if (!assignments || !Array.isArray(assignments)) {
      return {
        success: false,
        error: 'assignments array is required',
      };
    }
    
    // Load config
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    // Initialize assignments object if it doesn't exist
    if (!config.assignments) {
      config.assignments = {};
    }
    
    let updatedCount = 0;
    let removedCount = 0;
    
    // Update all assignments
    assignments.forEach(item => {
      const { fileId, categoryId } = item;
      if (fileId) {
        if (categoryId === null || categoryId === '') {
          delete config.assignments[fileId];
          removedCount++;
        } else {
          config.assignments[fileId] = categoryId;
          updatedCount++;
        }
      }
    });
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      updatedCount: updatedCount,
      removedCount: removedCount,
      totalProcessed: updatedCount + removedCount,
      message: `Successfully processed ${updatedCount + removedCount} file assignments`,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Get all categories
 */
function handleGetCategories() {
  try {
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    // Get categories with file counts
    const categories = config.categories || [];
    const assignments = config.assignments || {};
    
    // Count files per category
    const categoriesWithCounts = categories.map(category => {
      const fileCount = Object.values(assignments).filter(catId => catId === category.id).length;
      return {
        ...category,
        fileCount: fileCount,
      };
    });
    
    return {
      success: true,
      categories: categoriesWithCounts,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Create a new category
 */
function handleCreateCategory(body) {
  try {
    const { name, description, color, icon } = body;
    
    if (!name) {
      return {
        success: false,
        error: 'Category name is required',
      };
    }
    
    // Load config
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    // Initialize categories array if it doesn't exist
    if (!config.categories) {
      config.categories = [];
    }
    
    // Check for duplicate name
    const exists = config.categories.find(cat => cat.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      return {
        success: false,
        error: 'A category with this name already exists',
      };
    }
    
    // Generate unique ID
    const id = 'cat_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Create category
    const category = {
      id: id,
      name: name,
      description: description || '',
      color: color || '#3b82f6',
      icon: icon || '📁',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    config.categories.push(category);
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      category: category,
      message: 'Category created successfully',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Update an existing category
 */
function handleUpdateCategory(body) {
  try {
    const { id, name, description, color, icon } = body;
    
    if (!id) {
      return {
        success: false,
        error: 'Category ID is required',
      };
    }
    
    // Load config
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    if (!config.categories) {
      config.categories = [];
    }
    
    // Find category
    const categoryIndex = config.categories.findIndex(cat => cat.id === id);
    if (categoryIndex === -1) {
      return {
        success: false,
        error: 'Category not found',
      };
    }
    
    // Check for duplicate name (excluding current category)
    if (name) {
      const duplicate = config.categories.find(
        cat => cat.id !== id && cat.name.toLowerCase() === name.toLowerCase()
      );
      if (duplicate) {
        return {
          success: false,
          error: 'A category with this name already exists',
        };
      }
    }
    
    // Update category
    const category = config.categories[categoryIndex];
    if (name !== undefined) category.name = name;
    if (description !== undefined) category.description = description;
    if (color !== undefined) category.color = color;
    if (icon !== undefined) category.icon = icon;
    category.updatedAt = new Date().toISOString();
    
    config.categories[categoryIndex] = category;
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      category: category,
      message: 'Category updated successfully',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Delete a category
 */
function handleDeleteCategory(body) {
  try {
    const { id, removeAssignments } = body;
    
    if (!id) {
      return {
        success: false,
        error: 'Category ID is required',
      };
    }
    
    // Load config
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    if (!config.categories) {
      config.categories = [];
    }
    
    // Find category
    const categoryIndex = config.categories.findIndex(cat => cat.id === id);
    if (categoryIndex === -1) {
      return {
        success: false,
        error: 'Category not found',
      };
    }
    
    // Count files assigned to this category
    const assignments = config.assignments || {};
    const assignedFiles = Object.keys(assignments).filter(fileId => assignments[fileId] === id);
    
    if (assignedFiles.length > 0 && !removeAssignments) {
      return {
        success: false,
        error: `Cannot delete category. ${assignedFiles.length} file(s) are assigned to it. Set removeAssignments to true to force delete.`,
        assignedFileCount: assignedFiles.length,
      };
    }
    
    // Remove category
    const deletedCategory = config.categories[categoryIndex];
    config.categories.splice(categoryIndex, 1);
    
    // Remove all assignments to this category if requested
    if (removeAssignments && assignedFiles.length > 0) {
      assignedFiles.forEach(fileId => {
        delete config.assignments[fileId];
      });
    }
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      category: deletedCategory,
      removedAssignments: removeAssignments ? assignedFiles.length : 0,
      message: 'Category deleted successfully',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Get all rules or rules for a specific category
 */
function handleGetRules(params) {
  try {
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    let rules = config.rules || [];
    
    // Filter by categoryId if provided
    if (params.categoryId) {
      rules = rules.filter(rule => rule.categoryId === params.categoryId);
    }
    
    // Enhance rules with category info
    const categories = config.categories || [];
    const enhancedRules = rules.map(rule => {
      const category = categories.find(cat => cat.id === rule.categoryId);
      return {
        ...rule,
        categoryName: category ? category.name : 'Unknown',
        categoryColor: category ? category.color : '#gray',
        categoryIcon: category ? category.icon : '📁',
      };
    });
    
    return {
      success: true,
      rules: enhancedRules,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Create a new rule
 */
function handleCreateRule(body) {
  try {
    const { categoryId, type, field, operator, value, caseSensitive, enabled } = body;
    
    // Validate required fields
    if (!categoryId) {
      return {
        success: false,
        error: 'categoryId is required',
      };
    }
    
    if (!type) {
      return {
        success: false,
        error: 'type is required (keyword, mime, or owner)',
      };
    }
    
    if (!value) {
      return {
        success: false,
        error: 'value is required',
      };
    }
    
    // Load config
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    // Verify category exists
    const categoryExists = config.categories && config.categories.find(cat => cat.id === categoryId);
    if (!categoryExists) {
      return {
        success: false,
        error: 'Category not found',
      };
    }
    
    // Initialize rules array if it doesn't exist
    if (!config.rules) {
      config.rules = [];
    }
    
    // Generate unique ID
    const id = 'rule_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Determine field and operator based on type
    let ruleField = field;
    let ruleOperator = operator;
    
    if (!ruleField) {
      // Auto-determine field based on type
      switch (type) {
        case 'keyword':
          ruleField = 'filename';
          break;
        case 'mime':
          ruleField = 'mimeType';
          break;
        case 'owner':
          ruleField = 'owner';
          break;
        default:
          ruleField = 'filename';
      }
    }
    
    if (!ruleOperator) {
      // Auto-determine operator based on type
      ruleOperator = (type === 'mime' || type === 'owner') ? 'equals' : 'contains';
    }
    
    // Create rule
    const rule = {
      id: id,
      categoryId: categoryId,
      type: type,
      field: ruleField,
      operator: ruleOperator,
      value: value,
      caseSensitive: caseSensitive !== undefined ? caseSensitive : false,
      enabled: enabled !== undefined ? enabled : true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    config.rules.push(rule);
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      rule: rule,
      message: 'Rule created successfully',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Update an existing rule
 */
function handleUpdateRule(body) {
  try {
    const { id, categoryId, type, field, operator, value, caseSensitive, enabled } = body;
    
    if (!id) {
      return {
        success: false,
        error: 'Rule ID is required',
      };
    }
    
    // Load config
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    if (!config.rules) {
      config.rules = [];
    }
    
    // Find rule
    const ruleIndex = config.rules.findIndex(rule => rule.id === id);
    if (ruleIndex === -1) {
      return {
        success: false,
        error: 'Rule not found',
      };
    }
    
    // Verify category exists if categoryId is being changed
    if (categoryId) {
      const categoryExists = config.categories && config.categories.find(cat => cat.id === categoryId);
      if (!categoryExists) {
        return {
          success: false,
          error: 'Category not found',
        };
      }
    }
    
    // Update rule
    const rule = config.rules[ruleIndex];
    if (categoryId !== undefined) rule.categoryId = categoryId;
    if (type !== undefined) rule.type = type;
    if (field !== undefined) rule.field = field;
    if (operator !== undefined) rule.operator = operator;
    if (value !== undefined) rule.value = value;
    if (caseSensitive !== undefined) rule.caseSensitive = caseSensitive;
    if (enabled !== undefined) rule.enabled = enabled;
    rule.updatedAt = new Date().toISOString();
    
    config.rules[ruleIndex] = rule;
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      rule: rule,
      message: 'Rule updated successfully',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Delete a rule
 */
function handleDeleteRule(body) {
  try {
    const { id } = body;
    
    if (!id) {
      return {
        success: false,
        error: 'Rule ID is required',
      };
    }
    
    // Load config
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    if (!config.rules) {
      config.rules = [];
    }
    
    // Find rule
    const ruleIndex = config.rules.findIndex(rule => rule.id === id);
    if (ruleIndex === -1) {
      return {
        success: false,
        error: 'Rule not found',
      };
    }
    
    // Remove rule
    const deletedRule = config.rules[ruleIndex];
    config.rules.splice(ruleIndex, 1);
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      rule: deletedRule,
      message: 'Rule deleted successfully',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

// ============================================================================
// RULE EVALUATION ENGINE
// ============================================================================

/**
 * Evaluate a single rule against a file
 * Returns true if the rule matches, false otherwise
 */
function evaluateRule(rule, file) {
  if (!rule.enabled) {
    return false;
  }
  
  let fileValue = '';
  
  // Get the file property to check
  switch (rule.field) {
    case 'filename':
      fileValue = file.name || '';
      break;
    case 'mimeType':
      fileValue = file.mimeType || '';
      break;
    case 'owner':
      fileValue = file.owners && file.owners.length > 0 ? file.owners[0].emailAddress : '';
      break;
    default:
      return false;
  }
  
  // Apply case sensitivity
  if (!rule.caseSensitive) {
    fileValue = fileValue.toLowerCase();
  }
  
  let ruleValue = rule.value;
  if (!rule.caseSensitive) {
    ruleValue = ruleValue.toLowerCase();
  }
  
  // Evaluate based on operator
  switch (rule.operator) {
    case 'contains':
      // Support multiple values separated by comma
      const keywords = ruleValue.split(',').map(k => k.trim()).filter(k => k);
      return keywords.some(keyword => fileValue.indexOf(keyword) !== -1);
      
    case 'equals':
      return fileValue === ruleValue;
      
    case 'startsWith':
      return fileValue.indexOf(ruleValue) === 0;
      
    case 'endsWith':
      const endsWithIndex = fileValue.lastIndexOf(ruleValue);
      return endsWithIndex !== -1 && endsWithIndex === fileValue.length - ruleValue.length;
      
    case 'regex':
      try {
        const regex = new RegExp(ruleValue, rule.caseSensitive ? '' : 'i');
        return regex.test(fileValue);
      } catch (e) {
        Logger.log('Invalid regex in rule ' + rule.id + ': ' + e.message);
        return false;
      }
      
    default:
      return false;
  }
}

/**
 * Evaluate all rules against a file
 * Returns array of matching categories with confidence scores
 */
function evaluateFileAgainstRules(file, rules) {
  const categoryMatches = {}; // categoryId -> { matchCount, totalRules, rules: [] }
  
  // Group rules by category
  rules.forEach(rule => {
    if (!categoryMatches[rule.categoryId]) {
      categoryMatches[rule.categoryId] = {
        matchCount: 0,
        totalRules: 0,
        matchedRules: [],
      };
    }
    categoryMatches[rule.categoryId].totalRules++;
  });
  
  // Evaluate each rule
  rules.forEach(rule => {
    if (evaluateRule(rule, file)) {
      categoryMatches[rule.categoryId].matchCount++;
      categoryMatches[rule.categoryId].matchedRules.push(rule.id);
    }
  });
  
  // Calculate confidence scores and build results
  const results = [];
  Object.keys(categoryMatches).forEach(categoryId => {
    const match = categoryMatches[categoryId];
    if (match.matchCount > 0) {
      // Confidence = percentage of rules matched for this category
      const confidence = match.matchCount / match.totalRules;
      results.push({
        categoryId: categoryId,
        confidence: confidence,
        matchedRules: match.matchedRules,
        matchCount: match.matchCount,
        totalRules: match.totalRules,
      });
    }
  });
  
  // Sort by confidence (highest first)
  results.sort((a, b) => b.confidence - a.confidence);
  
  return results;
}

/**
 * Apply rules to files and auto-assign or send to review queue
 */
function handleApplyRules(body) {
  try {
    const { fileIds, confidenceThreshold } = body;
    
    // Load config
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    const rules = config.rules || [];
    if (rules.length === 0) {
      return {
        success: false,
        error: 'No rules defined. Create rules first.',
      };
    }
    
    // Use default threshold if not provided
    const threshold = confidenceThreshold !== undefined ? confidenceThreshold : 
                     (config.settings && config.settings.confidenceThreshold) || 0.8;
    
    if (!config.assignments) {
      config.assignments = {};
    }
    
    if (!config.reviewQueue) {
      config.reviewQueue = [];
    }
    
    const results = {
      autoAssigned: [],
      needsReview: [],
      noMatch: [],
      alreadyCategorized: [],
      errors: [],
    };
    
    // Determine which files to process
    let filesToProcess = [];
    
    if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
      // Process specific files
      try {
        filesToProcess = fileIds.map(fileId => {
          try {
            return Drive.Files.get(fileId, {
              fields: 'id, name, mimeType, owners'
            });
          } catch (e) {
            results.errors.push({
              fileId: fileId,
              error: 'File not found or not accessible',
            });
            return null;
          }
        }).filter(f => f !== null);
      } catch (error) {
        return {
          success: false,
          error: 'Error fetching files: ' + error.message,
        };
      }
    } else {
      // Process all uncategorized files (limited to first 100 to avoid timeout)
      try {
        const response = Drive.Files.list({
          pageSize: 100,
          orderBy: 'modifiedTime desc',
          q: "trashed = false and name != '" + CONFIG.CONFIG_FOLDER_NAME + "'",
          fields: 'files(id, name, mimeType, owners)',
        });
        filesToProcess = response.files || [];
      } catch (error) {
        return {
          success: false,
          error: 'Error fetching files: ' + error.message,
        };
      }
    }
    
    // Process each file
    filesToProcess.forEach(file => {
      // Skip if already categorized (unless specific files were requested)
      if (config.assignments[file.id] && (!fileIds || fileIds.length === 0)) {
        results.alreadyCategorized.push({
          fileId: file.id,
          fileName: file.name,
          categoryId: config.assignments[file.id],
        });
        return;
      }
      
      // Evaluate rules
      const matches = evaluateFileAgainstRules(file, rules);
      
      if (matches.length === 0) {
        // No rules matched
        results.noMatch.push({
          fileId: file.id,
          fileName: file.name,
        });
      } else {
        const bestMatch = matches[0];
        
        if (bestMatch.confidence >= threshold) {
          // Auto-assign
          config.assignments[file.id] = bestMatch.categoryId;
          results.autoAssigned.push({
            fileId: file.id,
            fileName: file.name,
            categoryId: bestMatch.categoryId,
            confidence: bestMatch.confidence,
            matchedRules: bestMatch.matchedRules,
          });
        } else {
          // Needs review - add to review queue
          const queueItem = {
            id: 'review_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 9),
            fileId: file.id,
            fileName: file.name,
            suggestedCategoryId: bestMatch.categoryId,
            confidence: bestMatch.confidence,
            reason: `Matched ${bestMatch.matchCount} of ${bestMatch.totalRules} rules for this category`,
            source: 'rule-based',
            addedAt: new Date().toISOString(),
            status: 'pending',
          };
          
          // Check if item already exists in queue
          const existingIndex = config.reviewQueue.findIndex(item => item.fileId === file.id);
          if (existingIndex !== -1) {
            // Update existing item
            config.reviewQueue[existingIndex] = queueItem;
          } else {
            // Add new item
            config.reviewQueue.push(queueItem);
          }
          
          results.needsReview.push({
            fileId: file.id,
            fileName: file.name,
            suggestedCategoryId: bestMatch.categoryId,
            confidence: bestMatch.confidence,
            matchedRules: bestMatch.matchedRules,
            reason: queueItem.reason,
          });
        }
      }
    });
    
    // Save config if any assignments were made or review items added
    if (results.autoAssigned.length > 0 || results.needsReview.length > 0) {
      writeConfig(config);
    }
    
    return {
      success: true,
      threshold: threshold,
      processed: filesToProcess.length,
      autoAssigned: results.autoAssigned.length,
      needsReview: results.needsReview.length,
      noMatch: results.noMatch.length,
      alreadyCategorized: results.alreadyCategorized.length,
      errors: results.errors.length,
      results: results,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

// ============================================================================
// REVIEW QUEUE MANAGEMENT
// ============================================================================

/**
 * Get all items in the review queue
 */
function handleGetReviewQueue(params) {
  try {
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized. Run init endpoint first.',
      };
    }
    
    const rules = config.rules || [];
    const categories = config.categories || [];
    const assignments = config.assignments || {};
    const reviewQueue = config.reviewQueue || [];
    
    // Get ALL uncategorized files from Drive
    const uncategorizedFiles = [];
    let pageToken = null;
    let pageCount = 0;
    const maxPages = 5; // Limit to prevent timeout (5 pages * 100 = 500 files max)
    
    try {
      do {
        const response = Drive.Files.list({
          pageSize: 100,
          pageToken: pageToken,
          fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, iconLink, owners)',
          q: "trashed = false",
        });
        
        if (response.files && response.files.length > 0) {
          // Filter out files that are already categorized
          const filtered = response.files.filter(file => !assignments[file.id]);
          uncategorizedFiles.push(...filtered);
        }
        
        pageToken = response.nextPageToken;
        pageCount++;
      } while (pageToken && pageCount < maxPages);
    } catch (error) {
      Logger.log('Error fetching uncategorized files: ' + error.message);
      return {
        success: false,
        error: 'Failed to fetch files from Drive: ' + error.message,
      };
    }
    
    // If no rules exist, return empty queue with message
    if (rules.length === 0) {
      return {
        success: true,
        queue: [],
        message: 'No rules defined. Create rules in Settings to enable auto-categorization suggestions.',
      };
    }
    
    // Evaluate each uncategorized file against rules
    const enhancedQueue = [];
    
    uncategorizedFiles.forEach(file => {
      // Check if already in review queue
      const existingReview = reviewQueue.find(item => item.fileId === file.id);
      
      // Evaluate file against all rules
      const matches = evaluateFileAgainstRules(file, rules);
      
      if (matches.length > 0) {
        // Take the top match
        const topMatch = matches[0];
        const category = categories.find(cat => cat.id === topMatch.categoryId);
        
        // Build reason from matched rules
        const matchedRuleDescs = topMatch.matchedRules.map(ruleId => {
          const rule = rules.find(r => r.id === ruleId);
          if (rule) {
            return rule.field + ' ' + rule.operator + ' "' + rule.value + '"';
          }
          return 'Rule ' + ruleId;
        }).join(', ');
        
        const reason = 'Matched ' + topMatch.matchCount + ' of ' + topMatch.totalRules + ' rules: ' + matchedRuleDescs;
        
        enhancedQueue.push({
          id: existingReview ? existingReview.id : 'auto-' + file.id,
          fileId: file.id,
          suggestedCategoryId: topMatch.categoryId,
          confidence: topMatch.confidence,
          reason: reason,
          source: 'rules',
          status: existingReview ? existingReview.status : 'pending',
          createdAt: existingReview ? existingReview.createdAt : new Date().toISOString(),
          file: {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime,
            iconLink: file.iconLink,
          },
          suggestedCategory: category ? {
            id: category.id,
            name: category.name,
            color: category.color,
            icon: category.icon,
          } : null,
        });
      }
    });
    
    // Also include files from reviewQueue that are manually added (unmatched files)
    reviewQueue.forEach(queueItem => {
      // Skip if already processed above or if not pending
      if (queueItem.status !== 'pending') return;
      
      const alreadyIncluded = enhancedQueue.find(item => item.fileId === queueItem.fileId);
      if (alreadyIncluded) return;
      
      // Build file data from flat fields stored in queue item
      let fileData = {
        id: queueItem.fileId,
        name: queueItem.fileName || 'Unknown',
        mimeType: queueItem.mimeType || '',
        modifiedTime: queueItem.modifiedTime || '',
        iconLink: queueItem.iconLink || '',
        thumbnailLink: queueItem.thumbnailLink || '',
      };
      
      // If any critical field is missing, try fetching from Drive
      if (!queueItem.fileName || !queueItem.mimeType) {
        try {
          const driveFile = Drive.Files.get(queueItem.fileId, {
            fields: 'id, name, mimeType, modifiedTime, iconLink, thumbnailLink'
          });
          fileData = {
            id: driveFile.id,
            name: driveFile.name,
            mimeType: driveFile.mimeType,
            modifiedTime: driveFile.modifiedTime,
            iconLink: driveFile.iconLink,
            thumbnailLink: driveFile.thumbnailLink,
          };
        } catch (e) {
          Logger.log('Could not fetch file for review queue item: ' + queueItem.fileId);
          return;
        }
      }
      
      // Get suggested category if available
      let suggestedCategory = null;
      if (queueItem.suggestedCategoryId) {
        suggestedCategory = categories.find(cat => cat.id === queueItem.suggestedCategoryId) || null;
      }
      
      // Add unmatched file to queue
      enhancedQueue.push({
        id: queueItem.id,
        fileId: queueItem.fileId,
        suggestedCategoryId: queueItem.suggestedCategoryId || null,
        confidence: queueItem.confidence || 0,
        reason: queueItem.reason || 'No matching rules found',
        source: queueItem.source || 'unmatched',
        status: queueItem.status,
        addedAt: queueItem.addedAt || queueItem.createdAt || new Date().toISOString(),
        file: fileData,
        suggestedCategory: suggestedCategory,
      });
    });
    
    // Filter by status if requested
    let filteredQueue = enhancedQueue;
    if (params.status) {
      filteredQueue = enhancedQueue.filter(item => item.status === params.status);
    }
    
    // Sort by confidence (highest first)
    filteredQueue.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    
    // Logging the response
    Logger.log('handleGetReviewQueue response - total items: ' + filteredQueue.length);
    if (filteredQueue.length > 0) {
      Logger.log('First item: ' + JSON.stringify(filteredQueue[0]));
    }
    
    return {
      success: true,
      queue: filteredQueue,
      total: enhancedQueue.length,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Accept a review suggestion and assign the file to the suggested category
 */
function handleReviewAccept(body) {
  try {
    const { reviewId, fileId } = body;
    
    if (!reviewId && !fileId) {
      return {
        success: false,
        error: 'reviewId or fileId is required',
      };
    }
    
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized.',
      };
    }
    
    if (!config.reviewQueue) {
      config.reviewQueue = [];
    }
    
    // Find review item
    const reviewIndex = config.reviewQueue.findIndex(item => 
      (reviewId && item.id === reviewId) || (fileId && item.fileId === fileId)
    );
    
    if (reviewIndex === -1) {
      return {
        success: false,
        error: 'Review item not found',
      };
    }
    
    const reviewItem = config.reviewQueue[reviewIndex];
    
    // Assign file to suggested category
    if (!config.assignments) {
      config.assignments = {};
    }
    config.assignments[reviewItem.fileId] = reviewItem.suggestedCategoryId;
    
    // Log feedback
    if (!config.feedbackLog) {
      config.feedbackLog = [];
    }
    config.feedbackLog.push({
      fileId: reviewItem.fileId,
      fileName: reviewItem.fileName,
      suggestedCategoryId: reviewItem.suggestedCategoryId,
      finalCategoryId: reviewItem.suggestedCategoryId,
      confidence: reviewItem.confidence,
      action: 'accepted',
      source: reviewItem.source,
      timestamp: new Date().toISOString(),
    });
    
    // Remove from queue
    config.reviewQueue.splice(reviewIndex, 1);
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      fileId: reviewItem.fileId,
      categoryId: reviewItem.suggestedCategoryId,
      message: 'Review accepted and file categorized',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Auto-assign a single file using rules
 */
function handleAutoAssign(body) {
  try {
    const { fileId } = body;
    
    if (!fileId) {
      return {
        success: false,
        error: 'fileId is required',
      };
    }
    
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized.',
      };
    }
    
    const rules = config.rules || [];
    if (rules.length === 0) {
      return {
        success: false,
        error: 'No rules defined. Create rules first.',
      };
    }
    
    // Get file info
    let file;
    try {
      file = Drive.Files.get(fileId, {
        fields: 'id, name, mimeType, modifiedTime, iconLink, thumbnailLink, owners'
      });
    } catch (error) {
      return {
        success: false,
        error: 'File not found or not accessible',
      };
    }
    
    // Evaluate file against rules
    const matches = evaluateFileAgainstRules(file, rules);
    
    if (matches.length === 0) {
      // Add to review queue
      if (!config.reviewQueue) {
        config.reviewQueue = [];
      }
      
      // Check if already in review queue
      const existingIndex = config.reviewQueue.findIndex(item => item.fileId === fileId);
      
      // Store flat fields instead of nested file object
      const queueItem = {
        id: existingIndex >= 0 ? config.reviewQueue[existingIndex].id : 'review-' + new Date().getTime() + '-' + fileId,
        fileId: fileId,
        fileName: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        iconLink: file.iconLink,
        thumbnailLink: file.thumbnailLink,
        status: 'pending',
        source: 'unmatched',
        addedAt: existingIndex >= 0 ? config.reviewQueue[existingIndex].addedAt : new Date().toISOString(),
      };
      
      if (existingIndex >= 0) {
        config.reviewQueue[existingIndex] = queueItem;
      } else {
        config.reviewQueue.push(queueItem);
      }
      
      // Logging before save
      Logger.log('Adding to review queue - handleAutoAssign: ' + JSON.stringify(queueItem));
      
      // Save config
      writeConfig(config);
      
      return {
        success: false,
        error: 'No matching rules found for this file',
        addedToReview: true,
      };
    }
    
    // Take the top match
    const topMatch = matches[0];
    
    // Verify category exists
    const category = config.categories && config.categories.find(cat => cat.id === topMatch.categoryId);
    if (!category) {
      return {
        success: false,
        error: 'Matched category not found',
      };
    }
    
    // Assign file to category
    if (!config.assignments) {
      config.assignments = {};
    }
    config.assignments[fileId] = topMatch.categoryId;
    
    // Log the auto-assignment
    if (!config.feedbackLog) {
      config.feedbackLog = [];
    }
    config.feedbackLog.push({
      fileId: fileId,
      fileName: file.name,
      suggestedCategoryId: topMatch.categoryId,
      finalCategoryId: topMatch.categoryId,
      confidence: topMatch.confidence,
      action: 'auto-assigned',
      source: 'rules',
      timestamp: new Date().toISOString(),
    });
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      fileId: fileId,
      categoryId: topMatch.categoryId,
      category: {
        id: category.id,
        name: category.name,
        color: category.color,
        icon: category.icon,
      },
      confidence: topMatch.confidence,
      matchCount: topMatch.matchCount,
      totalRules: topMatch.totalRules,
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Auto-assign multiple files using rules (batch operation)
 */
function handleBatchAutoAssign(body) {
  try {
    const { fileIds } = body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return {
        success: false,
        error: 'fileIds array is required',
      };
    }
    
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized.',
      };
    }
    
    const rules = config.rules || [];
    if (rules.length === 0) {
      return {
        success: false,
        error: 'No rules defined. Create rules first.',
      };
    }
    
    if (!config.assignments) {
      config.assignments = {};
    }
    
    if (!config.feedbackLog) {
      config.feedbackLog = [];
    }
    
    const results = {
      assigned: [],
      noMatch: [],
      errors: [],
    };
    
    // Process each file
    fileIds.forEach(fileId => {
      try {
        // Get file info
        const file = Drive.Files.get(fileId, {
          fields: 'id, name, mimeType, modifiedTime, iconLink, thumbnailLink, owners'
        });
        
        // Evaluate file against rules
        const matches = evaluateFileAgainstRules(file, rules);
        
        if (matches.length === 0) {
          // Add to review queue instead of just tracking as noMatch
          if (!config.reviewQueue) {
            config.reviewQueue = [];
          }
          
          // Check if already in review queue
          const existingIndex = config.reviewQueue.findIndex(item => item.fileId === file.id);
          
          // Store flat fields instead of nested file object
          const queueItem = {
            id: existingIndex >= 0 ? config.reviewQueue[existingIndex].id : 'review-' + new Date().getTime() + '-' + file.id,
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            modifiedTime: file.modifiedTime,
            iconLink: file.iconLink,
            thumbnailLink: file.thumbnailLink,
            status: 'pending',
            source: 'unmatched',
            addedAt: existingIndex >= 0 ? config.reviewQueue[existingIndex].addedAt : new Date().toISOString(),
          };
          
          if (existingIndex >= 0) {
            config.reviewQueue[existingIndex] = queueItem;
          } else {
            config.reviewQueue.push(queueItem);
          }
          
          results.noMatch.push({
            fileId: fileId,
            fileName: file.name,
          });
          return;
        }
        
        // Take the top match
        const topMatch = matches[0];
        
        // Verify category exists
        const category = config.categories && config.categories.find(cat => cat.id === topMatch.categoryId);
        if (!category) {
          results.errors.push({
            fileId: fileId,
            error: 'Matched category not found',
          });
          return;
        }
        
        // Assign file to category
        config.assignments[fileId] = topMatch.categoryId;
        
        // Log the auto-assignment
        config.feedbackLog.push({
          fileId: fileId,
          fileName: file.name,
          suggestedCategoryId: topMatch.categoryId,
          finalCategoryId: topMatch.categoryId,
          confidence: topMatch.confidence,
          action: 'batch-auto-assigned',
          source: 'rules',
          timestamp: new Date().toISOString(),
        });
        
        results.assigned.push({
          fileId: fileId,
          fileName: file.name,
          categoryId: topMatch.categoryId,
          categoryName: category.name,
          confidence: topMatch.confidence,
        });
        
      } catch (error) {
        results.errors.push({
          fileId: fileId,
          error: error.message,
        });
      }
    });
    
    // Logging before save
    Logger.log('Batch auto-assign - reviewQueue items added: ' + results.noMatch.length);
    if (config.reviewQueue && config.reviewQueue.length > 0) {
      Logger.log('Sample queue item: ' + JSON.stringify(config.reviewQueue[config.reviewQueue.length - 1]));
    }
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      results: results,
      summary: {
        total: fileIds.length,
        assigned: results.assigned.length,
        noMatch: results.noMatch.length,
        errors: results.errors.length,
      },
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Override a review suggestion with a different category
 */
function handleReviewOverride(body) {
  try {
    const { reviewId, fileId, categoryId } = body;
    
    if (!reviewId && !fileId) {
      return {
        success: false,
        error: 'reviewId or fileId is required',
      };
    }
    
    if (!categoryId) {
      return {
        success: false,
        error: 'categoryId is required',
      };
    }
    
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized.',
      };
    }
    
    // Verify category exists
    const categoryExists = config.categories && config.categories.find(cat => cat.id === categoryId);
    if (!categoryExists) {
      return {
        success: false,
        error: 'Category not found',
      };
    }
    
    if (!config.reviewQueue) {
      config.reviewQueue = [];
    }
    
    // Find review item
    const reviewIndex = config.reviewQueue.findIndex(item => 
      (reviewId && item.id === reviewId) || (fileId && item.fileId === fileId)
    );
    
    if (reviewIndex === -1) {
      return {
        success: false,
        error: 'Review item not found',
      };
    }
    
    const reviewItem = config.reviewQueue[reviewIndex];
    
    // Assign file to chosen category
    if (!config.assignments) {
      config.assignments = {};
    }
    config.assignments[reviewItem.fileId] = categoryId;
    
    // Log feedback (this is important for learning)
    if (!config.feedbackLog) {
      config.feedbackLog = [];
    }
    config.feedbackLog.push({
      fileId: reviewItem.fileId,
      fileName: reviewItem.fileName,
      suggestedCategoryId: reviewItem.suggestedCategoryId,
      finalCategoryId: categoryId,
      confidence: reviewItem.confidence,
      action: 'overridden',
      source: reviewItem.source,
      timestamp: new Date().toISOString(),
    });
    
    // Remove from queue
    config.reviewQueue.splice(reviewIndex, 1);
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      fileId: reviewItem.fileId,
      categoryId: categoryId,
      message: 'File categorized with user override',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Skip/remove a file from review queue without categorizing
 */
function handleReviewSkip(body) {
  try {
    const { reviewId, fileId } = body;
    
    if (!reviewId && !fileId) {
      return {
        success: false,
        error: 'reviewId or fileId is required',
      };
    }
    
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized.',
      };
    }
    
    if (!config.reviewQueue) {
      config.reviewQueue = [];
    }
    
    // Find review item
    const reviewIndex = config.reviewQueue.findIndex(item => 
      (reviewId && item.id === reviewId) || (fileId && item.fileId === fileId)
    );
    
    if (reviewIndex === -1) {
      return {
        success: false,
        error: 'Review item not found',
      };
    }
    
    const reviewItem = config.reviewQueue[reviewIndex];
    
    // Log feedback
    if (!config.feedbackLog) {
      config.feedbackLog = [];
    }
    config.feedbackLog.push({
      fileId: reviewItem.fileId,
      fileName: reviewItem.fileName,
      suggestedCategoryId: reviewItem.suggestedCategoryId,
      finalCategoryId: null,
      confidence: reviewItem.confidence,
      action: 'skipped',
      source: reviewItem.source,
      timestamp: new Date().toISOString(),
    });
    
    // Remove from queue
    config.reviewQueue.splice(reviewIndex, 1);
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      fileId: reviewItem.fileId,
      message: 'File removed from review queue',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

/**
 * Manually add a file to the review queue
 */
function handleReviewAdd(body) {
  try {
    const { fileId, suggestedCategoryId, confidence, reason, source } = body;
    
    if (!fileId) {
      return {
        success: false,
        error: 'fileId is required',
      };
    }
    
    const config = readConfig();
    if (!config) {
      return {
        success: false,
        error: 'Configuration not initialized.',
      };
    }
    
    // Get file info
    let fileName = 'Unknown';
    try {
      const file = Drive.Files.get(fileId, { fields: 'name' });
      fileName = file.name;
    } catch (e) {
      return {
        success: false,
        error: 'File not found or not accessible',
      };
    }
    
    if (!config.reviewQueue) {
      config.reviewQueue = [];
    }
    
    // Create review item
    const queueItem = {
      id: 'review_' + new Date().getTime() + '_' + Math.random().toString(36).substr(2, 9),
      fileId: fileId,
      fileName: fileName,
      suggestedCategoryId: suggestedCategoryId || null,
      confidence: confidence || 0,
      reason: reason || 'Manually added to review queue',
      source: source || 'manual',
      addedAt: new Date().toISOString(),
      status: 'pending',
    };
    
    // Check if item already exists
    const existingIndex = config.reviewQueue.findIndex(item => item.fileId === fileId);
    if (existingIndex !== -1) {
      config.reviewQueue[existingIndex] = queueItem;
    } else {
      config.reviewQueue.push(queueItem);
    }
    
    // Save config
    writeConfig(config);
    
    return {
      success: true,
      reviewItem: queueItem,
      message: 'File added to review queue',
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack,
    };
  }
}

// ============================================================================
// AI HANDLERS (Gemini via Apps Script)
// ============================================================================

function handleAiCategorize(body) {
  try {
    if (!CONFIG.AI_ENABLED) {
      return { success: false, error: 'AI disabled' };
    }
    const prompt = body && body.prompt ? String(body.prompt) : '';
    const model = body && body.model ? String(body.model) : 'gemma-3n-e4b-it';
    const temperature = body && body.temperature !== undefined ? Number(body.temperature) : 0.2;
    const maxOutputTokens = body && body.maxOutputTokens !== undefined ? Number(body.maxOutputTokens) : 512;

    if (!prompt) {
      return { success: false, error: 'Missing prompt' };
    }

    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return { success: false, error: 'Gemini API key not configured' };
    }

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: isNaN(temperature) ? 0.2 : temperature,
        maxOutputTokens: isNaN(maxOutputTokens) ? 512 : maxOutputTokens,
      },
    };

    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      return { success: false, error: 'Gemini request failed: ' + response.getResponseCode() };
    }

    const data = JSON.parse(response.getContentText() || '{}');
    const candidate = data && data.candidates && data.candidates[0] ? data.candidates[0] : null;
    const text = extractGeminiText(candidate);

    if (!text) {
      return { success: false, error: 'Gemini response missing text' };
    }

    return { success: true, text: text };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

function extractGeminiText(candidate) {
  if (!candidate) return null;
  const content = candidate.content || {};
  if (content.text) {
    return String(content.text);
  }
  const parts = content.parts || [];
  if (parts && parts.length > 0) {
    return parts.map(function (part) { return part && part.text ? part.text : ''; }).join('');
  }
  return null;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get or create config folder
 */
function getConfigFolder() {
  const folders = DriveApp.getFoldersByName(CONFIG.CONFIG_FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(CONFIG.CONFIG_FOLDER_NAME);
}

/**
 * Get config file
 */
function getConfigFile() {
  const folder = getConfigFolder();
  const files = folder.getFilesByName(CONFIG.CONFIG_FILE_NAME);
  if (files.hasNext()) {
    return files.next();
  }
  return null;
}

/**
 * Read config
 */
function readConfig() {
  const file = getConfigFile();
  if (!file) {
    return null;
  }
  return JSON.parse(file.getBlob().getDataAsString());
}

/**
 * Write config
 */
function writeConfig(config) {
  const folder = getConfigFolder();
  const files = folder.getFilesByName(CONFIG.CONFIG_FILE_NAME);
  
  config.updatedAt = new Date().toISOString();
  const content = JSON.stringify(config, null, 2);
  
  if (files.hasNext()) {
    // Update existing file
    const file = files.next();
    file.setContent(content);
    return file;
  } else {
    // Create new file
    return folder.createFile(CONFIG.CONFIG_FILE_NAME, content, MimeType.PLAIN_TEXT);
  }
}

// ============================================================================
// FILE VIEWING & DOWNLOAD HANDLERS
// ============================================================================

/**
 * Get file view URL for previewing files
 * GET /api/file-view?fileId=xxx
 */
function handleGetFileViewUrl(params) {
  try {
    const fileId = params.fileId;
    
    if (!fileId) {
      return {
        success: false,
        error: 'Missing required parameter: fileId'
      };
    }
    
    // Get file metadata from Drive API
    const file = Drive.Files.get(fileId, {
      fields: 'id,name,mimeType,webViewLink,embedLink,iconLink,thumbnailLink'
    });
    
    if (!file) {
      return {
        success: false,
        error: 'File not found'
      };
    }
    
    // Determine the best view URL based on file type
    let viewUrl = file.webViewLink;
    let embedUrl = null;
    let viewType = 'external'; // external, embed, or download
    
    // For Google Workspace files, we can use embed links
    if (file.mimeType.includes('google-apps')) {
      if (file.embedLink) {
        embedUrl = file.embedLink;
        viewType = 'embed';
      }
    }
    // For images, PDFs, and other viewable files
    else if (file.mimeType.includes('image/') || file.mimeType === 'application/pdf') {
      viewType = 'embed';
      embedUrl = viewUrl; // Can be embedded in iframe
    }
    
    return {
      success: true,
      file: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        embedLink: embedUrl,
        viewType: viewType,
        iconLink: file.iconLink,
        thumbnailLink: file.thumbnailLink
      }
    };
    
  } catch (error) {
    return {
      success: false,
      error: 'Failed to get file view URL: ' + error.message
    };
  }
}

/**
 * Get file download URL
 * GET /api/file-download?fileId=xxx&exportFormat=pdf (optional for Google Workspace files)
 */
function handleGetFileDownloadUrl(params) {
  try {
    const fileId = params.fileId;
    const exportFormat = params.exportFormat || null;
    
    if (!fileId) {
      return {
        success: false,
        error: 'Missing required parameter: fileId'
      };
    }
    
    // Get file metadata
    const file = Drive.Files.get(fileId, {
      fields: 'id,name,mimeType,webContentLink,size'
    });
    
    if (!file) {
      return {
        success: false,
        error: 'File not found'
      };
    }
    
    let downloadUrl = file.webContentLink;
    let exportFormats = [];
    let isGoogleWorkspace = file.mimeType.includes('google-apps');
    
    // For Google Workspace files, provide export options
    if (isGoogleWorkspace) {
      const exportMimeTypes = getExportMimeTypes(file.mimeType);
      exportFormats = exportMimeTypes;
      
      // If export format is specified, generate export URL
      if (exportFormat && exportMimeTypes.some(e => e.format === exportFormat)) {
        const mimeType = exportMimeTypes.find(e => e.format === exportFormat).mimeType;
        downloadUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=' + encodeURIComponent(mimeType);
      } else {
        // Default export format
        downloadUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=' + encodeURIComponent(exportMimeTypes[0].mimeType);
      }
    }
    
    return {
      success: true,
      file: {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        downloadUrl: downloadUrl,
        size: file.size,
        isGoogleWorkspace: isGoogleWorkspace,
        exportFormats: exportFormats
      }
    };
    
  } catch (error) {
    return {
      success: false,
      error: 'Failed to get file download URL: ' + error.message
    };
  }
}

/**
 * Get available export MIME types for Google Workspace files
 */
function getExportMimeTypes(mimeType) {
  const formats = [];
  
  if (mimeType === 'application/vnd.google-apps.document') {
    // Google Docs
    formats.push(
      { format: 'pdf', mimeType: 'application/pdf', label: 'PDF' },
      { format: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word (.docx)' },
      { format: 'odt', mimeType: 'application/vnd.oasis.opendocument.text', label: 'OpenDocument (.odt)' },
      { format: 'rtf', mimeType: 'application/rtf', label: 'Rich Text (.rtf)' },
      { format: 'txt', mimeType: 'text/plain', label: 'Plain Text (.txt)' },
      { format: 'html', mimeType: 'text/html', label: 'HTML (.html)' }
    );
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    // Google Sheets
    formats.push(
      { format: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel (.xlsx)' },
      { format: 'ods', mimeType: 'application/x-vnd.oasis.opendocument.spreadsheet', label: 'OpenDocument (.ods)' },
      { format: 'pdf', mimeType: 'application/pdf', label: 'PDF' },
      { format: 'csv', mimeType: 'text/csv', label: 'CSV (first sheet)' },
      { format: 'tsv', mimeType: 'text/tab-separated-values', label: 'TSV (first sheet)' }
    );
  } else if (mimeType === 'application/vnd.google-apps.presentation') {
    // Google Slides
    formats.push(
      { format: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint (.pptx)' },
      { format: 'odp', mimeType: 'application/vnd.oasis.opendocument.presentation', label: 'OpenDocument (.odp)' },
      { format: 'pdf', mimeType: 'application/pdf', label: 'PDF' },
      { format: 'txt', mimeType: 'text/plain', label: 'Plain Text (.txt)' }
    );
  } else if (mimeType === 'application/vnd.google-apps.drawing') {
    // Google Drawings
    formats.push(
      { format: 'pdf', mimeType: 'application/pdf', label: 'PDF' },
      { format: 'png', mimeType: 'image/png', label: 'PNG' },
      { format: 'jpeg', mimeType: 'image/jpeg', label: 'JPEG' },
      { format: 'svg', mimeType: 'image/svg+xml', label: 'SVG' }
    );
  }
  
  return formats;
}

// ============================================================================
// TESTING FUNCTIONS (Run these from Apps Script editor)
// ============================================================================

/**
 * Test function - Run this in Apps Script to test
 */
function testHealthEndpoint() {
  const response = handleHealth();
  Logger.log(response);
}

/**
 * Test function - Initialize config
 */
function testInitEndpoint() {
  const response = handleInit();
  Logger.log(response);
}

/**
 * Test function - List some Drive files
 */
function testDriveAccess() {
  const files = DriveApp.getFiles();
  let count = 0;
  while (files.hasNext() && count < 5) {
    const file = files.next();
    Logger.log(file.getName() + ' - ' + file.getMimeType());
    count++;
  }
  Logger.log('Total accessible files: at least ' + count);
}
