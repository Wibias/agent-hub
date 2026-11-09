import { createP46DistributedLabShadowGate } from '../../../reference-graph/p46-distributed-lab-shadow-lease.mjs';

const [endpoint, key64, keyPin, sha, labId, mode] = process.argv.slice(2);
const publicKeyPem = Buffer.from(key64, 'base64url').toString('utf8');
const gate = createP46DistributedLabShadowGate({
  scope: {
    mode: 'isolated-shadow-rehearsal',
    default_off: true, production_route_wiring: false,
    profiles: ['standard', 'deep'],
  },
  expectedRepositorySha: sha,
  expectedLabId: labId,
  publicKeyPem,
  publicKeySha256: keyPin,
  clock: () => new Date('2026-11-09T19:10:02.000Z'),
  readTimeoutMs: 300,
  pollMs: 20,
  readSignedEnvelope: async ({ signal }) => {
    const response = await fetch(endpoint, {
      method: 'GET', signal, cache: 'no-store',
    });
    if (!response.ok) throw new Error('coordinator unavailable');
    return response.json();
  },
  shadowProbe: async ({ signal }) => {
    if (mode !== 'pending') {
      return {
        status: 'exact',
        record_order_exact: true,
        pattern_order_exact: true,
        authoritative_source: 'legacy-control',
        activation_authorized: false,
        graph_runtime_activated: false,
      };
    }
    process.stdout.write('STARTED\n');
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')),
        { once: true });
    });
  },
});
try {
  const result = await gate.probe({ request: { profile: 'standard' } });
  process.stdout.write(JSON.stringify({
    outcome: 'exact',
    source: result.authoritative_source,
    authorized: gate.status().activation_authorized,
  }) + '\n');
} catch {
  process.stdout.write(JSON.stringify({
    outcome: 'blocked',
    latched: gate.status().local_probe_latched_off,
    authorized: gate.status().activation_authorized,
  }) + '\n');
}
