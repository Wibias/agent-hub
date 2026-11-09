#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { createP46DistributedLabShadowGate } from '../p46-distributed-lab-shadow-lease.mjs';
import { readP49MtlsSignedState } from '../p49-mtls-lab-coordinator.mjs';

if (process.env.P49_DOCKER_REHEARSAL !== '1' || !existsSync('/.dockerenv')) {
  process.stderr.write('P49 isolated worker BLOCKED\n');
  process.exit(2);
}
try {
  const cfg = JSON.parse(readFileSync('/lab/verify/lab.json', 'utf8'));
  if (cfg.schema_version !== 'reference-graph.p49-disposable-lab.v1'
    || cfg.lab_id !== 'p49-isolated-container-rehearsal'
    || cfg.default_off !== true || !/^[a-f0-9]{40}$/.test(cfg.repository_sha)
    || !/^[a-f0-9]{64}$/.test(cfg.server_cert_sha256)) {
    throw new Error('lab config invalid');
  }
  const phase = process.env.P49_LAB_PHASE;
  if (phase !== 'once' && phase !== 'pending') throw new Error('wrong phase');
  const tls = {
    host: 'p49-coordinator.lab', port: 8443, servername: 'p49-coordinator.lab',
    ca: readFileSync('/lab/ca.pem','utf8'),
    clientCert: readFileSync('/lab/client/client.pem','utf8'),
    clientKey: readFileSync('/lab/client/client.key','utf8'),
    serverCertSha256: cfg.server_cert_sha256, timeoutMs: 1100,
  };
  const gate = createP46DistributedLabShadowGate({
    scope: {
      mode: 'isolated-shadow-rehearsal', default_off: true,
      production_route_wiring: false, profiles: ['standard','deep'],
    },
    readSignedEnvelope: ({signal}) => readP49MtlsSignedState({...tls,signal}),
    publicKeyPem: readFileSync('/lab/verify/signer-public.pem','utf8'),
    publicKeySha256: cfg.public_key_sha256,
    expectedRepositorySha: cfg.repository_sha,
    expectedLabId: cfg.lab_id,
    clock: () => new Date('2026-11-09T19:10:02.000Z'),
    pollMs: 75, readTimeoutMs: 1600,
    shadowProbe: ({signal}) => {
      if (phase === 'pending') {
        process.stdout.write('P49_WORKER_STARTED\n');
        return new Promise((_resolve,reject) => {
          signal.addEventListener('abort',
            () => reject(new Error('shadow aborted')), {once:true});
        });
      }
      return Promise.resolve({
        status: 'exact', record_order_exact: true, pattern_order_exact: true,
        authoritative_source: 'legacy-control',
        activation_authorized: false, graph_runtime_activated: false,
      });
    },
  });
  try {
    const result = await gate.probe({request:{profile:'standard'}});
    process.stdout.write(JSON.stringify({
      outcome: 'eligible-lab-only',
      source: result.authoritative_source,
      activation_authorized: false,
    })+'\n');
  } catch {
    process.stdout.write(JSON.stringify({
      outcome: 'blocked',
      latched: gate.status().local_probe_latched_off,
      activation_authorized: false,
    })+'\n');
  }
} catch {
  process.stdout.write(JSON.stringify({
    outcome: 'blocked',
    activation_authorized: false,
  })+'\n');
}
