#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RESERVED_SKILL_NAMES = new Set(['synced', 'anthropic-skills']);
const HUB_HOOK_MARKERS = [
  'claude-code-hook-cli.mjs',
  'claude-code-full-hook-cli.mjs',
  'claude-code-agent-memory-pipeline-hook.mjs',
  'embedding-worker-launcher.mjs',
];
const RTK_HOOK_MARKER = 'rtk hook claude';
const POINTER_FILES = ['SOUL.md', 'AGENTS.md', 'CONTEXT.md'];

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function defaultHubRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

export function defaultClaudeHome(env = process.env) {
  if (nonEmpty(env.CLAUDE_CONFIG_DIR)) {
    return resolve(env.CLAUDE_CONFIG_DIR.trim());
  }
  return join(homedir(), '.claude');
}

function stripExtendedPrefix(value) {
  return value.startsWith('\\\\?\\') ? value.slice(4) : value;
}

function normalizeForCompare(value) {
  const normalized = resolve(stripExtendedPrefix(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === ''
    || (!rel.startsWith('..') && !isAbsolute(rel));
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function readLinkTarget(linkPath) {
  const raw = stripExtendedPrefix(readlinkSync(linkPath));
  return isAbsolute(raw) ? resolve(raw) : resolve(dirname(linkPath), raw);
}

function quoteArg(value) {
  return '"' + value + '"';
}

export function listHubSkills(hubSkillsDir) {
  if (!existsSync(hubSkillsDir)) return [];

  const skills = [];
  for (const entry of readdirSync(hubSkillsDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (RESERVED_SKILL_NAMES.has(entry.name.toLowerCase())) continue;

    const skillPath = join(hubSkillsDir, entry.name);
    let stats;
    try {
      stats = statSync(skillPath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    if (!existsSync(join(skillPath, 'SKILL.md'))) continue;

    skills.push({ name: entry.name, path: skillPath });
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

export function inspectSkillLinks({ hubSkillsDir, claudeSkillsDir }) {
  const desired = listHubSkills(hubSkillsDir);
  const desiredTargets = new Set(desired.map((skill) => normalizeForCompare(skill.path)));

  const links = desired.map((skill) => {
    const linkPath = join(claudeSkillsDir, skill.name);
    const stats = lstatOrNull(linkPath);
    const base = { name: skill.name, linkPath, target: skill.path };

    if (!stats) return { ...base, status: 'missing', managed: true };

    if (stats.isSymbolicLink()) {
      const current = readLinkTarget(linkPath);
      if (normalizeForCompare(current) === normalizeForCompare(skill.path)) {
        return { ...base, status: 'present', managed: true };
      }
      return {
        ...base,
        status: 'wrong-target',
        currentTarget: current,
        managed: isInside(hubSkillsDir, current),
      };
    }

    return { ...base, status: 'conflict', reason: 'path already exists and is not a link' };
  });

  const stale = [];
  if (existsSync(claudeSkillsDir)) {
    const desiredNames = new Set(desired.map((skill) => skill.name));
    for (const entry of readdirSync(claudeSkillsDir, { withFileTypes: true })) {
      if (desiredNames.has(entry.name)) continue;
      if (RESERVED_SKILL_NAMES.has(entry.name.toLowerCase())) continue;

      const linkPath = join(claudeSkillsDir, entry.name);
      const stats = lstatOrNull(linkPath);
      if (!stats?.isSymbolicLink()) continue;

      let current;
      try {
        current = readLinkTarget(linkPath);
      } catch {
        continue;
      }
      if (!isInside(hubSkillsDir, current)) continue;
      if (desiredTargets.has(normalizeForCompare(current))) continue;

      stale.push({
        name: entry.name,
        linkPath,
        currentTarget: current,
        reason: existsSync(current) ? 'not-a-current-hub-skill' : 'target-missing',
      });
    }
  }

  return { root: claudeSkillsDir, links, stale };
}

function commandText(hook) {
  return typeof hook?.command === 'string'
    ? hook.command.replace(/\\/g, '/')
    : '';
}

function isHubHook(hook) {
  const command = commandText(hook);
  return HUB_HOOK_MARKERS.some((marker) => command.includes(marker));
}

function isRtkHook(hook) {
  return commandText(hook).includes(RTK_HOOK_MARKER);
}

function stripMatchingHooks(groups, predicate) {
  const next = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) {
      next.push(group);
      continue;
    }
    const kept = group.hooks.filter((hook) => !predicate(hook));
    if (kept.length > 0) next.push({ ...group, hooks: kept });
  }
  return next;
}

function commandHook({ command, timeout, async = false, statusMessage }) {
  const hook = { type: 'command', command, timeout };
  if (async) hook.async = true;
  if (nonEmpty(statusMessage)) hook.statusMessage = statusMessage;
  return hook;
}

export function desiredClaudeHookGroups({ hubRoot, nodePath }) {
  const quote = quoteArg;
  const fullHook = join(
    hubRoot,
    'memory-engine',
    'adapters',
    'claude-code-full-hook-cli.mjs',
  );
  const pipelineHook = join(
    hubRoot,
    'scripts',
    'claude-code-agent-memory-pipeline-hook.mjs',
  );
  const workerLauncher = join(
    hubRoot,
    'memory-engine',
    'embedding-worker-launcher.mjs',
  );
  const cacheDir = join(hubRoot, '.cache', 'memory-engine', 'e5');

  const promptCommand = [
    nodePath,
    fullHook,
    '--ignore-memory-env',
    '--explicit-memory-requests',
    '--hybrid-recall',
    '--recall-relevance',
    '--recall-fast-path-shadow-replay',
    '--candidate-capture',
    '--auto-pipeline',
  ].map(quote).join(' ');
  const decisionCommand = [nodePath, fullHook, '--ignore-memory-env']
    .map(quote).join(' ');
  const pipelineCommand = [
    nodePath,
    pipelineHook,
    '--ignore-memory-env',
  ].map(quote).join(' ');
  const launcherCommand = [
    nodePath,
    workerLauncher,
    '--cache-dir',
    cacheDir,
  ].map(quote).join(' ');

  const decisionGroup = () => ({
    hooks: [
      commandHook({
        command: decisionCommand,
        timeout: 10,
        statusMessage: 'Capturing agent decisions',
      }),
      commandHook({
        command: pipelineCommand,
        timeout: 300,
        async: true,
        statusMessage: 'Processing agent memories',
      }),
    ],
  });

  return {
    SessionStart: [{
      matcher: 'startup|resume|clear|compact',
      hooks: [commandHook({
        command: launcherCommand,
        timeout: 45,
        async: true,
        statusMessage: 'Starting project memory embeddings',
      })],
    }],
    UserPromptSubmit: [{
      hooks: [commandHook({
        command: promptCommand,
        timeout: 30,
        statusMessage: 'Recalling project memory',
      })],
    }],
    Stop: [decisionGroup()],
    SubagentStop: [decisionGroup()],
  };
}

export function planClaudeHooks(settings, {
  hubRoot,
  nodePath,
  manageHooks = true,
} = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('settings must be an object');
  }
  if (!nonEmpty(hubRoot) || !nonEmpty(nodePath)) {
    throw new TypeError('hubRoot and nodePath are required');
  }

  const next = structuredClone(settings);
  if (
    next.hooks !== undefined
    && (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks))
  ) {
    throw new TypeError('settings.hooks must be an object');
  }

  const hooks = next.hooks ?? {};
  for (const [eventName, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    let cleaned = stripMatchingHooks(groups, isRtkHook);
    cleaned = stripMatchingHooks(cleaned, isHubHook);
    if (cleaned.length === 0) delete hooks[eventName];
    else hooks[eventName] = cleaned;
  }

  if (manageHooks) {
    const desired = desiredClaudeHookGroups({ hubRoot, nodePath });
    for (const [eventName, groups] of Object.entries(desired)) {
      const existing = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
      hooks[eventName] = [...existing, ...structuredClone(groups)];
    }
  }

  if (Object.keys(hooks).length === 0) delete next.hooks;
  else next.hooks = hooks;

  return {
    settings: next,
    changed: JSON.stringify(next) !== JSON.stringify(settings),
  };
}

export function planClaudeMd({ hubRoot, claudeHome }) {
  const path = join(claudeHome, 'CLAUDE.md');
  const imports = POINTER_FILES.map((file) => '@' + join(hubRoot, file));
  const agentImport = '@' + join(hubRoot, 'AGENTS.md');

  if (!existsSync(path)) {
    return { path, status: 'missing', imports, willCreate: true };
  }

  const text = readFileSync(path, 'utf8');
  const present = text.toLowerCase().includes(agentImport.toLowerCase());
  return { path, status: present ? 'present' : 'needs_attention', imports };
}

function pointerDocument(imports) {
  return [
    '# Claude Code — pointer to hub',
    '',
    'Canonical identity and ops live in the agent hub. Do not duplicate them here.',
    '',
    ...imports,
    '',
  ].join('\n');
}

function createSkillLink(target, linkPath) {
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function removeLink(linkPath) {
  try {
    unlinkSync(linkPath);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
    rmdirSync(linkPath);
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function parseClaudeHostSetupArgs(argv = [], env = process.env) {
  if (!Array.isArray(argv)) throw new TypeError('argv must be an array');

  const result = {
    apply: false,
    hubRoot: defaultHubRoot(),
    claudeHome: defaultClaudeHome(env),
    nodePath: process.execPath,
    memoryHook: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      result.apply = true;
      continue;
    }
    if (arg === '--no-memory-hook') {
      result.memoryHook = false;
      continue;
    }
    if (['--hub-root', '--claude-home', '--node'].includes(arg)) {
      const value = argv[index + 1];
      if (!nonEmpty(value)) throw new Error(arg + ' requires a path');
      if (arg === '--hub-root') result.hubRoot = resolve(value);
      if (arg === '--claude-home') result.claudeHome = resolve(value);
      if (arg === '--node') result.nodePath = resolve(value);
      index += 1;
      continue;
    }

    throw new Error(
      'Unknown option: ' + arg
      + '\nUsage: node scripts/setup-claude-host.mjs '
      + '[--apply] [--no-memory-hook] [--hub-root PATH] '
      + '[--claude-home PATH] [--node PATH]',
    );
  }

  return result;
}

export function runClaudeHostSetup({
  apply = false,
  hubRoot = defaultHubRoot(),
  claudeHome = defaultClaudeHome(),
  nodePath = process.execPath,
  memoryHook = true,
} = {}) {
  const resolvedHubRoot = resolve(hubRoot);
  const resolvedClaudeHome = resolve(claudeHome);
  const hubSkillsDir = join(resolvedHubRoot, 'skills');
  const claudeSkillsDir = join(resolvedClaudeHome, 'skills');
  const settingsPath = join(resolvedClaudeHome, 'settings.json');

  const claudeMd = planClaudeMd({ hubRoot: resolvedHubRoot, claudeHome: resolvedClaudeHome });
  const skills = inspectSkillLinks({ hubSkillsDir, claudeSkillsDir });

  const settingsExists = existsSync(settingsPath);
  let settings = {};
  let settingsError = null;
  let hookPlan = null;
  if (settingsExists) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch (error) {
      settingsError = 'cannot parse settings.json: ' + error.message;
    }
  }

  if (settingsError === null) {
    try {
      hookPlan = planClaudeHooks(settings, {
        hubRoot: resolvedHubRoot,
        nodePath,
        manageHooks: memoryHook,
      });
    } catch (error) {
      settingsError = error.message;
    }
  }

  const conflicts = [
    ...skills.links.filter((link) => link.status === 'conflict'),
    ...skills.links.filter((link) => link.status === 'wrong-target' && !link.managed),
  ];

  const pendingChanges = (
    conflicts.length === 0
    && settingsError === null
    && (
      claudeMd.willCreate === true
      || hookPlan?.changed === true
      || skills.stale.length > 0
      || skills.links.some((link) => (
        link.status === 'missing'
        || (link.status === 'wrong-target' && link.managed)
      ))
    )
  );

  const applied = {
    claudeMd: false,
    linksCreated: 0,
    linksRepaired: 0,
    linksPruned: 0,
    hooks: false,
    settingsBackupPath: null,
  };

  if (apply && conflicts.length === 0 && settingsError === null) {
    if (claudeMd.willCreate) {
      mkdirSync(resolvedClaudeHome, { recursive: true });
      writeFileSync(claudeMd.path, pointerDocument(claudeMd.imports), 'utf8');
      applied.claudeMd = true;
    }

    mkdirSync(claudeSkillsDir, { recursive: true });

    for (const entry of skills.stale) {
      removeLink(entry.linkPath);
      applied.linksPruned += 1;
    }

    for (const link of skills.links) {
      if (link.status === 'missing') {
        createSkillLink(link.target, link.linkPath);
        applied.linksCreated += 1;
      } else if (link.status === 'wrong-target' && link.managed) {
        removeLink(link.linkPath);
        createSkillLink(link.target, link.linkPath);
        applied.linksRepaired += 1;
      }
    }

    if (hookPlan?.changed) {
      const backupPath = settingsPath + '.bak-' + timestamp();
      if (settingsExists) copyFileSync(settingsPath, backupPath);
      writeFileSync(
        settingsPath,
        JSON.stringify(hookPlan.settings, null, 2) + '\n',
        'utf8',
      );
      applied.hooks = true;
      applied.settingsBackupPath = settingsExists ? backupPath : null;
    }
  }

  let status = 'healthy';
  if (conflicts.length > 0 || settingsError) {
    status = 'conflicts';
  } else if (claudeMd.status === 'needs_attention') {
    status = 'attention_required';
  } else if (!apply && pendingChanges) {
    status = 'changes_required';
  }

  const nextSteps = [];
  if (claudeMd.status === 'needs_attention') {
    nextSteps.push(
      'Add the hub imports to ' + claudeMd.path
      + ' manually; the file is left untouched.',
    );
  }
  if (conflicts.length > 0) {
    nextSteps.push(
      'Resolve conflicting entries under ' + claudeSkillsDir
      + ' before rerunning.',
    );
  }
  if (settingsError) nextSteps.push(settingsError);
  if (status === 'changes_required') nextSteps.push('Review this plan, then rerun with --apply.');
  if (applied.hooks || applied.linksCreated || applied.linksRepaired) {
    nextSteps.push('Start a new Claude Code session so it reloads skills and hooks.');
  }

  return {
    type: 'agent_hub_claude_host_setup',
    schemaVersion: 1,
    mode: apply ? 'apply' : 'dry-run',
    status,
    hubRoot: resolvedHubRoot,
    claudeHome: resolvedClaudeHome,
    nodePath,
    plan: {
      claudeMd,
      skills: {
        root: skills.root,
        desired: skills.links.length,
        links: skills.links,
        stale: skills.stale,
      },
      hooks: {
        path: settingsPath,
        manageHubHooks: memoryHook,
        changed: hookPlan?.changed === true,
        managedEvents: memoryHook
          ? Object.keys(desiredClaudeHookGroups({
            hubRoot: resolvedHubRoot,
            nodePath,
          }))
          : [],
      },
    },
    applied,
    mutationsApplied: (
      applied.claudeMd
      || applied.linksCreated > 0
      || applied.linksRepaired > 0
      || applied.linksPruned > 0
      || applied.hooks
    ),
    nextSteps,
  };
}

export async function main({
  argv = process.argv.slice(2),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const options = parseClaudeHostSetupArgs(argv);
    const result = runClaudeHostSetup(options);
    stdout.write(JSON.stringify(result, null, 2) + '\n');

    if (result.status === 'conflicts' || result.status === 'attention_required') {
      process.exitCode = 2;
    } else if (result.status === 'changes_required') {
      process.exitCode = 1;
    }
  } catch (error) {
    stderr.write(
      (error instanceof Error ? error.message : String(error))
      + '\n',
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
