import { RULE_SOURCES } from '../shared/rules.ts';

let failed = false;
for (const source of RULE_SOURCES) {
  try {
    let response = await fetch(source.url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    if (response.status === 405) response = await fetch(source.url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    console.log(`OK  ${source.authority.padEnd(11)} ${source.edition.padEnd(20)} ${source.url}`);
  } catch (error) {
    failed = true;
    console.error(`ERR ${source.authority.padEnd(11)} ${source.edition.padEnd(20)} ${error instanceof Error ? error.message : error}`);
  }
}
if (failed) process.exitCode = 1;
