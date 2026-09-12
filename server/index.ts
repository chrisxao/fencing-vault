import { PoseManager, poseAvailable, demoVideo, withDemoVideo } from './pose/manager.ts';
import { trackingInputSchema } from '../shared/tracking.ts';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import {
  actionDefinitionSchema,
  createBoutSchema,
  createFencerSchema,
  createTeamSchema,
  phraseEventInputSchema,
  phraseInputSchema,
  poseKeyframeInputSchema,
} from '../shared/domain.ts';
import { fencingTvImportSchema } from '../shared/fencingtv.ts';
import { RULESET_ID, RULE_SOURCES } from '../shared/rules.ts';
import { login, logout, getSession, requireAuth } from './auth.ts';
import { config, validateProductionConfig } from './config.ts';
import { createRepository } from './repository.ts';
import { discoverFencingTv } from './fencingtv-discovery.ts';
import { presignPlayback, presignVideoUpload, storageConfigured } from './storage.ts';

validateProductionConfig();

const app = express();
const repository = createRepository();
const poseManager = new PoseManager(repository);
const idSchema = z.string().uuid();
const actionInputSchema = actionDefinitionSchema.omit({ id: true, system: true }).extend({
  key: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use a lowercase kebab-case key'),
});
const mediaInputSchema = z.object({
  kind: z.enum(['uploaded', 'external', 'screen-recording']),
  objectKey: z.string().min(1).nullable(),
  externalUrl: z.string().url().nullable(),
  filename: z.string().max(240),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive().nullable(),
  durationMs: z.number().int().positive().nullable().optional(),
  fps: z.number().positive().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  status: z.enum(['pending', 'ready', 'failed']).optional(),
});

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const asyncRoute = (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.corsAllowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', config.corsAllowedOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'sabre-studio', mode: repository.demoMode ? 'demo' : 'postgres', rulesetId: RULESET_ID });
});
app.get('/api/auth/session', getSession);
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);

app.use('/api', requireAuth);

app.get('/api/config', (_req, res) => {
  res.json({
    poseTrackingAvailable: poseAvailable(),
    demoMode: repository.demoMode,
    storageConfigured: storageConfigured(),
    fencingTvDiscoveryEnabled: config.fencingTvDiscoveryEnabled,
    fencingTvCaptureEnabled: config.fencingTvCaptureEnabled,
    maxUploadBytes: config.maxUploadBytes,
    rulesetId: RULESET_ID,
  });
});

app.get('/api/dashboard', asyncRoute(async (_req, res) => {
  res.json(await repository.dashboard());
}));

app.get('/api/bouts/:id', asyncRoute(async (req, res) => {
  const bout = await repository.getBout(idSchema.parse(req.params.id));
  if (!bout) { res.status(404).json({ error: 'Bout not found', code: 'NOT_FOUND' }); return; }
  if (bout.media?.objectKey && storageConfigured()) {
    bout.media.playbackUrl = await presignPlayback(bout.media.objectKey);
  } else if (bout.media) {
    bout.media.playbackUrl = bout.media.externalUrl;
  }
  res.json(await withDemoVideo(bout, repository.demoMode));
}));

app.get('/api/pose-demo/video', (_req, res) => {
  if (!repository.demoMode || !demoVideo) { res.sendStatus(404); return; }
  res.sendFile(demoVideo, { dotfiles: 'allow' });
});
app.get('/api/bouts/:id/tracking', asyncRoute(async (req, res) => {
  res.json(await repository.listTrackingRuns(idSchema.parse(req.params.id)));
}));
app.post('/api/bouts/:id/tracking', asyncRoute(async (req, res) => {
  const bout = await repository.getBout(idSchema.parse(req.params.id));
  if (!bout) { res.sendStatus(404); return; }
  res.status(202).json(await poseManager.start(await withDemoVideo(bout, repository.demoMode), trackingInputSchema.parse(req.body)));
}));
app.get('/api/tracking/:id', asyncRoute(async (req, res) => {
  const run = await poseManager.get(idSchema.parse(req.params.id));
  if (!run) { res.sendStatus(404); return; }
  res.json(run);
}));
app.post('/api/tracking/:id/cancel', asyncRoute(async (req, res) => {
  const run = await poseManager.cancel(idSchema.parse(req.params.id));
  if (!run) { res.sendStatus(404); return; }
  res.json(run);
}));

