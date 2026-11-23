import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const expected = new Map([
  ['impeccable-darwin-arm64', '2884e7eca3898ecf035287cd756c870106ba03bcaa9703e62d9cb25e06ac52b3'],
  ['impeccable-darwin-x64', '201559fbccbe4ca87b00b3c018a8acfe228e80008220c41f4c47b0939450773b'],
  ['impeccable-linux-x64', 'bf0524d3b44a199953d70ba10548ba48c5ab50d6ad260eeaa84ed8945c10a721'],
  ['impeccable-linux-arm64', '107112e1bf8067b3991eeb38ccafd2085278c8973f689d7feb2b94e879345387'],
  ['impeccable-windows-x64.exe', '2fd0b53e8d9554f3f028a258fd958d39bd712b3eb4f1725363966ca2380f8c3e'],
]);

test('optional internal Impeccable 0.1.28 pin has exact official release SHA-256 assets', () => {
  assert.equal(read('../internal/impeccable/scripts/VERSION').trim(), '0.1.28');
  const manifest = read('../internal/impeccable/scripts/engine-checksums.txt');
  const lines = manifest.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const seen = new Set();
  assert.equal(lines.length, expected.size, 'release manifest has only the five published assets');
  for (const line of lines) {
    const match = line.match(/^(\S+) (impeccable-[^\s]+) ([0-9a-f]{64})$/);
    assert.ok(match, 'malformed manifest line: ' + line);
    const [, version, name, digest] = match;
    assert.equal(version, '0.1.28', 'no 0.1.27 or older mixed-version assets');
    assert.ok(expected.has(name), 'unexpected release asset ' + name);
    assert.equal(digest, expected.get(name), 'official GitHub Release SHA-256 for ' + name);
    assert.equal(seen.has(name), false, 'duplicate release asset ' + name);
    seen.add(name);
  }
  assert.equal(seen.size, expected.size);
  assert.match(manifest, /stale upstream source manifest/);
});

test('Windows and POSIX launchers retain checksum and explicit opt-in boundaries', () => {
  const win = read('../internal/impeccable/scripts/impeccable.cmd');
  const sh = read('../internal/impeccable/scripts/impeccable');
  assert.match(win, /engine-checksums\.txt/);
  assert.match(win, /checksum mismatch/);
  assert.match(win, /:probe/);
  assert.match(sh, /engine-checksums\.txt/);
  assert.match(sh, /sha256|shasum/);
  assert.match(read('../UPSTREAM.md'), /single owner|sole.*owner/i);
});

test('upstream 0.1.28 provenance is explicitly distinguished from skill tag and stale source manifest', () => {
  const record = read('../internal/impeccable/UPSTREAM.md');
  assert.match(record, /80f576894c6157cd895f749565e8755f8406bce2/);
  assert.match(record, /skill-v4\.10\.0/);
  assert.match(record, /0\.1\.27/);
  assert.match(record, /stale.*manifest/i);
  assert.match(record, /0\.1\.28/);
  assert.match(record, /not.*(?:full|complete).*parity/i);
});
