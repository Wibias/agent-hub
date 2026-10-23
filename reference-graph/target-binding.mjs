import { readFileSync } from 'node:fs';

const PURPOSE = 'agent-hub-reference-graph';
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

function requireNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

export function validateTargetBinding(binding) {
  const value = requireObject(binding, 'target binding');
  const purpose = requireNonEmptyString(value.purpose, 'purpose');
  if (purpose !== PURPOSE) {
    throw new Error(`purpose must be ${PURPOSE}`);
  }

  const projectRef = requireNonEmptyString(value.project_ref, 'project ref');
  if (!PROJECT_REF_RE.test(projectRef)) {
    throw new Error('project ref must be a 20-character lowercase Supabase project ref');
  }

  return {
    purpose,
    project_ref: projectRef,
    project_name: requireNonEmptyString(value.project_name, 'project name'),
    region: requireNonEmptyString(value.region, 'region'),
  };
}

export function readTargetBinding(filePath) {
  const path = requireNonEmptyString(filePath, 'target path');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read target binding: ${message}`);
  }
  return validateTargetBinding(parsed);
}

export function assertBoundSupabaseUrl({ binding, supabaseUrl } = {}) {
  const normalized = validateTargetBinding(binding);
  const raw = requireNonEmptyString(supabaseUrl, 'Supabase URL');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Supabase URL must be a valid HTTPS URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Supabase URL must use HTTPS');
  }
  if (url.username || url.password || url.port || url.search || url.hash) {
    throw new Error('Supabase URL must be the hosted project URL only');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Supabase URL must not contain a path');
  }

  const expectedHost = `${normalized.project_ref}.supabase.co`;
  if (url.hostname !== expectedHost) {
    throw new Error(
      `Supabase URL project ref mismatch: expected ${normalized.project_ref}`,
    );
  }

  return normalized;
}

function redactString(value, secrets) {
  let result = value;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    result = result.split(secret).join('[redacted]');
  }
  return result;
}

function redactValue(value, secrets) {
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry, secrets)]),
    );
  }
  return value;
}

export function redactDiagnostics(value, secrets = []) {
  const normalizedSecrets = Array.isArray(secrets) ? secrets : [secrets];
  if (typeof value === 'string') {
    return redactString(value, normalizedSecrets);
  }
  return JSON.stringify(redactValue(value, normalizedSecrets));
}