app.get('/api/bouts/:id/ingestion', asyncRoute(async (req, res) => {
  res.json(await repository.getIngestionJob(idSchema.parse(req.params.id)));
}));

app.post('/api/bouts', asyncRoute(async (req, res) => {
  res.status(201).json(await repository.createBout(createBoutSchema.parse(req.body)));
}));

app.post('/api/fencers', asyncRoute(async (req, res) => {
  res.status(201).json(await repository.createFencer(createFencerSchema.parse(req.body)));
}));

app.post('/api/teams', asyncRoute(async (req, res) => {
  res.status(201).json(await repository.createTeam(createTeamSchema.parse(req.body)));
}));

app.get('/api/fencers/:id/stats', asyncRoute(async (req, res) => {
  const stats = await repository.fencerStats(idSchema.parse(req.params.id));
  if (!stats) { res.status(404).json({ error: 'Fencer not found', code: 'NOT_FOUND' }); return; }
  res.json(stats);
}));

app.get('/api/teams/:id/stats', asyncRoute(async (req, res) => {
  const stats = await repository.teamStats(idSchema.parse(req.params.id));
  if (!stats) { res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' }); return; }
  res.json(stats);
}));

app.post('/api/teams/:id/members', asyncRoute(async (req, res) => {
  const input = z.object({ fencerId: z.string().uuid() }).parse(req.body);
  await repository.addTeamMember(idSchema.parse(req.params.id), input.fencerId);
  res.status(204).end();
}));

app.post('/api/actions', asyncRoute(async (req, res) => {
  res.status(201).json(await repository.createAction(actionInputSchema.parse(req.body)));
}));

app.patch('/api/actions/:id', asyncRoute(async (req, res) => {
  const input = actionInputSchema.partial().parse(req.body);
  const action = await repository.updateAction(idSchema.parse(req.params.id), input);
  if (!action) { res.status(404).json({ error: 'Action not found', code: 'NOT_FOUND' }); return; }
  res.json(action);
}));

app.post('/api/bouts/:id/phrases', asyncRoute(async (req, res) => {
  res.status(201).json(await repository.createPhrase(idSchema.parse(req.params.id), phraseInputSchema.parse(req.body)));
}));

app.put('/api/phrases/:id', asyncRoute(async (req, res) => {
  const phrase = await repository.updatePhrase(idSchema.parse(req.params.id), phraseInputSchema.parse(req.body));
  if (!phrase) { res.status(404).json({ error: 'Phrase not found', code: 'NOT_FOUND' }); return; }
  res.json(phrase);
}));

app.delete('/api/phrases/:id', asyncRoute(async (req, res) => {
  const deleted = await repository.deletePhrase(idSchema.parse(req.params.id));
  if (!deleted) { res.status(404).json({ error: 'Phrase not found', code: 'NOT_FOUND' }); return; }
  res.status(204).end();
}));

app.post('/api/phrases/:id/events', asyncRoute(async (req, res) => {
  res.status(201).json(await repository.createEvent(idSchema.parse(req.params.id), phraseEventInputSchema.parse(req.body)));
}));

app.put('/api/events/:id', asyncRoute(async (req, res) => {
  const event = await repository.updateEvent(idSchema.parse(req.params.id), phraseEventInputSchema.parse(req.body));
  if (!event) { res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' }); return; }
  res.json(event);
}));

app.delete('/api/events/:id', asyncRoute(async (req, res) => {
  const deleted = await repository.deleteEvent(idSchema.parse(req.params.id));
  if (!deleted) { res.status(404).json({ error: 'Event not found', code: 'NOT_FOUND' }); return; }
  res.status(204).end();
}));

app.put('/api/bouts/:id/poses', asyncRoute(async (req, res) => {
  const boutId = idSchema.parse(req.params.id), input = poseKeyframeInputSchema.parse(req.body);
  const stored = await repository.getBout(boutId);
  if (!stored) { res.sendStatus(404); return; }
  const bout = await withDemoVideo(stored, repository.demoMode);
  if (input.provenance && input.provenance.mediaId !== bout.media?.id) { res.status(409).json({ error: 'The source video changed. Reopen it before saving this correction.' }); return; }
  if (input.provenance?.runId) {
    const run = await repository.getTrackingRun(input.provenance.runId);
    if (!run || run.boutId !== boutId || run.mediaId !== bout.media?.id || run.state !== 'ready' || input.provenance.sourceSha256 !== run.result?.sourceSha256) { res.status(409).json({ error: 'This correction no longer matches its tracking source.' }); return; }
  }
  res.json(await repository.upsertPose(boutId, input));
}));

app.get('/api/rules', asyncRoute(async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const refs = typeof req.query.refs === 'string' ? req.query.refs.split(',').map((item) => item.trim()).filter(Boolean) : [];
  res.json(await repository.ruleContext(query, refs));
}));

app.get('/api/rule-sources', (_req, res) => res.json({ rulesetId: RULESET_ID, sources: RULE_SOURCES }));

app.post('/api/fencingtv/import', asyncRoute(async (req, res) => {
  const input = fencingTvImportSchema.parse(req.body);
  if (input.captureMode !== 'link-only' && input.captureMode !== 'screen-recording' && !config.fencingTvCaptureEnabled) {
    res.status(409).json({
      error: 'Authenticated capture is disabled. Use link-only or screen-recording, or enable the private capture worker.',
      code: 'CAPTURE_DISABLED',
    });
    return;
  }
  res.status(201).json(await repository.importFencingTv(input));
}));

app.get('/api/fencingtv/discover', asyncRoute(async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const kind = z.enum(['all', 'competition', 'video']).catch('all').parse(req.query.kind);
  res.json(await discoverFencingTv(query, kind));
}));

