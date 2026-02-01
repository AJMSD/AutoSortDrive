# Code Review Checklist

## 1. Dead / Redundant / Unused Code
- [x] File: `src/lib/configManager.ts` (function `getCachedConfigVersion`, around line 548)
  - Why: This getter is never referenced in the repo, so `cachedConfigVersion` is effectively unused state.
  - Recommended action: Implemented — removed the getter and unused field.
- [x] File: `src/lib/unifiedClient.ts` (lines 1062 and 1064)
  - Why: Two identical `logger.debug` calls for the same message (`listFiles: Config loaded`) are duplicated.
  - Recommended action: Implemented — kept a single log line.
- [x] File: `src/pages/ReviewQueuePage.tsx` (line 132)
  - Why: `cachedQueue.length >= 0` is always true, so the condition is redundant.
  - Recommended action: Implemented — simplified the condition.
- [x] Files: `src/pages/InboxPage.tsx`, `src/pages/CategoryViewPage.tsx`, `src/components/common/FileThumbnail.tsx`
  - Identifier: `getFileType` and `getRelativeTime` helper functions
  - Why: Same logic is duplicated in multiple files, increasing maintenance cost.
  - Recommended action: Implemented — extracted shared helpers to `src/utils/fileHelpers.ts` and reused.

## 2. Debug / Logging / Console Cleanup
- [x] File: `src/lib/config.ts` (lines 44-73)
  - Type: `console.log`
  - Why: Direct console logging of config status is noisy for production and bypasses the logger.
  - Recommended action: Implemented — removed the verbose debug block in `validateConfig` while keeping `logConfigStatus` gated for diagnostics.
- [x] File: `src/pages/InboxPage.tsx` (lines 173, 204, 236, 901, 982, 1255)
  - Type: `logger.debug`
  - Why: Explicit DEBUG logs and per-file render logging can be very noisy and slow for large lists.
  - Recommended action: Implemented — removed per-response/per-render debug logs.
- [x] File: `src/pages/ReviewQueuePage.tsx` (lines 148, 225, 228-231)
  - Type: `logger.debug`
  - Why: Debug logs dump queue details and sample items; likely leftover from troubleshooting.
  - Recommended action: Implemented — removed queue detail/sample logging.
- [x] File: `src/lib/unifiedClient.ts` (lines 1070, 1099)
  - Type: `logger.debug`
  - Why: Logs include review queue IDs and file names; high volume during list operations.
  - Recommended action: Implemented — removed per-file/ID logging.
- [x] File: `src/hooks/useAuth.ts` (functions `validateOAuthConfig`, `login`, `refreshToken`, token-expiry effect; lines ~161-470)
  - Type: `logger.debug` / `logger.error`
  - Why: Very verbose OAuth logging (origins, user email, token metadata). Useful for debugging but not for prod.
  - Recommended action: Implemented — removed debug logs; kept warnings/errors.
- [x] File: `src/components/layout/Navbar.tsx` (lines 16, 22)
  - Type: `logger.debug`
  - Why: Logs user identity on every auth change; likely not needed outside diagnostics.
  - Recommended action: Implemented — removed debug logs; kept error logs for failures.
- [x] File: `src/components/common/ProfileDropdown.tsx` (lines 48-145)
  - Type: `logger.debug` / `logger.error`
  - Why: Image-load retries and failures are logged frequently; may be overly verbose in production.
  - Recommended action: Implemented — removed debug logging, retained error logging.
- [x] File: `src/lib/driveClient.ts` (lines 25, 57, 98)
  - Type: `logger.debug`
  - Why: Logs every Drive API request and response; can spam logs for large lists.
  - Recommended action: Implemented — removed debug logging, retained error logging.
- [x] File: `backend/Code.gs` (lines 413-417, 426, 1703-1705, 1882, 2090-2092, 2696-2718)
  - Type: `Logger.log`
  - Why: Debug logging of file lists and queue details can expose filenames and add noise.
  - Recommended action: Implemented — wrapped debug logging with `CONFIG.DEBUG`.

## 3. Obvious Inefficiencies (Safe Optimizations)
- [x] File: `src/pages/InboxPage.tsx` (lines 490-496)
  - Issue: `fetchFiles()` is called on both `visibilitychange` and `focus`, which can fire together and cause duplicate API calls.
  - Recommended action: Implemented — added a short debounce and an in-flight guard.
- [x] File: `src/pages/ReviewQueuePage.tsx` (lines 94-100)
  - Issue: `loadData()` is called on both `visibilitychange` and `focus`, risking double refreshes.
  - Recommended action: Implemented — added a short debounce and an in-flight guard.
- [x] File: `src/pages/InboxPage.tsx` (lines 888-889)
  - Issue: `selectedCount` and `hasSelectedInReview` recompute full scans of `files` every render.
  - Recommended action: Implemented — memoized derived values with `useMemo`.
