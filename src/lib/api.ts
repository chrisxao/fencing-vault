const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

export async function apiJson<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(apiUrl(path), {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`,
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
