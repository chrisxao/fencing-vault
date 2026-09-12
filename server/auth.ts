import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';

const COOKIE_NAME = 'sabre_studio_session';

function parseCookies(value = '') {
  return Object.fromEntries(
    value
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index < 0
          ? [part, '']
          : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function secret() {
  return config.sessionSecret || 'development-only-sabre-studio-session-secret';
}

function signature(payload: string) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function issueSession() {
  const expiresAt = Date.now() + config.sessionHours * 60 * 60 * 1_000;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ expiresAt, nonce })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

function verifySession(token?: string) {
  if (!token) return false;
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return false;
  const expected = signature(payload);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { expiresAt?: number };
    return typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function passwordMatches(value: string) {
  const actual = Buffer.from(value);
  const expected = Buffer.from(config.appPassword);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function authEnabled() {
  return Boolean(config.appPassword);
}

export function isAuthenticated(req: Request) {
  if (!authEnabled()) return true;
  return verifySession(parseCookies(req.headers.cookie)[COOKIE_NAME]);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    return;
  }
  next();
}

export function getSession(_req: Request, res: Response) {
  res.json({ enabled: authEnabled(), authenticated: isAuthenticated(_req) });
}

export function login(req: Request, res: Response) {
  if (!authEnabled()) {
    res.json({ authenticated: true });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!passwordMatches(password)) {
    res.status(401).json({ error: 'Incorrect password', code: 'INVALID_PASSWORD' });
    return;
  }
  const token = issueSession();
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.round(config.sessionHours * 3600)}${secure}`,
  );
  res.json({ authenticated: true });
}

export function logout(_req: Request, res: Response) {
  const secure = config.nodeEnv === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
  res.json({ authenticated: false });
}
