import test from 'node:test';
import assert from 'node:assert/strict';

test('semantic vector codec round-trips little-endian Float32 and hashes passage text', async () => {
  const {
    decodeFloat32Vector,
    encodeFloat32Vector,
    hashEmbeddingText,
  } = await import('../../memory-engine/semantic-vectors.mjs');

  const vector = new Float32Array([0.25, -0.5, 1]);
  const blob = encodeFloat32Vector(vector);

  assert.ok(Buffer.isBuffer(blob));
  assert.deepEqual([...decodeFloat32Vector(blob, 3)], [...vector]);
  assert.equal(
    hashEmbeddingText('passage: hello'),
    'eead569eadac2fcb1eecc8b0cde37ec2ce764617516e70d0aa7a91de7e623f8a',
  );
});

test('semantic vector codec fails closed on invalid vectors and dimensions', async () => {
  const {
    decodeFloat32Vector,
    encodeFloat32Vector,
  } = await import('../../memory-engine/semantic-vectors.mjs');

  assert.throws(() => encodeFloat32Vector([1, 2]), /Float32Array/i);
  assert.throws(() => encodeFloat32Vector(new Float32Array()), /empty|length/i);
  assert.throws(
    () => encodeFloat32Vector(new Float32Array([1, Number.NaN])),
    /finite/i,
  );
  assert.throws(
    () => encodeFloat32Vector(new Float32Array([1, Number.POSITIVE_INFINITY])),
    /finite/i,
  );

  const blob = Buffer.alloc(12);
  assert.throws(() => decodeFloat32Vector(blob, 2), /dimension|length/i);
  assert.throws(() => decodeFloat32Vector(Buffer.alloc(5), 1), /byte|length/i);
});
