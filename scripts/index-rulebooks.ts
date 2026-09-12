import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { RULE_SOURCES } from '../shared/rules.ts';
import { config } from '../server/config.ts';
import { createPool, runMigrations } from '../server/migrate.ts';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = path.join(root, 'data', 'rules');

interface IndexedPassage {
  id: string;
  sourceId: string;
  refs: string[];
  title: string;
  summary: string;
  evidence: string[];
  tags: string[];
}

function chunks(value: string, max = 2_200) {
  const paragraphs = value.split(/\n\s*\n/).map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const output: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > max) { output.push(current); current = ''; }
    if (paragraph.length > max) {
      for (let offset = 0; offset < paragraph.length; offset += max - 200) output.push(paragraph.slice(offset, offset + max));
    } else current += `${current ? ' ' : ''}${paragraph}`;
  }
  if (current) output.push(current);
  return output;
}

function parseRules(sourceId: string, text: string): IndexedPassage[] {
  const marker = /^\s*((?:t|m|o)\.\d+(?:\.\d+)*)\s+(.*)$/gim;
  const matches = [...text.matchAll(marker)];
  const passages: IndexedPassage[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const ref = match[1].toLowerCase();
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    const section = text.slice(start, end).replace(/\f/g, '\n').trim();
    for (const [chunkIndex, summary] of chunks(section).entries()) {
      if (summary.length < 30) continue;
      const suffix = chunkIndex ? `-${chunkIndex + 1}` : '';
      passages.push({
        id: `full-${sourceId}-${ref.replaceAll('.', '-')}${suffix}`,
        sourceId,
        refs: [ref],
        title: `${ref}${match[2] ? ` — ${match[2].trim().slice(0, 120)}` : ''}`,
        summary,
        evidence: ['Full official rulebook passage; verify visible bout evidence before applying'],
        tags: ['full-corpus', ref.split('.')[0]],
      });
    }
  }
  return passages;
}

async function download(url: string, destination: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  const selected = process.argv.find((value) => value.startsWith('--source='))?.split('=')[1] ?? 'all';
  const sources = RULE_SOURCES.filter((source) => source.url.toLowerCase().endsWith('.pdf') && (selected === 'all' || source.id === selected || source.authority.toLowerCase().startsWith(selected.toLowerCase())));
  if (!sources.length) throw new Error(`No PDF rule source matches --source=${selected}`);
  const all: IndexedPassage[] = [];
  const manifest: Array<{ sourceId: string; url: string; sha256: string; passageCount: number; indexedAt: string }> = [];
  for (const source of sources) {
    const pdf = path.join(dataDir, `${source.id}.pdf`);
    const textFile = path.join(dataDir, `${source.id}.txt`);
    console.log(`Downloading ${source.authority} ${source.edition}…`);
    await download(source.url, pdf);
    try {
      await execFileAsync('pdftotext', ['-layout', pdf, textFile]);
    } catch (error) {
      throw new Error(`pdftotext is required to index rulebooks (${error instanceof Error ? error.message : error})`);
    }
    const [pdfBytes, text] = await Promise.all([fs.readFile(pdf), fs.readFile(textFile, 'utf8')]);
    const passages = parseRules(source.id, text);
    all.push(...passages);
    manifest.push({ sourceId: source.id, url: source.url, sha256: crypto.createHash('sha256').update(pdfBytes).digest('hex'), passageCount: passages.length, indexedAt: new Date().toISOString() });
    console.log(`Indexed ${passages.length} passages from ${source.id}.`);
  }
  await fs.writeFile(path.join(dataDir, 'index.json'), JSON.stringify({ manifest, passages: all }, null, 2));
  if (config.databaseUrl) {
    const pool = createPool();
    try {
      await runMigrations(pool);
      for (const source of sources) {
        const sourceManifest = manifest.find((item) => item.sourceId === source.id);
        await pool.query(`INSERT INTO rule_sources (id,authority,title,edition,published_at,url,checksum,checked_at,metadata)
          VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8)
          ON CONFLICT (id) DO UPDATE SET authority=EXCLUDED.authority,title=EXCLUDED.title,edition=EXCLUDED.edition,
            published_at=EXCLUDED.published_at,url=EXCLUDED.url,checksum=EXCLUDED.checksum,checked_at=EXCLUDED.checked_at,
            metadata=EXCLUDED.metadata`,
        [source.id, source.authority, source.title, source.edition, source.publishedAt, source.url,
          sourceManifest?.sha256 ?? null, JSON.stringify({ scope: source.scope, passageCount: sourceManifest?.passageCount ?? 0 })]);
      }
      for (const passage of all) {
        await pool.query(`INSERT INTO rule_passages (id,source_id,refs,title,summary,evidence,tags)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (id) DO UPDATE SET refs=EXCLUDED.refs,title=EXCLUDED.title,summary=EXCLUDED.summary,evidence=EXCLUDED.evidence,tags=EXCLUDED.tags`,
        [passage.id, passage.sourceId, passage.refs, passage.title, passage.summary, JSON.stringify(passage.evidence), passage.tags]);
      }
      console.log(`Stored ${all.length} full-corpus passages in PostgreSQL.`);
    } finally { await pool.end(); }
  } else console.log('DATABASE_URL is not set; wrote the local corpus index only.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
