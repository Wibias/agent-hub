#!/usr/bin/env node
/** D3 offline only: reads a bounded fake-judge fixture, prints aggregate telemetry. */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { replaySemanticRelationShadowFixture } from '../memory-engine/semantic-relation-shadow.mjs';

async function main(args) {
  if (args.length !== 2 || args[0] !== '--fixture') {
    throw new Error('Usage: node scripts/eval-semantic-relations.mjs --fixture PATH');
  }
  const file = resolve(args[1]);
  const size = statSync(file).size;
  if (size > 1024 * 1024) throw new Error('Fixture exceeds 1 MiB');
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  const report = await replaySemanticRelationShadowFixture({ fixture });
  // Print aggregate outcome and case IDs/status only. No raw claim text, evidence, or model output.
  console.log(JSON.stringify({ format: report.format, mode: report.mode,
    complete: report.complete, counts: report.counts, metrics: report.metrics,
    latency: report.latency, usage: report.usage,
    cases: report.cases.map(({ id, status, failureKind, truePositive, falsePositive, falseNegative }) => ({ id, status, failureKind, truePositive, falsePositive, falseNegative })),
  }, null, 2));
  if (!report.complete) process.exitCode = 1;
}

main(process.argv.slice(2)).catch(() => {
  console.error('Shadow fixture failed validation or could not be read. No graph or memory state was changed.');
  process.exitCode = 1;
});
