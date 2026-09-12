import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chromium } from 'playwright-core';
import { defaultStorageStatePath, findBrowserExecutable } from '../server/capture/fencingtv-browser.ts';

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? '';
}

async function main() {
  const outputPath = path.resolve(option('output') || defaultStorageStatePath());
  const browser = await chromium.launch({ executablePath: await findBrowserExecutable(), headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const prompt = createInterface({ input, output });
  try {
    await page.goto('https://fencingtv.com/auth/login', { waitUntil: 'domcontentloaded' });
    console.log('Log in to FencingTV in the opened browser window. Credentials stay in that browser and are not read by Sabre Studio.');
    await prompt.question('After a FencingTV page loads as your signed-in account, press Enter here to save the session… ');
    if (new URL(page.url()).pathname.startsWith('/auth/login')) {
      throw new Error('FencingTV still shows the login page; complete login before saving the session');
    }
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await context.storageState({ path: outputPath, indexedDB: true });
    await fs.chmod(outputPath, 0o600).catch(() => undefined);
    console.log(`Saved authenticated session to ${outputPath}`);
    console.log('Treat this file like a password. It is ignored by Git when stored in the recommended location.');
  } finally {
    prompt.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
