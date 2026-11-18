#!/usr/bin/env node
// A geometry/provenance check for settled, viewport-by-viewport reference captures.
// Browser automation belongs to skills/playwright; this helper never drives a browser.
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readArgs(args) {
  const value = { manifest: null, json: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manifest' && args[i + 1]) value.manifest = args[++i];
    else if (args[i] === '--json') value.json = true;
    else throw new Error('Usage: node reference-capture-check.mjs --manifest FILE [--json]');
  }
  if (!value.manifest) throw new Error('Missing --manifest');
  return value;
}

function pngDimensions(file) {
  const buf = readFileSync(file);
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature) ||
      buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Not a PNG with an IHDR header');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function safeImage(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error('Image path must be a relative file path');
  }
  const file = path.resolve(root, relative);
  if (file === root || !file.startsWith(root + path.sep)) {
    throw new Error('Image path escapes the capture directory');
  }
  const realRoot = realpathSync(root);
  const realFile = realpathSync(file);
  if (realFile === realRoot || !realFile.startsWith(realRoot + path.sep) ||
      !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) {
    throw new Error('Image must be a regular file inside the capture directory');
  }
  return file;
}

export function checkReferenceCapture(manifest, root, pngInfo = pngDimensions) {
  const errors = [];
  const fail = (msg) => errors.push(msg);
  if (manifest?.schemaVersion !== 1) fail('Unsupported manifest schema');
  if (typeof manifest?.sourceUrl !== 'string' ||
      !/^https?:\/\/\S+$/i.test(manifest.sourceUrl)) fail('Missing HTTP(S) source URL');
  if (!manifest?.capturedAt || !Number.isFinite(Date.parse(manifest.capturedAt))) {
    fail('Missing capture timestamp');
  }
  const { width, height } = manifest?.viewport ?? {};
  const documentHeight = manifest?.documentHeight;
  if (!Number.isInteger(width) || width < 1 ||
      !Number.isInteger(height) || height < 1 ||
      !Number.isInteger(documentHeight) || documentHeight < height ||
      documentHeight > 100000) {
    fail('Invalid viewport or document height');
  }
  const segments = manifest?.segments;
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 100) {
    fail('Expected 1..100 ordered viewport captures');
  } else if (Number.isInteger(width) && Number.isInteger(height) &&
             Number.isInteger(documentHeight) && documentHeight >= height) {
    let coveredThrough = 0;
    let lastTop = -1;
    for (const [index, segment] of segments.entries()) {
      const top = segment?.top;
      const bottom = segment?.bottom;
      if (!Number.isInteger(top) || !Number.isInteger(bottom) ||
          top < 0 || top <= lastTop || bottom !== Math.min(documentHeight, top + height) ||
          top > documentHeight - height || top > coveredThrough) {
        fail('Segment ' + index + ' has a gap, invalid scroll position, or wrong bounds');
      }
      if (segment?.settled !== true) fail('Segment ' + index + ' is not marked settled');
      if (typeof segment?.file !== 'string') {
        fail('Segment ' + index + ' has no file');
      } else {
        try {
          const image = pngInfo(safeImage(root, segment.file));
          if (image.width !== width || image.height !== height) {
            fail('Segment ' + index + ' screenshot dimensions do not match viewport');
          }
        } catch (error) {
          fail('Segment ' + index + ': ' + error.message);
        }
      }
      if (Number.isInteger(top) && Number.isInteger(bottom)) {
        coveredThrough = Math.max(coveredThrough, bottom);
        lastTop = top;
      }
    }
    if (segments[0]?.top !== 0 || coveredThrough !== documentHeight) {
      fail('Viewport sequence does not cover the page from top to bottom');
    }
  }

  let composite = 'NOT_PROVIDED';
  if (manifest?.stitchedFile !== undefined) {
    try {
      const img = pngInfo(safeImage(root, manifest.stitchedFile));
      if (img.width !== width || img.height !== documentHeight) {
        fail('Stitched PNG dimensions do not match the declared document geometry');
      } else composite = 'GEOMETRY_CHECKED';
    } catch (error) {
      fail('Stitched PNG: ' + error.message);
    }
  }

  return {
    status: errors.length ? 'BLOCKED' : 'GEOMETRY_CHECKED',
    sourceUrl: typeof manifest?.sourceUrl === 'string' ? manifest.sourceUrl : null,
    segments: Array.isArray(segments) ? segments.length : 0,
    composite,
    errors,
    limitations: [
      'Geometry and file headers do not prove screenshot pixels, section content, or visual quality.',
      'A reviewer must inspect the actual frames, sticky elements, lazy media, and final composite.',
      'The declared URL, capture time, and settled states are not independently attested.',
    ],
  };
}

function main() {
  try {
    const args = readArgs(process.argv.slice(2));
    const manifestPath = path.resolve(args.manifest);
    const root = path.dirname(manifestPath);
    if (!lstatSync(manifestPath).isFile() || lstatSync(manifestPath).isSymbolicLink()) {
      throw new Error('Manifest must be a regular file');
    }
    const data = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const result = checkReferenceCapture(data, root);
    process.stdout.write(JSON.stringify(result, null, args.json ? 2 : 0) + '\n');
    if (result.status !== 'GEOMETRY_CHECKED') process.exitCode = 2;
  } catch (error) {
    process.stderr.write('Reference capture check: ' + error.message + '\n');
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
