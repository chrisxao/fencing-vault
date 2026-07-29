import type { Express, Request, Response, NextFunction } from 'express';
import {
  requireAdmin,
  normalizeEmail,
  validatePassword,
  hashPassword,
  verifyPassword,
  id,
} from './auth.ts';

type AuthedRequest = Request & {
  instantUser?: { id: string; email: string | null; refresh_token?: string };
};

async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const admin = requireAdmin();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    const user = await admin.auth.verifyToken(token);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }
    req.instantUser = user as AuthedRequest['instantUser'];
    next();
  } catch (err) {
    console.error('auth verify failed', err);
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function registerAuthRoutes(app: Express) {
  app.post('/api/auth/signup', async (req, res) => {
    try {
      const admin = requireAdmin();
      const email = normalizeEmail(String(req.body?.email ?? ''));
      const password = String(req.body?.password ?? '');
      const name = String(req.body?.name ?? '').trim();
      const defaultWeapon = String(req.body?.defaultWeapon ?? '').trim() || undefined;

      if (!email || !email.includes('@')) {
        res.status(400).json({ error: 'A valid email is required' });
        return;
      }
      const pwError = validatePassword(password);
      if (pwError) {
        res.status(400).json({ error: pwError });
        return;
      }
      if (!name) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      const existing = await admin.query({
        credentials: { $: { where: { email } } },
      });
      if (existing.credentials.length > 0) {
        res.status(409).json({ error: 'An account with this email already exists' });
        return;
      }

      const passwordHash = await hashPassword(password);
      const token = await admin.auth.createToken(email);
      const user = await admin.auth.getUser({ email });
      if (!user) {
        res.status(500).json({ error: 'Failed to create user account' });
        return;
      }
      const now = Date.now();

      const txs: Parameters<typeof admin.transact>[0] = [
        admin.tx.credentials[id()]
          .update({ email, passwordHash, createdAt: now, updatedAt: now })
          .link({ $user: user.id }),
      ];

      // Fresh Instant users get a profile; existing magic-code users may already have one.
      const withProfile = await admin.query({
        $users: { $: { where: { id: user.id } }, profile: {} },
      });
      const existingProfile = withProfile.$users[0]?.profile;
      const profile = Array.isArray(existingProfile) ? existingProfile[0] : existingProfile;
      if (!profile) {
        txs.push(
          admin.tx.profiles[id()]
            .update({
              name,
              defaultWeapon,
              createdAt: now,
              updatedAt: now,
            })
            .link({ $user: user.id }),
        );
      } else {
        txs.push(
          admin.tx.profiles[profile.id].update({
            name,
            ...(defaultWeapon ? { defaultWeapon } : {}),
            updatedAt: now,
          }),
        );
      }

      await admin.transact(txs);
      res.json({ token });
    } catch (err) {
      console.error('signup failed', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Sign up failed',
      });
    }
  });

  app.post('/api/auth/signin', async (req, res) => {
    try {
      const admin = requireAdmin();
      const email = normalizeEmail(String(req.body?.email ?? ''));
      const password = String(req.body?.password ?? '');

      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required' });
        return;
      }

      const data = await admin.query({
        credentials: {
          $: { where: { email } },
          $user: {},
        },
      });
      const cred = data.credentials[0];
      if (!cred) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const ok = await verifyPassword(password, String(cred.passwordHash));
      if (!ok) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      const token = await admin.auth.createToken(email);
      res.json({ token });
    } catch (err) {
      console.error('signin failed', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Sign in failed',
      });
    }
  });

  app.post('/api/auth/change-password', requireUser, async (req: AuthedRequest, res) => {
    try {
      const admin = requireAdmin();
      const user = req.instantUser!;
      const currentPassword = String(req.body?.currentPassword ?? '');
      const newPassword = String(req.body?.newPassword ?? '');

      const pwError = validatePassword(newPassword);
      if (pwError) {
        res.status(400).json({ error: pwError });
        return;
      }

      const data = await admin.query({
        credentials: {
          $: { where: { '$user.id': user.id } },
        },
      });
      const cred = data.credentials[0];

      if (cred) {
        if (!currentPassword) {
          res.status(400).json({ error: 'Current password is required' });
          return;
        }
        const ok = await verifyPassword(currentPassword, String(cred.passwordHash));
        if (!ok) {
          res.status(401).json({ error: 'Current password is incorrect' });
          return;
        }
        const passwordHash = await hashPassword(newPassword);
        await admin.transact(
          admin.tx.credentials[cred.id].update({
            passwordHash,
            updatedAt: Date.now(),
          }),
        );
      } else {
        // Legacy magic-code account: first-time password setup.
        if (!user.email) {
          res.status(400).json({ error: 'Account has no email; cannot set a password' });
          return;
        }
        const passwordHash = await hashPassword(newPassword);
        const now = Date.now();
        await admin.transact(
          admin.tx.credentials[id()]
            .update({
              email: normalizeEmail(user.email),
              passwordHash,
              createdAt: now,
              updatedAt: now,
            })
            .link({ $user: user.id }),
        );
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('change-password failed', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not change password',
      });
    }
  });

  app.post('/api/auth/change-email', requireUser, async (req: AuthedRequest, res) => {
    try {
      const admin = requireAdmin();
      const user = req.instantUser!;
      const password = String(req.body?.password ?? '');
      const newEmail = normalizeEmail(String(req.body?.email ?? ''));

      if (!newEmail || !newEmail.includes('@')) {
        res.status(400).json({ error: 'A valid email is required' });
        return;
      }
      if (!password) {
        res.status(400).json({ error: 'Password is required to change email' });
        return;
      }

      const data = await admin.query({
        credentials: {
          $: { where: { '$user.id': user.id } },
        },
      });
      const cred = data.credentials[0];
      if (!cred) {
        res.status(400).json({
          error: 'Set a password in Settings before changing your email',
        });
        return;
      }

      const ok = await verifyPassword(password, String(cred.passwordHash));
      if (!ok) {
        res.status(401).json({ error: 'Password is incorrect' });
        return;
      }

      if (newEmail === cred.email) {
        res.json({ ok: true, token: null });
        return;
      }

      const clash = await admin.query({
        credentials: { $: { where: { email: newEmail } } },
      });
      if (clash.credentials.length > 0) {
        res.status(409).json({ error: 'That email is already in use' });
        return;
      }

      // Instant identities are email-keyed for createToken(email). Keep the
      // Instant user id stable: update credentials, then mint a token by id.
      await admin.transact(
        admin.tx.credentials[cred.id].update({
          email: newEmail,
          updatedAt: Date.now(),
        }),
      );

      try {
        await admin.transact(admin.tx.$users[user.id].update({ email: newEmail }));
      } catch (err) {
        // Some Instant deployments lock $users.email; credentials still update
        // so sign-in uses the new address via createToken({ id }).
        console.warn('could not update $users.email', err);
      }

      const token = await admin.auth.createToken({ id: user.id });
      res.json({ ok: true, token });
    } catch (err) {
      console.error('change-email failed', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not change email',
      });
    }
  });
}
