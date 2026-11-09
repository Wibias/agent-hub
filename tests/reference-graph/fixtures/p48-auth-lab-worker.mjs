import { createP46DistributedLabShadowGate } from '../../../reference-graph/p46-distributed-lab-shadow-lease.mjs';

const [endpoint, pem64, fingerprint, repoSha, labId, mode] = process.argv.slice(2);
const readToken = process.env.P48_LAB_READ_TOKEN ?? '';
const gate = createP46DistributedLabShadowGate({
  scope: {
    mode: 'isolated-shadow-rehearsal',
    default_off: true, production_route_wiring: false,
    profiles: ['standard', 'deep'],
  },
  publicKeyPem: Buffer.from(pem64, 'base64url').toString('utf8'),
  publicKeySha256: fingerprint,
  expectedRepositorySha: repoSha,
  expectedLabId: labId,
  clock: () => new Date('2026-11-09T19:10:02.000Z'),
  readTimeoutMs: 500,
  pollMs: 20,
  readSignedEnvelope: async ({ signal }) => {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + readToken },
      cache: 'no-store',
      signal,
    });
    if (!res.ok) throw new Error('coordinator denied');
    return res.json();
  },
  shadowProbe: async ({ signal }) => {
    if (mode === 'pending') {
      process.stdout.write('STARTED\n');
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort',
          () => reject(new Error('lab shadow cancelled')), { once: true });
      });
    }
    return {
      status: 'exact', record_order_exact: true, pattern_order_exact: true,
      authoritative_source: 'legacy-control',
      activation_authorized: false, graph_runtime_activated: false,
    };
  },
});
try {
  const result = await gate.probe({ request: { profile: 'standard' } });
  process.stdout.write(JSON.stringify({
    outcome: 'exact',
    source: result.authoritative_source,
    activation_authorized: gate.status().activation_authorized,
  }) + '\n');
} catch {
  process.stdout.write(JSON.stringify({
    outcome: 'blocked',
    latched: gate.status().local_probe_latched_off,
    activation_authorized: gate.status().activation_authorized,
  }) + '\n');
}
