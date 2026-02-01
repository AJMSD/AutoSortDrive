export type FileType =
  | 'document'
  | 'image'
  | 'pdf'
  | 'sheet'
  | 'slide'
  | 'video'
  | 'folder'
  | 'other';

export const getFileTypeFromMime = (mimeType?: string): FileType => {
  if (!mimeType) return 'other';
  if (mimeType.includes('document')) return 'document';
  if (mimeType.includes('spreadsheet')) return 'sheet';
  if (mimeType.includes('presentation')) return 'slide';
  if (mimeType.includes('pdf')) return 'pdf';
  if (mimeType.includes('image/')) return 'image';
  if (mimeType.includes('video/')) return 'video';
  if (mimeType.includes('folder')) return 'folder';
  return 'other';
};

export const getRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};
