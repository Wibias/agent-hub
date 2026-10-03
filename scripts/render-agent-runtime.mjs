#!/usr/bin/env node
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const state = (value) => value === true ? 'supported' : value === false ? 'unsupported' : String(value ?? 'unverified');
const normalizeText = (value) => String(value ?? '').replace(/\r\n/g, '\n');

export function assertConfigRendererSupported(hostId, host) {
  if (host?.adapter?.configRenderer !== 'supported') {
    throw new Error(`${hostId}: no supported config renderer; refusing to guess host configuration`);
  }
}

const CODEX_REASONING = new Set(['low', 'medium', 'high', 'xhigh']);

function safeSkillName(skillName) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    throw new Error(`codex: unsafe skill name for runtime rendering: ${skillName}`);
  }
  return skillName;
}

function effectiveRuntimeHint(runtime, skillName) {
  const defaults = runtime.defaults ?? {};
  const hint = runtime.skills?.[skillName] ?? {};
  return {
    reasoning: hint.reasoning ?? defaults.reasoning ?? 'inherit',
    isolation: hint.isolation ?? defaults.isolation ?? 'inherit',
    mutation: hint.mutation ?? defaults.mutation ?? 'inherit',
  };
}

export function renderCodexRuntimeBundle(runtime) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    throw new TypeError('runtime must be an object');
  }

  const runtimes = [];
  const unrendered = [];

  for (const rawSkillName of Object.keys(runtime.skills ?? {}).sort()) {
    const skillName = safeSkillName(rawSkillName);
    const hint = effectiveRuntimeHint(runtime, skillName);
    const unmapped = {};
    if (hint.isolation !== 'inherit') unmapped.isolation = hint.isolation;
    if (hint.mutation !== 'inherit') unmapped.mutation = hint.mutation;

    if (hint.reasoning === 'inherit') {
      if (Object.keys(unmapped).length) {
        unrendered.push({ skill: skillName, unmapped });
      }
      continue;
    }

    if (!CODEX_REASONING.has(hint.reasoning)) {
      throw new Error(
        `codex: cannot render reasoning value ${JSON.stringify(hint.reasoning)} for ${skillName}`,
      );
    }

    runtimes.push({
      skill: skillName,
      mapped: { reasoning: hint.reasoning },
      unmapped,
    });
  }

  return {
    schemaVersion: 2,
    host: 'codex',
    activation: {
      mode: 'cli-override',
      command: 'node scripts/run-codex-runtime.mjs <skill> [-- <codex args>]',
      precedence: 'cli-override',
    },
    mappedRuntimeFields: ['reasoning'],
    unmappedRuntimeFields: ['isolation', 'mutation'],
    runtimes,
    unrendered,
  };
}

async function syncCodexRuntimeBundle(outDir, bundle, { check }) {
  const dir = join(outDir, 'codex-runtime');
  const legacyDir = join(outDir, 'codex-profiles');
  const manifestPath = join(dir, 'manifest.json');
  const manifest = JSON.stringify(bundle, null, 2) + '\n';

  if (check) {
    const drift = [];
    let current = null;
    try { current = await readFile(manifestPath, 'utf8'); } catch {}
    if (normalizeText(current) !== normalizeText(manifest)) {
      drift.push(manifestPath);
    }

    try {
      const legacyNames = await readdir(legacyDir);
      if (legacyNames.length > 0) drift.push(legacyDir);
    } catch {}

    return drift;
  }

  await rm(legacyDir, { recursive: true, force: true });
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(manifestPath, manifest, 'utf8');
  return [];
}

