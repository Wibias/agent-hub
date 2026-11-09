#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { createP47DurableLabRevocation } from '../p47-durable-lab-revocation.mjs';
import { startP49MtlsLabCoordinator } from '../p49-mtls-lab-coordinator.mjs';

// This entrypoint is for the disposable Docker CI rehearsal only.
// There is NO production service, no signing key, no HTTP mutation endpoint.
if (process.env.P49_DOCKER_REHEARSAL !== '1' || !existsSync('/.dockerenv')) {
  process.stderr.write('P49 isolated container guard BLOCKED\n');
  process.exit(2);
}
try {
  const cfg = JSON.parse(readFileSync('/lab/verify/lab.json', 'utf8'));
  if (cfg.schema_version !== 'reference-graph.p49-disposable-lab.v1'
    || !/^[a-f0-9]{40}$/.test(cfg.repository_sha)
    || !/^[a-f0-9]{64}$/.test(cfg.public_key_sha256)
    || !/^[a-f0-9]{64}$/.test(cfg.client_cert_sha256)
    || cfg.lab_id !== 'p49-isolated-container-rehearsal'
    || cfg.default_off !== true) throw new Error('invalid isolated config');
  const store = createP47DurableLabRevocation({
    directory: '/lab/state',
    scope: {
      mode: 'isolated-shadow-rehearsal',
      default_off: true, production_route_wiring: false,
      profiles: ['standard','deep'],
    },
    publicKeyPem: readFileSync('/lab/verify/signer-public.pem','utf8'),
    publicKeySha256: cfg.public_key_sha256,
    expectedRepositorySha: cfg.repository_sha,
    expectedLabId: cfg.lab_id,
    clock: () => new Date('2026-11-09T19:10:02.000Z'),
  });
  // A partial journal cannot serve state, even if the TLS server starts.
  store.readSignedState();
  const app = await startP49MtlsLabCoordinator({
    store,
    tls: {
      key: readFileSync('/lab/server/server.key','utf8'),
      cert: readFileSync('/lab/server/server.pem','utf8'),
      ca: readFileSync('/lab/ca.pem','utf8'),
    },
    clientCertSha256: cfg.client_cert_sha256,
    host: '0.0.0.0', port: 8443, isolatedContainerNetwork: true,
  });
  process.stdout.write('P49_SERVER_READY\n');
  const close = () => { app.close().catch(()=>{process.exitCode=2;}); };
  process.once('SIGTERM',close);
  process.once('SIGINT',close);
} catch {
  process.stderr.write('P49 isolated container server BLOCKED\n');
  process.exitCode = 2;
}
