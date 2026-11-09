import { readFileSync } from 'node:fs';
import { readP49MtlsSignedState } from '../../../reference-graph/p49-mtls-lab-coordinator.mjs';
import { evaluateP46SignedLabLease } from '../../../reference-graph/p46-distributed-lab-shadow-lease.mjs';

const [port, certDir, serverPin, publicKeyFile, publicKeyPin, repoSha, labId] =
  process.argv.slice(2);
try {
  const envelope = await readP49MtlsSignedState({
    host: '127.0.0.1', port: Number(port), servername: 'p49-coordinator.lab',
    ca: readFileSync(certDir + '/ca.pem', 'utf8'),
    clientCert: readFileSync(certDir + '/client.pem', 'utf8'),
    clientKey: readFileSync(certDir + '/client.key', 'utf8'),
    serverCertSha256: serverPin, timeoutMs: 1600,
  });
  const verdict = evaluateP46SignedLabLease({
    envelope, publicKeyPem: readFileSync(publicKeyFile, 'utf8'),
    publicKeySha256: publicKeyPin, expectedRepositorySha: repoSha,
    expectedLabId: labId,
    now: new Date('2026-11-09T19:10:02.000Z'),
  });
  process.stdout.write(JSON.stringify({
    outcome: verdict.lab_shadow_eligible ? 'eligible-lab-only' : 'blocked',
    valid: verdict.valid,
    activation_authorized: verdict.activation_authorized,
  }) + '\n');
} catch {
  process.stdout.write(JSON.stringify({
    outcome: 'blocked',
    activation_authorized: false,
  }) + '\n');
}
