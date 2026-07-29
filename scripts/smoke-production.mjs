import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const { port } = address;
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

async function waitUntilReady(baseUrl, child, output) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited early (${child.exitCode}).\n${output()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for production server.\n${output()}`);
}

function assertContentType(response, expected) {
  assert.match(response.headers.get('content-type') ?? '', expected);
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let output = '';
const child = spawn(npmCommand, ['start'], {
  cwd: projectRoot,
  detached: process.platform !== 'win32',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    VITE_INSTANT_APP_ID: '00000000-0000-4000-8000-000000000000',
    INSTANT_APP_ADMIN_TOKEN: 'production-smoke-test-token',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => {
  output += chunk;
});
child.stderr.on('data', (chunk) => {
  output += chunk;
});

try {
  await waitUntilReady(baseUrl, child, () => output);

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assertContentType(health, /application\/json/);
  assert.equal((await health.json()).ok, true);
  console.log('PASS /api/health returns JSON 200');

  for (const route of ['/', '/settings']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200);
    assertContentType(response, /text\/html/);
    assert.match(await response.text(), /<div id="root">/);
    console.log(`PASS ${route} returns the Vite HTML`);
  }

  const missingApi = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(missingApi.status, 404);
  assertContentType(missingApi, /application\/json/);
  assert.equal((await missingApi.json()).error, 'API route not found');
  console.log('PASS unknown /api route returns JSON 404');

  const signin = await fetch(`${baseUrl}/api/auth/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(signin.status, 400);
  assertContentType(signin, /application\/json/);
  assert.equal((await signin.json()).error, 'Email and password are required');
  console.log('PASS invalid signin reaches Express and returns JSON 400');
} finally {
  const killServer = (signal) => {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };

  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    killServer('SIGTERM');
    let killTimer;
    try {
      await Promise.race([
        exited,
        new Promise((resolve) => {
          killTimer = setTimeout(() => {
            killServer('SIGKILL');
            resolve();
          }, 2_000);
        }),
      ]);
    } finally {
      clearTimeout(killTimer);
    }
  }
}
