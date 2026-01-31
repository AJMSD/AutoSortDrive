import JSZip from 'jszip';
import toast from 'react-hot-toast';
import { appsScriptClient } from '@/lib/appsScriptClient';
import { userCache } from '@/utils/userCache';
import { authStorage } from '@/utils/authStorage';

const MAX_BULK_DOWNLOAD = 30;
const DOWNLOAD_META_TTL = 30 * 60 * 1000;

const DEFAULT_EXPORT_FORMATS: Record<string, string> = {
  'application/vnd.google-apps.document': 'pdf',
  'application/vnd.google-apps.spreadsheet': 'xlsx',
  'application/vnd.google-apps.presentation': 'pptx',
  'application/vnd.google-apps.drawing': 'png',
};

type BulkDownloadFile = {
  id: string;
  name: string;
  mimeType?: string;
};

const getExportFormat = (mimeType?: string) => {
  if (!mimeType) return undefined;
  return DEFAULT_EXPORT_FORMATS[mimeType];
};

const getDownloadCacheKey = (fileId: string) => `download_meta_${fileId}`;

const getCachedDownloadMeta = (fileId: string) =>
  userCache.get<any>(getDownloadCacheKey(fileId), { ttl: DOWNLOAD_META_TTL });

const setCachedDownloadMeta = (fileId: string, data: any) =>
  userCache.set(getDownloadCacheKey(fileId), data, { ttl: DOWNLOAD_META_TTL });

const ensureExtension = (name: string, extension?: string) => {
  if (!extension) return name;
  const lowered = name.toLowerCase();
  const extWithDot = `.${extension.toLowerCase()}`;
  if (lowered.endsWith(extWithDot)) return name;
  return `${name}${extWithDot}`;
};

const buildZipName = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `ASD_${yyyy}-${mm}-${dd}.zip`;
};

export const prefetchDownloadMetadata = async (files: BulkDownloadFile[]) => {
  if (!files || files.length === 0) return;
  const accessToken = authStorage.getAccessToken();
  if (!accessToken) return;

  const BATCH_SIZE = 6;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (file) => {
        const cached = getCachedDownloadMeta(file.id);
        if (cached) return;

        const exportFormat = getExportFormat(file.mimeType);
        const result = await appsScriptClient.getFileDownloadUrl(file.id, exportFormat);
        if (!result.success) return;

        const fileInfo = result.file;
        if (fileInfo?.isGoogleWorkspace && (!fileInfo.exportFormats || fileInfo.exportFormats.length === 0)) return;

        let downloadUrl = fileInfo?.downloadUrl;
        if (!fileInfo?.isGoogleWorkspace) {
          downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileInfo?.id || file.id}?alt=media`;
        }
        if (!downloadUrl) return;

        setCachedDownloadMeta(file.id, {
          downloadUrl,
          isGoogleWorkspace: fileInfo?.isGoogleWorkspace,
          name: fileInfo?.name || file.name,
          mimeType: fileInfo?.mimeType || file.mimeType,
          exportFormat: exportFormat || undefined,
        });
      })
    );

    if (i + BATCH_SIZE < files.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
};

export const downloadFilesAsZip = async (files: BulkDownloadFile[]) => {
  if (!files || files.length === 0) return;

  if (files.length > MAX_BULK_DOWNLOAD) {
    toast.error(`Bulk download limited to ${MAX_BULK_DOWNLOAD} files.`);
    return;
  }

  const accessToken = authStorage.getAccessToken();

  if (!accessToken) {
    toast.error('Not authenticated');
    return;
  }

  const zip = new JSZip();
  const skipped: string[] = [];
  const failed: string[] = [];

  const loadingToast = toast.loading(`Preparing ${files.length} files...`, { duration: Infinity });

  const BATCH_SIZE = 5;
  let completed = 0;

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (file) => {
        const cached = getCachedDownloadMeta(file.id);
        const exportFormat = cached?.exportFormat || getExportFormat(file.mimeType);
        let downloadUrl = cached?.downloadUrl;
        let resolvedName = cached?.name || file.name;

        if (!downloadUrl) {
          const result = await appsScriptClient.getFileDownloadUrl(file.id, exportFormat);
          if (!result.success) {
            failed.push(file.name);
            completed += 1;
            return;
          }

          const fileInfo = result.file;
          if (fileInfo?.isGoogleWorkspace && (!fileInfo.exportFormats || fileInfo.exportFormats.length === 0)) {
            skipped.push(file.name);
            completed += 1;
            return;
          }

          downloadUrl = fileInfo?.downloadUrl;
          if (!fileInfo?.isGoogleWorkspace) {
            downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileInfo?.id || file.id}?alt=media`;
          }
          if (!downloadUrl) {
            failed.push(file.name);
            completed += 1;
            return;
          }

          resolvedName = fileInfo?.name || resolvedName;
          setCachedDownloadMeta(file.id, {
            downloadUrl,
            isGoogleWorkspace: fileInfo?.isGoogleWorkspace,
            name: resolvedName,
            mimeType: fileInfo?.mimeType || file.mimeType,
            exportFormat: exportFormat || undefined,
          });
        }

        try {
          const response = await fetch(downloadUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!response.ok) {
            throw new Error('Download failed');
          }
          const blob = await response.blob();
          const format = exportFormat || undefined;
          const filename = ensureExtension(resolvedName, format);
          zip.file(filename, blob);
        } catch {
          failed.push(file.name);
        }

        completed += 1;
      })
    );

    toast.loading(`Preparing ${completed}/${files.length}...`, { id: loadingToast, duration: Infinity });

    if (i + BATCH_SIZE < files.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  try {
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = window.URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildZipName();
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    toast.success('Download ready', { id: loadingToast, duration: 4000 });
  } catch {
    toast.error('Failed to generate zip', { id: loadingToast, duration: 5000 });
    return;
  }

  if (skipped.length > 0) {
    const shown = skipped.slice(0, 3).join(', ');
    const remaining = skipped.length > 3 ? ` +${skipped.length - 3} more` : '';
    toast(`Skipped (not exportable): ${shown}${remaining}`);
  }

  if (failed.length > 0) {
    const shown = failed.slice(0, 3).join(', ');
    const remaining = failed.length > 3 ? ` +${failed.length - 3} more` : '';
    toast.error(`Failed to download: ${shown}${remaining}`);
  }
};
