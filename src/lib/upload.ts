// In development the web app reaches the API through Vite's "/api" proxy.
// A deployed web build can point VITE_API_URL at the upload server.
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

interface PresignResponse {
  key: string;
  uploadUrl: string;
  storage: 's3';
}

/** Uploads a video file via a presigned S3-compatible PUT URL and returns its storage key. */
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
    xhr.open('PUT', uploadUrl);
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

/** Resolves a storage key to a presigned S3-compatible playback URL. */
export async function getPlaybackUrl(key: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/playback-url?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('Failed to get playback URL');
  const { url } = await res.json();
  return url;
}
