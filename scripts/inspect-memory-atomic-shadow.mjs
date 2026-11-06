#!/usr/bin/env node
/**
 * Local-only D12.3 research preview. Never opens the Memory database, edits
 * repository files, or calls any AI model. Default output contains no text.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  proposeAtomicCandidateShadows,
  summarizeAtomicCandidateShadows,
} from '../memory-engine/memory-atomic-candidate-shadow.mjs';

export function parseAtomicShadowArgs(argv = []) {
  const options = { inputFile: null, showLocalContent: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error('duplicate option');
    seen.add(flag);
    if (flag === '--show-local-content') {
      options.showLocalContent = true;
      continue;
    }
    if (flag !== '--input-file') throw new Error('unsupported option');
    const value = argv[++i];
    if (typeof value !== 'string' || !value.trim()) throw new Error('missing input file');
    options.inputFile = resolve(value);
  }
  if (options.inputFile === null) throw new Error('--input-file is required');
  return options;
}

export async function inspectAtomicShadowFile({
  inputFile,
  showLocalContent = false,
  readSource = readFile,
  sourceStat = stat,
} = {}) {
  if (typeof inputFile !== 'string' || !inputFile.trim()) {
    throw new Error('inputFile required');
  }
  const metadata = await sourceStat(inputFile);
  if (!metadata.isFile() || metadata.size > 60_000) throw new Error('source file not eligible');
  const source = await readSource(inputFile, 'utf8');
  const proposals = proposeAtomicCandidateShadows(source);
  return {
    modelInvocations: 0,
    memoryDatabaseAccessed: false,
    writesToRepository: false,
    ...summarizeAtomicCandidateShadows(proposals, {
      includeLocalText: showLocalContent,
    }),
  };
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entry === import.meta.url) {
  try {
    console.log(JSON.stringify(
      await inspectAtomicShadowFile(parseAtomicShadowArgs(process.argv.slice(2))),
      null,
      2,
    ));
  } catch {
    console.error('Atomic shadow inspection unavailable: check the local input and options.');
    process.exitCode = 1;
  }
}
