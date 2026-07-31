import type { NextFunction, Request, Response } from 'express';
import { requireAdmin } from './auth.ts';

export interface InstantUser {
  id: string;
  email: string | null;
  refresh_token?: string;
}

export type AuthedRequest = Request & {
  instantUser?: InstantUser;
};

export async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1]?.trim();
    if (!token) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const user = await requireAdmin().auth.verifyToken(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }
    req.instantUser = user as InstantUser;
    next();
  } catch (error) {
    console.error('auth verify failed', error);
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}
