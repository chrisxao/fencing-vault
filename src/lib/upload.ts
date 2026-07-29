// In the browser the API is reached via the Vite proxy at "/api". Packaged
// apps (Capacitor iOS/Android, Electron) have no proxy, so they must point
// VITE_API_URL at the deployed upload server, e.g. https://api.example.com
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

/** Prefixes server-relative URLs (local-disk fallback) with the API base. */
function absolute(url: string): string {
  return url.startsWith('/') ? `${API_BASE}${url}` : url;
}

interface PresignResponse {
  key: string;
  uploadUrl: string;
  storage: 's3' | 'local';
}

/**
 * Uploads a video file via a presigned PUT URL (Railway S3-compatible bucket,
 * or the local-disk dev fallback) and returns the storage key.
 */
export async function uploadVideo(
  file: File,
  onProgress: (fraction: number) => void,
): Promise<{ key: string }> {
  const res = await fetch(`${API_BASE}/api/presign-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType: file.type }),
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => null))?.error ?? 'Failed to get upload URL');
  }
  const { key, uploadUrl }: PresignResponse = await res.json();

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', absolute(uploadUrl));
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed (network error)'));
    xhr.send(file);
  });

  return { key };
}

/** Resolves a storage key to a playable URL (presigned GET or local file route). */
export async function getPlaybackUrl(key: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/playback-url?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('Failed to get playback URL');
  const { url } = await res.json();
  return absolute(url);
}
