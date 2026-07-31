import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { detectPhraseEnd } from '../server/analysis/openrouter.ts';
import { modelRegistry } from '../server/analysis/model-registry.ts';
import { DEFAULT_PROMPT_VERSION } from '../server/analysis/domain.ts';

const fixtureSchema = z.array(
  z.object({
    id: z.string(),
    videoUrl: z.string().url(),
    candidatePhraseEnd: z.boolean(),
  }),
);

const fixturePath = process.argv[2];
if (!fixturePath) {
  throw new Error('Usage: npm run analysis:bakeoff -- path/to/labeled-fixtures.json');
}
const fixtures = fixtureSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')));
const models = modelRegistry().filter((model) => model.enabled);

for (const model of models) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let latencyMs = 0;
  for (const fixture of fixtures) {
    const started = performance.now();
    const result = await detectPhraseEnd(fixture.videoUrl, {
      model: model.id,
      provider: model.provider ?? '',
      promptVersion: DEFAULT_PROMPT_VERSION,
    });
    latencyMs += performance.now() - started;
    const predicted = result.parsed.candidate_phrase_end;
    if (predicted && fixture.candidatePhraseEnd) tp += 1;
    if (predicted && !fixture.candidatePhraseEnd) fp += 1;
    if (!predicted && fixture.candidatePhraseEnd) fn += 1;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(Number.EPSILON, precision + recall);
  console.log(
    JSON.stringify({
      model: model.id,
      fixtures: fixtures.length,
      precision,
      recall,
      f1,
      averageLatencyMs: latencyMs / Math.max(1, fixtures.length),
    }),
  );
}
