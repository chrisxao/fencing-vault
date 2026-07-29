import { apiJson } from './api';

export function signup(input: {
  email: string;
  password: string;
  name: string;
  defaultWeapon?: string;
}) {
  return apiJson<{ token: string }>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function signin(input: { email: string; password: string }) {
  return apiJson<{ token: string }>('/api/auth/signin', {
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
