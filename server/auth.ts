import { init, id } from '@instantdb/admin';
import bcrypt from 'bcryptjs';
import schema from '../instant.schema.ts';

const APP_ID = process.env.VITE_INSTANT_APP_ID ?? process.env.INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_APP_ADMIN_TOKEN;

if (!APP_ID || !ADMIN_TOKEN) {
  console.warn(
    '[auth] Missing VITE_INSTANT_APP_ID or INSTANT_APP_ADMIN_TOKEN — password auth endpoints will fail.',
  );
}

export const adminDb =
  APP_ID && ADMIN_TOKEN
    ? init({ appId: APP_ID, adminToken: ADMIN_TOKEN, schema })
    : null;

const MIN_PASSWORD = 8;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `Password must be at least ${MIN_PASSWORD} characters`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function requireAdmin() {
  if (!adminDb) {
    throw new Error('Password auth is not configured (missing Instant admin credentials)');
  }
  return adminDb;
}

export { id };
