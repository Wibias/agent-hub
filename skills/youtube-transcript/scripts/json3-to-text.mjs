#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function flattenJson3(document) {
  const parts = [];
  for (const event of document?.events ?? []) {
    for (const segment of event?.segs ?? []) {
      if (typeof segment?.utf8 === "string") parts.push(segment.utf8);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function convertJson3(inputPath, outputPath = null) {
  const input = resolve(inputPath);
  const document = JSON.parse(readFileSync(input, "utf8"));
  const text = flattenJson3(document);
  const output = outputPath
    ? resolve(outputPath)
    : input.replace(/\.json3$/i, "") + ".txt";
  writeFileSync(output, text, "utf8");
  return { input, output, characters: text.length };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const input = process.argv[2];
    if (!input) throw new Error("usage: node json3-to-text.mjs <input.json3> [output.txt]");
    const result = convertJson3(input, process.argv[3] ?? null);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`json3-to-text failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
