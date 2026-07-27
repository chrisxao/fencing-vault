import { init } from '@instantdb/react';
import schema from '../../instant.schema';

export const appId = (import.meta.env.VITE_INSTANT_APP_ID as string | undefined)?.trim();

// This module is only imported from the lazily-loaded authed app, which App.tsx
// only renders when appId is present — the throw is just a safety net.
if (!appId) {
  throw new Error('Missing VITE_INSTANT_APP_ID');
}

export const db = init({ appId, schema });
