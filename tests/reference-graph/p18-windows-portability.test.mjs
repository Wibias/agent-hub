import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Reference Graph frozen evidence is checked out with LF on every platform', () => {
  const attributes = readFileSync('.gitattributes', 'utf8');

  assert.match(
    attributes,
    /^reference-graph\/evidence\/\*\.json[ \t]+text[ \t]+eol=lf$/m,
  );
});