- [x] File: `src/pages/CategoryViewPage.tsx` (function `loadCategory`, when inbox cache is empty)
  - Issue: Falls back to a full Drive listing to hydrate cache, which can be expensive for large drives.
  - Recommended action: Implemented partial mitigation — added a shared in-flight hydration guard to prevent duplicate full scans. Full scan is still required to preserve assignment-based categories.

## 4. Caching Consistency & Opportunities
- [x] File: `src/utils/userCache.ts` (lines 15-123)
  - Issue: Config-version invalidation is only applied when both `options.configVersion` and `entry.configVersion` exist; many cache writes omit `configVersion`.
  - Example: A user updates rules/categories in another tab. The current tab keeps serving stale cached categories because the cache entry lacks a version, so the mismatch is never detected and the UI shows outdated counts or assignments.
  - Recommended action: Implemented — cache writes now default to the current config version when available, and `get` invalidates entries that lack a version when a version is required.
- [x] File: `src/pages/ReviewQueuePage.tsx` (lines 175-207)
  - Issue: Review queue cache is written using the current cached config version; the API response does not update `userCache.setConfigVersion`.
  - Example: The review queue changes on the server (new suggestions), but this tab never updates its config version and keeps serving an out-of-date queue until the TTL expires, causing users to miss pending items.
  - Recommended action: Implemented — `getReviewQueue` now returns `configVersion`, and the page updates `userCache.setConfigVersion` before caching.
- [x] File: `src/pages/InboxPage.tsx` (lines 834-876)
  - Issue: After assigning categories, the code both updates category counts in cache and triggers a full refetch (`loadCategories(true)`), which can cause duplicate work.
  - Example: Bulk assign triggers a cache count update and then an immediate refetch; on slower networks this can show a “count flicker” as the UI briefly shows the cached count, then reverts to older server data before the new counts arrive.
  - Recommended action: Implemented — removed the immediate refetch and instead update categories state + cache counts in-place (fallback to refetch only if categories state is empty).

## 5. Security / Privacy Risks
- [x] File: `api/ai-categorize.js` (function `verifyGoogleToken` and request handler)
  - Issue: Token verification only checks that the access token is valid and has an email; it does not validate `aud`/`azp` against your OAuth client or verify required scopes.
  - Example: A valid Google access token from a different app (wrong audience) could call your AI endpoint and consume rate limits or AI quota on behalf of that user.
  - Recommended action: Implemented — added optional audience/scope validation (enforced when `GOOGLE_OAUTH_CLIENT_ID(S)` and/or `GOOGLE_OAUTH_REQUIRED_SCOPES` are configured).
- [x] File: `src/hooks/useAuth.ts` (login/refresh flows)
  - Issue: Debug logs include user email and OAuth metadata; if debug mode is accidentally enabled in production, this can leak PII into logs.
  - Example: If a production build accidentally enables debug mode, user emails and token metadata could be captured by log aggregation tools and retained beyond intended privacy policies.
  - Recommended action: Implemented — removed verbose debug logging in auth flows; remaining logs avoid user-identifying fields.

## 6. Code Comments & Documentation (Suggested Additions)
- [x] File: `src/pages/InboxPage.tsx` (top of file)
  - Suggested comment: "Main inbox view; loads and caches Drive files, supports filters, pagination, bulk actions, and AI auto-assign."
- [x] File: `src/pages/CategoryViewPage.tsx` (top of file)
  - Suggested comment: "Category detail view derived from cached inbox data (with fallback fetch); supports removal and bulk download."
- [x] File: `src/pages/ReviewQueuePage.tsx` (top of file)
  - Suggested comment: "Review queue view that merges stored suggestions and rule-based matches with bulk actions and feedback."
- [x] File: `src/pages/RulesPage.tsx` (top of file)
  - Suggested comment: "Rules + AI settings management; loads categories/rules/settings and persists edits."
- [x] File: `src/components/common/ProfileDropdown.tsx` (top of file)
  - Suggested comment: "User menu with profile image fallbacks, theme toggle, and logout/navigation links."
- [x] File: `src/components/common/FilePreviewModal.tsx` (top of file)
  - Suggested comment: "Modal that fetches authenticated preview/download URLs and renders previews or export options."
- [x] File: `src/components/common/MobileRestriction.tsx` (top of file)
  - Suggested comment: "Wrapper that blocks the UI on small screens and shows a desktop-only message."

## 8. Syntax / Type / Lint Issues
- [x] File: `src/components/common/FirstLoginModal.tsx` (lines 61, 74)
  - Issue: `className` uses escaped template interpolation (`\${...}`), so the `selected` class never applies.
  - Recommended fix: Implemented — removed the backslash so the conditional class is evaluated.
- [x] File: `src/pages/RulesPage.tsx` (lines 627, 652)
  - Issue: Same escaped interpolation (`\${...}`) in pagination link classes, so `disabled` styling never applies.
  - Recommended fix: Implemented — removed the backslash so the conditional class is evaluated.