app.post('/api/bouts/:id/uploads/presign', asyncRoute(async (req, res) => {
  const boutId = idSchema.parse(req.params.id);
  const input = z.object({ filename: z.string().min(1).max(240), contentType: z.string().min(1), sizeBytes: z.number().int().positive() }).parse(req.body);
  if (!(await repository.getBout(boutId))) { res.status(404).json({ error: 'Bout not found', code: 'NOT_FOUND' }); return; }
  res.json(await presignVideoUpload({ boutId, ...input }));
}));

app.post('/api/bouts/:id/media', asyncRoute(async (req, res) => {
  res.json(await repository.attachMedia(idSchema.parse(req.params.id), mediaInputSchema.parse(req.body)));
}));

app.get('/api/datasets/export', asyncRoute(async (_req, res) => {
  const manifest = await repository.datasetManifest();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sabre-studio-dataset-${manifest.exportedAt.slice(0, 10)}.json"`);
  res.send(JSON.stringify(manifest, null, 2));
}));

const distPath = fileURLToPath(new URL('../dist', import.meta.url));
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, { index: false, maxAge: config.nodeEnv === 'production' ? '1h' : 0 }));
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) { next(); return; }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}`, code: 'NOT_FOUND' }));

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'Some fields need attention', code: 'VALIDATION_ERROR', details: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  const conflict = /already exists|duplicate key|unique constraint/i.test(message);
  console.error(error);
  const requestedStatus = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
  const status = [400, 404, 409, 413].includes(requestedStatus) ? requestedStatus : conflict ? 409 : 500;
  res.status(status).json({ error: message, code: status === 409 ? 'CONFLICT' : 'SERVER_ERROR' });
});

let server: ReturnType<typeof app.listen> | null = null;

async function start() {
  await repository.init();
  await new Promise<void>((resolve, reject) => {
    server = app.listen(config.port, '0.0.0.0', (error?: Error) => {
      if (error) { reject(error); return; }
      console.log(`Sabre Studio listening on http://localhost:${config.port} (${repository.demoMode ? 'demo' : 'PostgreSQL'} mode)`);
      resolve();
    });
  });
}

async function shutdown(signal: string) {
  console.log(`${signal}: closing Sabre Studio`);
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  await poseManager.close();
  await repository.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
