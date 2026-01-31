import React, { useState } from 'react';
import './FileThumbnail.css';

interface FileThumbnailProps {
  thumbnailLink?: string;
  iconLink?: string;
  mimeType: string;
  fileName: string;
  size?: 'small' | 'medium' | 'large';
}

const FileThumbnail: React.FC<FileThumbnailProps> = ({
  thumbnailLink,
  iconLink,
  mimeType,
  fileName,
  size = 'small'
}) => {
  const [thumbnailError, setThumbnailError] = useState(false);
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);

  // Get file type from MIME type
  const getFileType = (mime: string): string => {
    if (mime.includes('document')) return 'document';
    if (mime.includes('spreadsheet')) return 'sheet';
    if (mime.includes('presentation')) return 'slide';
    if (mime.includes('pdf')) return 'pdf';
    if (mime.includes('image/')) return 'image';
    if (mime.includes('video/')) return 'video';
    if (mime.includes('folder')) return 'folder';
    return 'other';
  };

  // Get emoji fallback icon
  const getEmojiIcon = (mime: string): string => {
    const type = getFileType(mime);
    const icons: Record<string, string> = {
      document: '📄',
      sheet: '📊',
      slide: '📑',
      pdf: '📕',
      image: '🖼️',
      video: '🎬',
      folder: '📁',
      other: '📎'
    };
    return icons[type] || '📎';
  };

  const fileType = getFileType(mimeType);
  const emojiIcon = getEmojiIcon(mimeType);

  // Determine what to show
  const showThumbnail = thumbnailLink && !thumbnailError && fileType === 'image';
  const showIcon = iconLink && !showThumbnail;

  return (
    <div className={`file-thumbnail file-thumbnail-${size}`}>
      {showThumbnail ? (
        <>
          {!thumbnailLoaded && (
            <div className="file-thumbnail-placeholder">
              <span className="file-thumbnail-emoji">{emojiIcon}</span>
            </div>
          )}
          <img
            src={thumbnailLink}
            alt={fileName}
            className={`file-thumbnail-image ${thumbnailLoaded ? 'loaded' : ''}`}
            onLoad={() => setThumbnailLoaded(true)}
            onError={() => setThumbnailError(true)}
            loading="lazy"
          />
        </>
      ) : showIcon ? (
        <img
          src={iconLink}
          alt={fileName}
          className="file-thumbnail-icon"
          onError={(e) => {
            // Fallback to emoji if icon fails to load
            e.currentTarget.style.display = 'none';
            const parent = e.currentTarget.parentElement;
            if (parent) {
              const emoji = document.createElement('span');
              emoji.className = 'file-thumbnail-emoji';
              emoji.textContent = emojiIcon;
              parent.appendChild(emoji);
            }
          }}
          loading="lazy"
        />
      ) : (
        <span className="file-thumbnail-emoji">{emojiIcon}</span>
      )}
    </div>
  );
};

export default FileThumbnail;
