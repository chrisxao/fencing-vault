import 'dotenv/config';
import http from 'node:http';

const role = process.env.SERVICE_ROLE?.trim() || 'api';

if (role === 'api') {
  await import('./index.ts');
} else {
  const port = Number(process.env.PORT ?? 8787);
  const healthServer = http.createServer((request, response) => {
    if (request.url === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, role }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  healthServer.listen(port, '0.0.0.0', () => {
    console.log(`[${role}] health server listening on ${port}`);
  });

  if (role === 'media-worker') {
    await import('./media-worker.ts');
  } else if (role === 'vlm-worker') {
    await import('./vlm-worker.ts');
  } else if (role === 'cleanup-worker') {
    await import('./cleanup-worker.ts');
  } else {
    healthServer.close();
    throw new Error(`Unknown SERVICE_ROLE "${role}"`);
  }
}
