import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const dummyStorageEnv = {
  AWS_ENDPOINT_URL: 'https://storage-smoke.example.invalid',
  AWS_S3_BUCKET_NAME: 'fencing-vault-smoke-test',
  AWS_DEFAULT_REGION: 'auto',
  AWS_ACCESS_KEY_ID: 'smoke-test-access-key',
  AWS_SECRET_ACCESS_KEY: 'smoke-test-secret-key',
  S3_ENDPOINT: '',
  S3_BUCKET: '',
  S3_REGION: '',
  S3_ACCESS_KEY_ID: '',
  S3_SECRET_ACCESS_KEY: '',
  S3_FORCE_PATH_STYLE: 'false',
};

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

async function assertMissingStorageFailsFast() {
  const port = await availablePort();
  let output = '';
  const child = spawn(npmCommand, ['start'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      VITE_INSTANT_APP_ID: '00000000-0000-4000-8000-000000000000',
      INSTANT_APP_ADMIN_TOKEN: 'production-smoke-test-token',
      ...Object.fromEntries(Object.keys(dummyStorageEnv).map((name) => [name, ''])),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  let failFastTimer;
  let exitCode;
  try {
    exitCode = await Promise.race([
      once(child, 'exit').then(([code]) => code),
      new Promise((_, reject) => {
        failFastTimer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`Server did not fail fast without storage configuration.\n${output}`));
        }, 3_000);
      }),
    ]);
  } finally {
    clearTimeout(failFastTimer);
  }

  assert.notEqual(exitCode, 0);
  assert.match(output, /Missing required S3 configuration/);
  for (const name of [
    'AWS_ENDPOINT_URL',
    'AWS_S3_BUCKET_NAME',
    'AWS_DEFAULT_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
  ]) {
    assert.match(output, new RegExp(name));
  }
  console.log('PASS missing storage configuration fails fast');
}

await assertMissingStorageFailsFast();

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
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
    ...dummyStorageEnv,
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
  assert.deepEqual(await health.json(), { ok: true, storage: 's3' });
  console.log('PASS /api/health reports S3 storage');

  const presign = await fetch(`${baseUrl}/api/presign-upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: 'smoke-test.mp4', contentType: 'video/mp4' }),
  });
  assert.equal(presign.status, 200);
  assertContentType(presign, /application\/json/);
  const presignBody = await presign.json();
  assert.match(presignBody.key, /^[a-f0-9-]{36}__smoke-test\.mp4$/);
  assert.equal(presignBody.storage, 's3');
  assert.match(presignBody.uploadUrl, /^https:\/\/.+\.example\.invalid\//);
  console.log('PASS upload presign response matches web and mobile clients');

  const playback = await fetch(
    `${baseUrl}/api/playback-url?key=${encodeURIComponent(presignBody.key)}`,
  );
  assert.equal(playback.status, 200);
  assertContentType(playback, /application\/json/);
  assert.match((await playback.json()).url, /^https:\/\/.+\.example\.invalid\//);
  console.log('PASS playback presign uses isolated dummy storage');

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

  for (const route of ['/api/local-upload/test', '/api/files/test']) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: route.includes('upload') ? 'PUT' : 'GET',
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'API route not found');
  }
  console.log('PASS local upload and file routes are absent');

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