export function renderHostReport(hostId, host, runtime) {
  const sources = host.sources ?? (host.source ? [host.source] : []);
  const lines = [
    `# ${host.displayName ?? hostId} runtime capability report`,
    '',
    'Generated from `agent-runtime/host-capabilities.json` and `agent-runtime/skill-runtime.json`. Do not hand edit.',
    '',
    `- reviewed: ${host.reviewed ?? 'unverified'}`,
    `- agentsRoot: ${state(host.skills?.agentsRoot)}`,
    `- skillModelRouting: ${state(host.skills?.skillModelRouting)}`,
    `- config renderer: ${host.adapter?.configRenderer ?? 'unsupported'}`,
  ];
  if (host.hooks?.supported !== undefined) lines.push(`- lifecycle hooks: ${state(host.hooks.supported)}`);
  if (host.hooks?.command !== undefined) lines.push(`- command hooks: ${state(host.hooks.command)}`);
  if (host.hooks?.pluginBundled !== undefined) lines.push(`- plugin-bundled hooks: ${state(host.hooks.pluginBundled)}`);
  if (host.hooks?.events?.length) lines.push(`- hook events: ${host.hooks.events.join(', ')}`);
  if (host.skills?.sharedSkillRoot) lines.push(`- shared skill root: \`${host.skills.sharedSkillRoot}\``);
  if (host.agentProfiles?.supported !== undefined) lines.push(`- agent profiles: ${state(host.agentProfiles.supported)}`);
  if (host.agentProfiles?.nativeRoot) lines.push(`- native agent root: \`${host.agentProfiles.nativeRoot}\``);
  if (host.agentProfiles?.compatibleRoots?.length) lines.push(`- compatible agent roots: ${host.agentProfiles.compatibleRoots.map((root) => `\`${root}\``).join(', ')}`);
  if (host.adapter?.note) lines.push(`- note: ${host.adapter.note}`);
  if (sources.length) {
    lines.push('', '## Sources', '');
    for (const source of sources) lines.push(`- ${source}`);
  }
  lines.push('', '## Semantic runtime preferences', '');
  lines.push('| skill | reasoning | isolation | mutation |');
  lines.push('|---|---|---|---|');
  const defaults = runtime.defaults ?? {};
  lines.push(`| (default) | ${defaults.reasoning ?? 'inherit'} | ${defaults.isolation ?? 'inherit'} | ${defaults.mutation ?? 'inherit'} |`);
  for (const skillName of Object.keys(runtime.skills ?? {}).sort()) {
    const hint = runtime.skills[skillName] ?? {};
    lines.push(`| ${skillName} | ${hint.reasoning ?? defaults.reasoning ?? 'inherit'} | ${hint.isolation ?? defaults.isolation ?? 'inherit'} | ${hint.mutation ?? defaults.mutation ?? 'inherit'} |`);
  }
  lines.push('', 'These are Hub preferences, not claims that this host can enforce each field. Host capability state above is authoritative.', '');
  return lines.join('\n');
}

async function load(root) {
  const capabilities = JSON.parse(await readFile(join(root, 'agent-runtime', 'host-capabilities.json'), 'utf8'));
  const runtime = JSON.parse(await readFile(join(root, 'agent-runtime', 'skill-runtime.json'), 'utf8'));
  return { capabilities, runtime };
}

export async function renderAll(root = process.cwd(), { check = false } = {}) {
  const resolved = resolve(root);
  const { capabilities, runtime } = await load(resolved);
  const outDir = join(resolved, 'agent-runtime', 'generated');
  if (!check) await mkdir(outDir, { recursive: true });
  const drift = [];
  for (const hostId of Object.keys(capabilities.hosts ?? {}).sort()) {
    const content = renderHostReport(hostId, capabilities.hosts[hostId], runtime);
    const path = join(outDir, `${hostId}.md`);
    if (check) {
      let current = null;
      try { current = await readFile(path, 'utf8'); } catch {}
      if (normalizeText(current) !== normalizeText(content)) drift.push(path);
    } else {
      await writeFile(path, content, 'utf8');
    }

    if (hostId === 'codex' && capabilities.hosts[hostId]?.adapter?.configRenderer === 'supported') {
      drift.push(...await syncCodexRuntimeBundle(
        outDir,
        renderCodexRuntimeBundle(runtime),
        { check },
      ));
    }
  }
  return drift;
}

export async function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check');
  const emitIndex = argv.indexOf('--emit-config');
  const rootIndex = argv.indexOf('--root');
  const root = rootIndex >= 0 ? argv[rootIndex + 1] : process.cwd();
  if (rootIndex >= 0 && !root) {
    console.error('render-agent-runtime: --root requires a path');
    return 2;
  }
  try {
    const { capabilities } = await load(resolve(root));
    if (emitIndex >= 0) {
      const hostId = argv[emitIndex + 1];
      if (!hostId || !capabilities.hosts?.[hostId]) throw new Error(`unknown host ${hostId ?? '<missing>'}`);
      assertConfigRendererSupported(hostId, capabilities.hosts[hostId]);
      if (hostId !== 'codex') {
        throw new Error(`${hostId}: supported renderer declared but no renderer implementation exists`);
      }
      const { runtime } = await load(resolve(root));
      console.log(JSON.stringify(renderCodexRuntimeBundle(runtime), null, 2));
      return 0;
    }
    const drift = await renderAll(root, { check });
    if (drift.length) {
      console.error(`render-agent-runtime: ${drift.length} generated report(s) are stale`);
      for (const path of drift) console.error(`- ${path}`);
      return 1;
    }
    console.log(check ? 'render-agent-runtime: PASS (generated reports current)' : 'render-agent-runtime: generated host reports');
    return 0;
  } catch (error) {
    console.error(`render-agent-runtime: ${error.message}`);
    return 2;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
