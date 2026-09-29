import { createHash } from 'node:crypto';

export function hashEmbeddingText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('embedding text must be a string');
  }
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function encodeFloat32Vector(vector) {
  if (!(vector instanceof Float32Array)) {
    throw new TypeError('vector must be a Float32Array');
  }
  if (vector.length === 0) {
    throw new RangeError('vector length must be greater than zero');
  }

  const blob = Buffer.allocUnsafe(vector.length * Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index];
    if (!Number.isFinite(value)) {
      throw new TypeError('vector values must be finite');
    }
    blob.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT);
  }
  return blob;
}

export function decodeFloat32Vector(blob, dimensions) {
  if (!Buffer.isBuffer(blob)) {
    throw new TypeError('vector blob must be a Buffer');
  }
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new RangeError('dimensions must be a positive integer');
  }

  const expectedBytes = dimensions * Float32Array.BYTES_PER_ELEMENT;
  if (blob.byteLength !== expectedBytes) {
    throw new RangeError(
      `vector byte length ${blob.byteLength} does not match dimensions ${dimensions}`,
    );
  }

  const vector = new Float32Array(dimensions);
  for (let index = 0; index < dimensions; index += 1) {
    const value = blob.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
    if (!Number.isFinite(value)) {
      throw new TypeError('vector blob contains a non-finite value');
    }
    vector[index] = value;
  }
  return vector;
}
