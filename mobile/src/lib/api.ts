import { File, UploadType } from 'expo-file-system';
import type { DocumentPickerAsset } from 'expo-document-picker';
import { apiBaseUrl } from './db';

function apiUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${apiBaseUrl}${normalized}`;
}

async function apiJson<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  if (!apiBaseUrl) {
    throw new Error('Set EXPO_PUBLIC_API_URL to a reachable API origin.');
  }
  const { token, headers, ...request } = init;
  const response = await fetch(apiUrl(path), {
    ...request,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof body?.error === 'string' ? body.error : `Request failed (${response.status})`,
    );
  }
  return body as T;
}

export type AnalysisReviewResult =
  | 'scored'
  | 'received'
  | 'double'
  | 'simultaneous'
  | 'no-touch';

export type CandidateReviewInput =
  | {
      action: 'accept';
      result: AnalysisReviewResult;
      notes?: string;
      comment?: string;
    }
  | {
      action: 'correct';
      startTime: number;
      endTime: number;
      timestamp: number;
      result: AnalysisReviewResult;
      notes?: string;
      comment?: string;
    }
  | {
      action: 'reject';
      notes?: string;
      comment?: string;
    };

export type AnalysisJobStatus =
  | 'queued'
  | 'processing'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StartAnalysisResponse =
  | { jobId: string; idempotent: false }
  | {
      job: {
        id: string;
        status: AnalysisJobStatus | string;
        runId?: string;
      };
      idempotent: true;
    };

export function signIn(input: { email: string; password: string }) {
  return apiJson<{ token: string }>('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function signUp(input: {
  email: string;
  password: string;
  name: string;
  defaultWeapon: string;
}) {
  return apiJson<{ token: string }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function changePassword(
  token: string,
  input: { currentPassword?: string; newPassword: string },
) {
  return apiJson<{ ok: true }>('/api/auth/change-password', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}

export function changeEmail(token: string, input: { email: string; password: string }) {
  return apiJson<{ ok: true; token: string | null }>('/api/auth/change-email', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}

export async function uploadVideo(
  asset: DocumentPickerAsset,
  videoId: string,
  token: string,
  onProgress: (fraction: number) => void,
) {
  const contentType = asset.mimeType || 'video/mp4';
  const file = new File(asset.uri);
  const contentLength = asset.size ?? file.size;
  if (!contentLength) throw new Error('Could not determine the video file size.');
  const presign = await apiJson<{
    key: string;
    uploadUrl: string;
    storage: 's3';
  }>('/api/presign-upload', {
    method: 'POST',
    token,
    body: JSON.stringify({ videoId, fileName: asset.name, contentType, contentLength }),
  });

  const task = file.createUploadTask(presign.uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: contentType,
    headers: { 'Content-Type': contentType },
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0) onProgress(bytesSent / totalBytes);
    },
  });
  const result = await task.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Upload failed (HTTP ${result.status})`);
  }
  onProgress(1);
  await apiJson('/api/uploads/complete', {
    method: 'POST',
    token,
    body: JSON.stringify({ key: presign.key, contentType, contentLength }),
  });
  return { key: presign.key };
}

export async function getPlaybackUrl(key: string, token: string) {
  const response = await apiJson<{ url: string }>(
    `/api/playback-url?key=${encodeURIComponent(key)}`,
    { token },
  );
  return response.url;
}

export async function deleteVideo(videoId: string, token: string) {
  await apiJson(`/api/videos/${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
    token,
  });
}

export function startVideoAnalysis(videoId: string, token: string) {
  return apiJson<StartAnalysisResponse>('/api/analysis/start', {
    method: 'POST',
    token,
    body: JSON.stringify({ videoId }),
  });
}

export function retryVideoAnalysis(jobId: string, token: string) {
  return apiJson<{ jobId: string }>(`/api/analysis/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    token,
  });
}

export function cancelVideoAnalysis(jobId: string, token: string) {
  return apiJson<{ jobId: string; status: string }>(
    `/api/analysis/${encodeURIComponent(jobId)}/cancel`,
    {
      method: 'POST',
      token,
    },
  );
}

export function reviewAnalysisCandidate(
  candidateId: string,
  input: CandidateReviewInput,
  token: string,
) {
  return apiJson<{
    review: {
      candidateId: string;
      segmentId: string | null;
      feedbackId: string;
      reviewState: 'accepted' | 'corrected' | 'rejected';
    };
  }>(`/api/analysis/candidates/${encodeURIComponent(candidateId)}/review`, {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  });
}
