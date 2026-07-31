// In development the web app reaches the API through Vite's "/api" proxy.
// A deployed web build can point VITE_API_URL at the upload server.
import { apiJson } from './api';

interface PresignResponse {
  key: string;
  uploadUrl: string;
  storage: 's3';
}

/** Uploads a video file via a presigned S3-compatible PUT URL and returns its storage key. */
export async function uploadVideo(
  file: File,
  videoId: string,
  token: string,
  onProgress: (fraction: number) => void,
): Promise<{ key: string }> {
  const { key, uploadUrl } = await apiJson<PresignResponse>('/api/presign-upload', {
    method: 'POST',
    token,
    body: JSON.stringify({
      videoId,
      fileName: file.name,
      contentType: file.type || 'video/mp4',
      contentLength: file.size,
    }),
  });

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

  await apiJson('/api/uploads/complete', {
    method: 'POST',
    token,
    body: JSON.stringify({
      key,
      contentType: file.type || 'video/mp4',
      contentLength: file.size,
    }),
  });
  return { key };
}

/** Resolves a storage key to a presigned S3-compatible playback URL. */
export async function getPlaybackUrl(key: string, token: string): Promise<string> {
  const { url } = await apiJson<{ url: string }>(
    `/api/playback-url?key=${encodeURIComponent(key)}`,
    { token },
  );
  return url;
}

/** Deletes an owned video record and its source/derived objects. */
export async function deleteVideo(videoId: string, token: string): Promise<void> {
  await apiJson(`/api/videos/${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
    token,
  });
}
