import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

const TARGETS = Object.freeze([
  Object.freeze({
    section: 'features',
    key: 'memories',
    resultKey: 'featureEnabled',
  }),
  Object.freeze({
    section: 'memories',
    key: 'use_memories',
    resultKey: 'useMemories',
  }),
  Object.freeze({
    section: 'memories',
    key: 'generate_memories',
    resultKey: 'generateMemories',
  }),
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

function splitText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('config text must be a string');
  }

  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = bom ? text.slice(1) : text;
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  const endsWithNewline = body.endsWith('\n');

  return {
    bom,
    newline,
    endsWithNewline,
    lines: body.split(/\r?\n/),
  };
}

function joinText(parts) {
  let body = parts.lines.join(parts.newline);

  if (!parts.endsWithNewline && body.endsWith(parts.newline)) {
    body = body.slice(0, -parts.newline.length);
  }
  if (parts.endsWithNewline && !body.endsWith(parts.newline)) {
    body += parts.newline;
  }

  return parts.bom + body;
}

function sectionHeader(line) {
  const match = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/u);
  return match ? match[1].trim() : null;
}

function assertNoDottedAliases(lines) {
  for (const target of TARGETS) {
    const dotted = new RegExp(
      '^\\s*'
        + escapeRegex(target.section)
        + '\\.'
        + escapeRegex(target.key)
        + '\\s*=',
      'u',
    );

    for (const line of lines) {
      if (dotted.test(line)) {
        throw new Error(
          'Refusing ambiguous dotted target '
            + target.section
            + '.'
            + target.key,
        );
      }
    }
  }
}

function findSection(lines, section) {
  const starts = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (sectionHeader(lines[index]) === section) starts.push(index);
  }

  if (starts.length > 1) {
    throw new Error('Duplicate [' + section + '] section');
  }
  if (starts.length === 0) return null;

  const start = starts[0];
  let end = lines.length;

  for (let index = start + 1; index < lines.length; index += 1) {
    if (sectionHeader(lines[index]) !== null) {
      end = index;
      break;
    }
  }

  return { start, end };
}

function findBooleanSetting(lines, section, key) {
  const bounds = findSection(lines, section);
  if (!bounds) {
    return {
      bounds: null,
      index: null,
      value: null,
    };
  }

  const keyPattern = new RegExp(
    '^\\s*' + escapeRegex(key) + '\\s*=',
    'u',
  );
  const booleanPattern = new RegExp(
    '^(\\s*'
      + escapeRegex(key)
      + '\\s*=\\s*)(true|false)(\\s*(?:#.*)?)$',
    'u',
  );

  const matches = [];

  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    if (!keyPattern.test(lines[index])) continue;

    const match = lines[index].match(booleanPattern);
    if (!match) {
      throw new Error(
        '['
          + section
          + '] '
          + key
          + ' must be a boolean when managed by Agent Hub',
      );
    }

    matches.push({
      index,
      value: match[2] === 'true',
      prefix: match[1],
      suffix: match[3],
    });
  }

  if (matches.length > 1) {
    throw new Error('Duplicate [' + section + '] ' + key + ' setting');
  }

  if (matches.length === 0) {
    return {
      bounds,
      index: null,
      value: null,
    };
  }

  return {
    bounds,
    ...matches[0],
  };
}

function insertionIndex(lines, bounds) {
  let index = bounds.end;

  while (
    index > bounds.start + 1
    && /^\s*$/u.test(lines[index - 1])
  ) {
    index -= 1;
  }

  return index;
}

function appendSection(lines, section, entries) {
  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
  }

  if (lines.length > 0) lines.push('');
  lines.push('[' + section + ']');

  for (const [key, value] of entries) {
    lines.push(key + ' = ' + (value ? 'true' : 'false'));
  }

  lines.push('');
}

function setBoolean(text, section, key, value) {
  const parts = splitText(text);
  const lines = [...parts.lines];

  assertNoDottedAliases(lines);

  const setting = findBooleanSetting(lines, section, key);

  if (setting.index !== null) {
    lines[setting.index] = (
      setting.prefix
      + (value ? 'true' : 'false')
      + setting.suffix
    );

    return joinText({
      ...parts,
      lines,
    });
  }

  if (setting.bounds) {
    lines.splice(
      insertionIndex(lines, setting.bounds),
      0,
      key + ' = ' + (value ? 'true' : 'false'),
    );

    return joinText({
      ...parts,
      lines,
    });
  }

  appendSection(lines, section, [[key, value]]);

  return joinText({
    ...parts,
    endsWithNewline: true,
    lines,
  });
}

export function inspectCodexNativeMemoryConfig(text) {
  const { lines } = splitText(text);
  assertNoDottedAliases(lines);

  const result = {};

  for (const target of TARGETS) {
    const setting = findBooleanSetting(
      lines,
      target.section,
      target.key,
    );
    result[target.resultKey] = setting.value;
  }

  return result;
}

export function planCodexNativeMemoryIsolation(text) {
  const before = inspectCodexNativeMemoryConfig(text);

  let nextText = text;
  nextText = setBoolean(nextText, 'features', 'memories', false);
  nextText = setBoolean(nextText, 'memories', 'use_memories', false);
  nextText = setBoolean(
    nextText,
    'memories',
    'generate_memories',
    false,
  );

  const after = inspectCodexNativeMemoryConfig(nextText);

  return {
    changed: nextText !== text,
    before,
    after,
    nextText,
  };
}

function defaultBackupSuffix() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/u, 'Z');
}

export async function applyCodexNativeMemoryIsolation({
  codexHome,
  backupSuffix = defaultBackupSuffix(),
}) {
  if (typeof codexHome !== 'string' || codexHome.trim().length === 0) {
    throw new TypeError('codexHome must be a non-empty string');
  }

  if (
    typeof backupSuffix !== 'string'
    || !/^[A-Za-z0-9._-]+$/u.test(backupSuffix)
  ) {
    throw new TypeError(
      'backupSuffix must contain only letters, digits, dot, underscore, or hyphen',
    );
  }

  const resolvedHome = resolve(codexHome);
  const configPath = join(resolvedHome, 'config.toml');

  await mkdir(resolvedHome, { recursive: true });

  let current = '';
  let configExists = true;

  try {
    current = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    configExists = false;
  }

  const plan = planCodexNativeMemoryIsolation(current);

  if (!plan.changed) {
    return {
      changed: false,
      configPath,
      backupPath: null,
      settings: plan.after,
    };
  }

  let backupPath = null;

  if (configExists) {
    backupPath = join(
      resolvedHome,
      'config.toml.bak-native-memory-' + backupSuffix,
    );
    await copyFile(configPath, backupPath);
  }

  const tempPath = join(
    resolvedHome,
    '.config.toml.agent-hub-'
      + process.pid
      + '-'
      + Date.now()
      + '.tmp',
  );

  try {
    await writeFile(tempPath, plan.nextText, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(tempPath, configPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    changed: true,
    configPath,
    backupPath,
    settings: plan.after,
  };
}
