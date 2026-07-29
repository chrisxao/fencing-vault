// Spawns Electron against the Vite dev server. Used by `npm run desktop:dev`.
// Runs from plain Node so require('electron') yields the binary path (not the API).
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const electronPath = require('electron');

const DEV_URL = process.env.ELECTRON_START_URL || 'http://localhost:5173';
const ROOT = path.join(__dirname, '..');

function waitForServer(url, attempts = 60) {
  return new Promise((resolve, reject) => {
    let left = attempts;
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (--left <= 0) {
          reject(new Error(`Timed out waiting for ${url}. Start it with: npm run dev:web`));
          return;
        }
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

async function main() {
  console.log(`[desktop] waiting for ${DEV_URL}…`);
  await waitForServer(DEV_URL);
  console.log('[desktop] launching Electron');

  const child = spawn(String(electronPath), ['.'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_START_URL: DEV_URL,
      // Ensure Electron runs as Electron, not as Node.
      ELECTRON_RUN_AS_NODE: '',
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
