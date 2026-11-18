import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkReferenceCapture } from '../scripts/reference-capture-check.mjs';
import { compareOriginality } from '../scripts/reference-originality.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const captureCli = path.join(root, 'scripts/reference-capture-check.mjs');
const originalityCli = path.join(root, 'scripts/reference-originality.mjs');

function withDir(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dwa-reference-evidence-'));
  try { return fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

function png(file, width, height) {
  // A bounded PNG-header fixture: sufficient for a metadata-only checker.
  const b = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  writeFileSync(file, b);
}

function baseManifest() {
  return {
    schemaVersion: 1,
    sourceUrl: 'https://example.org/long-reference',
    capturedAt: '2026-11-18T19:00:00Z',
    viewport: { width: 400, height: 400 },
    documentHeight: 1000,
    segments: [
      { file: 'a.png', top: 0, bottom: 400, settled: true },
      { file: 'b.png', top: 300, bottom: 700, settled: true },
      { file: 'c.png', top: 600, bottom: 1000, settled: true },
    ],
    stitchedFile: 'composite.png',
  };
}

test('capture checker accepts full overlapping coverage but never claims visual verification', () => {
  withDir(dir => {
    for (const name of ['a', 'b', 'c']) png(path.join(dir, name + '.png'), 400, 400);
    png(path.join(dir, 'composite.png'), 400, 1000);
    const m = baseManifest();
    const result = checkReferenceCapture(m, dir);
    assert.equal(result.status, 'GEOMETRY_CHECKED');
    assert.equal(result.composite, 'GEOMETRY_CHECKED');
    assert.deepEqual(result.errors, []);
    assert.ok(result.limitations.some(x => x.includes('pixels')));
    const f = path.join(dir, 'manifest.json');
    writeFileSync(f, JSON.stringify(m));
    const cli = spawnSync(process.execPath, [captureCli, '--manifest', f, '--json'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).segments, 3);
  });
});

test('capture checker rejects gaps, missing bottom, missing settled states and wrong screenshot dimensions', () => {
  withDir(dir => {
    for (const name of ['a', 'b', 'c']) png(path.join(dir, name + '.png'), 400, 400);
    png(path.join(dir, 'composite.png'), 400, 1000);
    const m = baseManifest();
    m.segments[1].top = 500;
    m.segments[1].bottom = 900;
    assert.equal(checkReferenceCapture(m, dir).status, 'BLOCKED');
    m.segments = m.segments.slice(0, 2);
    assert.equal(checkReferenceCapture(m, dir).status, 'BLOCKED');
    m.segments = baseManifest().segments;
    m.segments[2].settled = false;
    assert.equal(checkReferenceCapture(m, dir).status, 'BLOCKED');
    m.segments[2].settled = true;
    png(path.join(dir, 'c.png'), 401, 400);
    assert.equal(checkReferenceCapture(m, dir).status, 'BLOCKED');
  });
});

test('capture checker rejects traversal, symlinked captures and malformed binary headers', () => {
  withDir(dir => {
    for (const name of ['a', 'b', 'c']) png(path.join(dir, name + '.png'), 400, 400);
    const m = baseManifest();
    delete m.stitchedFile;
    m.segments[0].file = '../outside.png';
    assert.equal(checkReferenceCapture(m, dir).status, 'BLOCKED');
    m.segments[0].file = 'link.png';
    try {
      symlinkSync(path.join(dir, 'b.png'), path.join(dir, 'link.png'));
      assert.equal(checkReferenceCapture(m, dir).status, 'BLOCKED');
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
    }
    m.segments[0].file = 'a.png';
    writeFileSync(path.join(dir, 'a.png'), Buffer.from('bad header'));
    assert.equal(checkReferenceCapture(m, dir).status, 'BLOCKED');
  });
});

test('originality check preserves exact asset and long-copy matches as review leads', () => {
  withDir(dir => {
    const candidate = path.join(dir, 'candidate');
    const reference = path.join(dir, 'reference');
    mkdirSync(candidate);
    mkdirSync(reference);
    const paragraph = 'This specific experience follows the customer through each step of the complete workflow, including receiving a unique confirmation, understanding the next action, and reviewing details without switching context or losing the original record.';
    writeFileSync(path.join(reference, 'logo.svg'), '<svg viewBox="0 0 2 2"><path d="M0 0"/></svg>');
    writeFileSync(path.join(candidate, 'brand.svg'), readFileSync(path.join(reference, 'logo.svg')));
    writeFileSync(path.join(reference, 'source.html'), '<article><p>' + paragraph + '</p></article>');
    writeFileSync(path.join(candidate, 'result.html'), '<main><p>' + paragraph + '</p></main>');
    const a = readFileSync(path.join(candidate, 'result.html'));
    const cli = spawnSync(process.execPath, [
      originalityCli, '--candidate', candidate, '--reference', reference, '--json',
    ], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const result = JSON.parse(cli.stdout);
    assert.equal(result.status, 'REVIEW_REQUIRED');
    assert.ok(result.signals.some(s => s.type === 'EXACT_BYTES' &&
      s.candidate === 'brand.svg' && s.reference.file === 'logo.svg'));
    assert.ok(result.signals.some(s => s.type === 'EXACT_LONG_TEXT_BLOCK' &&
      s.candidate === 'result.html' && s.reference.file === 'source.html'));
    assert.deepEqual(readFileSync(path.join(candidate, 'result.html')), a);
    assert.ok(result.notChecked.includes('Motion or interaction similarity'));
  });
});

test('no exact evidence never becomes a legal originality clearance', () => {
  const report = compareOriginality(
    [{ relative: 'a.txt', sha256: 'A', textDigests: [], bytes: 20 }],
    [{ name: 'reference-1', files: [{ relative: 'b.txt', sha256: 'B', textDigests: [], bytes: 21 }] }],
  );
  assert.equal(report.status, 'NO_EXACT_OVERLAPS_DETECTED');
  assert.match(report.interpretation, /not infringement/);
  assert.ok(report.notChecked.includes('Visual similarity and derivative imagery'));
});

test('originality check rejects missing, empty, oversized and symlinked scopes', () => {
  withDir(dir => {
    const candidate = path.join(dir, 'candidate');
    const reference = path.join(dir, 'reference');
    mkdirSync(candidate);
    mkdirSync(reference);
    writeFileSync(path.join(reference, 'r.txt'), 'some reference');
    const execute = () => spawnSync(process.execPath, [
      originalityCli, '--candidate', candidate, '--reference', reference,
    ], { encoding: 'utf8' });
    assert.equal(execute().status, 2);
    writeFileSync(path.join(candidate, 'big.txt'), Buffer.alloc(4 * 1024 * 1024 + 1));
    assert.equal(execute().status, 2);
    rmSync(path.join(candidate, 'big.txt'));
    writeFileSync(path.join(candidate, 'valid.txt'), 'small');
    const symlink = path.join(dir, 'link');
    try {
      symlinkSync(candidate, symlink);
      const cli = spawnSync(process.execPath, [
        originalityCli, '--candidate', symlink, '--reference', reference,
      ], { encoding: 'utf8' });
      assert.equal(cli.status, 2);
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
    }
    assert.equal(execute().status, 0);
  });
});
