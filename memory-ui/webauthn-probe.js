'use strict';

const $ = id => document.getElementById(id);
const params = new URL(window.location.href).searchParams;
const scope = Object.freeze({
  projectId: params.get('projectId'),
  branch: params.get('branch'),
  proposalRef: params.get('proposalRef'),
});
const button = $('start-hello');
const feedback = $('probe-status');
let prepared = null;
let busy = false;

function show(message, error = false) {
  feedback.textContent = message;
  feedback.classList.toggle('error', error);
}
function b64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Ungültige WebAuthn-Challenge.');
  }
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
function encoded(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let raw = '';
  for (const item of bytes) raw += String.fromCharCode(item);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function chosen() {
  return document.querySelector('input[name="decision"]:checked')?.value || 'confirm';
}
async function request(path, body) {
  const reply = await fetch('/api/webauthn-probe/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const data = await reply.json();
  if (!reply.ok) throw new Error(data.error || 'WebAuthn-Prüfung nicht verfügbar.');
  return data;
}
async function prepare() {
  const search = new URLSearchParams({ ...scope, decision: chosen() });
  const reply = await fetch('/api/webauthn-probe/prepare?' + search, {
    cache: 'no-store', credentials: 'same-origin',
  });
  const data = await reply.json();
  if (!reply.ok) throw new Error(data.error || 'Vorschlag nicht verfügbar.');
  if (data.type !== 'agenthub_readonly_webauthn_evidence_probe_v1'
      || data.reviewAuthorityEstablished !== false
      || data.claimWritten !== false
      || data.meaning?.proposalRef !== scope.proposalRef
      || data.meaning?.projectId !== scope.projectId
      || data.meaning?.branch !== scope.branch) {
    throw new Error('Ungültige Prüfsitzung.');
  }
  $('p-project').textContent = data.meaning.projectId;
  $('p-branch').textContent = data.meaning.branch;
  $('p-reference').textContent = data.meaning.proposalRef;
  $('p-revision').textContent = data.meaning.revisionSha;
  $('p-fact').textContent = data.meaning.canonicalFact;
  $('p-blockers').textContent = data.blockers?.length
    ? data.blockers.join(', ') : 'Keine aus dem lokalen Preflight gemeldet';
  return data;
}
async function authenticate(data) {
  if (!window.isSecureContext || window.location.hostname !== 'localhost'
      || !window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('WebAuthn benötigt http://localhost und einen unterstützten Browser.');
  }
  show('Credential wird einmalig erstellt. Bestätige den Browserdialog bewusst.');
  const options = data.publicKey;
  const created = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: b64(options.challenge),
      user: { ...options.user, id: b64(options.user.id) },
    },
  });
  if (!created || created.type !== 'public-key'
      || typeof created.response?.getPublicKey !== 'function') {
    throw new Error('Der Browser konnte kein passendes WebAuthn-Credential erzeugen.');
  }
  const spki = created.response.getPublicKey();
  if (!spki) throw new Error('Der Browser stellt keinen öffentlichen WebAuthn-Schlüssel bereit.');
  await request('enroll', {
    sessionId: data.sessionId,
    credentialId: encoded(created.rawId),
    publicKeySpki: encoded(spki),
    clientDataJSON: encoded(created.response.clientDataJSON),
  });

  const challenge = await request('challenge', { sessionId: data.sessionId });
  if (challenge.type !== 'agenthub_readonly_webauthn_assertion_probe_v1'
      || challenge.meaning?.canonicalFactSha256 !== data.meaning.canonicalFactSha256
      || challenge.meaning?.decision !== chosen()) {
    throw new Error('Prüfinhalt oder Entscheidung hat sich geändert.');
  }

  show('Bitte bestätige den exakten Vorschlag mit Windows Hello oder deinem Sicherheitsschlüssel.');
  const response = await navigator.credentials.get({
    publicKey: {
      ...challenge.publicKey,
      challenge: b64(challenge.publicKey.challenge),
      allowCredentials: challenge.publicKey.allowCredentials.map(item => ({
        ...item, id: b64(item.id),
      })),
    },
  });
  if (!response || response.type !== 'public-key')
    throw new Error('Keine gültige WebAuthn-Antwort erhalten.');
  const result = await request('finish', {
    sessionId: data.sessionId,
    credentialId: encoded(response.rawId),
    clientDataJSON: encoded(response.response.clientDataJSON),
    authenticatorData: encoded(response.response.authenticatorData),
    signature: encoded(response.response.signature),
  });
  if (result.status !== 'browser_webauthn_uv_observed_not_approved'
      || result.browserUserVerificationObserved !== true
      || result.protectedApproval !== false || result.claimWritten !== false) {
    throw new Error('WebAuthn-Signatur oder Vorschlag nicht verifiziert. Keine Freigabe.');
  }
  show('✓ WebAuthn-Bestätigung erfolgreich geprüft. KEIN geschützter Claim geschrieben und KEINE echte Freigabe erteilt.');
}
function enableButton() {
  button.disabled = busy || !$('ack').checked || !scope.projectId
    || !scope.branch || !/^E~[0-9a-f]{10}$/.test(scope.proposalRef ?? '');
}
button.addEventListener('click', async () => {
  if (busy) return;
  busy = true;
  enableButton();
  try {
    if (prepared === null) {
      show('Vorschlag wird gegen den aktuellen Git-Checkout geprüft.');
      prepared = await prepare();
      button.textContent = 'Windows Hello jetzt prüfen';
      show('Prüfe den oben angezeigten Fakt und die Aktion. Ein zweiter Klick startet Windows Hello.');
    } else {
      await authenticate(prepared);
      prepared = null;
      button.textContent = 'Erneut laden';
    }
  } catch (error) {
    prepared = null;
    button.textContent = 'Vorschlag neu laden';
    show(error?.message || 'WebAuthn-Prüfung nicht möglich.', true);
  } finally {
    busy = false;
    enableButton();
  }
});
$('ack').addEventListener('change', enableButton);
document.querySelectorAll('input[name="decision"]').forEach(input => {
  input.addEventListener('change', () => {
    prepared = null;
    button.textContent = 'Vorschlag laden';
    show('Entscheidung geändert. Bitte den aktuellen Vorschlag neu laden.');
  });
});
$('p-project').textContent = scope.projectId || '-';
$('p-branch').textContent = scope.branch || '-';
$('p-reference').textContent = scope.proposalRef || '-';
show('Lade zuerst den Vorschlag und prüfe den vollständigen Wortlaut.');
enableButton();
