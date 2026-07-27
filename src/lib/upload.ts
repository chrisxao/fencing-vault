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
  const res = await fetch('/api/presign-upload', {
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

/** Resolves a storage key to a playable URL (presigned GET or local file route). */
export async function getPlaybackUrl(key: string): Promise<string> {
  const res = await fetch(`/api/playback-url?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error('Failed to get playback URL');
  const { url } = await res.json();
  return url;
}
