import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const expected = new Map([
  ['impeccable-darwin-arm64', '0d96cf802af6c52f3ed0925a409c7f4a1eda6a4c4b8274ff545b1d23e8dd6ae6'],
  ['impeccable-darwin-x64', 'af28d77242fc345f11ade5075c304beef2e938a3df70905a95f9864708ee0a2a'],
  ['impeccable-linux-x64', '01c642862b0e505277bb8810b1a74aacc42b2b38eb24bc69bc0bcf324089be77'],
  ['impeccable-linux-arm64', 'fd488471ae6df728e260bb54c26d0f7fa9235765777f8ee2ff28e9d3dba0dc6b'],
  ['impeccable-windows-x64.exe', 'f6606bbf6bd8993e2b0dab98261c27659a865e7dcbc775986d40e8808527ff47'],
]);

test('optional internal Impeccable 0.1.31 pin has exact official release SHA-256 assets', () => {
  assert.equal(read('../internal/impeccable/scripts/VERSION').trim(), '0.1.31');
  const manifest = read('../internal/impeccable/scripts/engine-checksums.txt');
  const lines = manifest.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const seen = new Set();
  assert.equal(lines.length, expected.size, 'release manifest has only the five published assets');
  for (const line of lines) {
    const match = line.match(/^(\S+) (impeccable-[^\s]+) ([0-9a-f]{64})$/);
    assert.ok(match, 'malformed manifest line: ' + line);
    const [, version, name, digest] = match;
    assert.equal(version, '0.1.31', 'no 0.1.27 or older mixed-version assets');
    assert.ok(expected.has(name), 'unexpected release asset ' + name);
    assert.equal(digest, expected.get(name), 'official GitHub Release SHA-256 for ' + name);
    assert.equal(seen.has(name), false, 'duplicate release asset ' + name);
    seen.add(name);
  }
  assert.equal(seen.size, expected.size);
  assert.match(manifest, /check-engine-release[.]mjs --record/);
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

test('engine 0.1.31 provenance identifies the stale engine-tag manifest and coherent skill-tag release', () => {
  const record = read('../internal/impeccable/UPSTREAM.md');
  assert.match(record, /ce0733287403d77e1017612ec0bc9f5a9251b52a/);
  assert.match(record, /skill-v4\.11\.1/);
  assert.match(record, /0\.1\.30/);
  assert.match(record, /stale[\s\S]*?manifest/i);
  assert.match(record, /0\.1\.28/);
  assert.match(record, /not[\s\S]{0,300}(?:full|complete)[\s\S]{0,200}parity/i);
});
