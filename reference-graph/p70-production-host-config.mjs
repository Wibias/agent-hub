import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  P70_ENROLLED_PRODUCTION_PINS, runP70ApprovedProfile,
  verifyP70ProductionRelease,
} from './p70-production-release-gate.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const CONFIG_KEYS=[
  'schema_version','repository_sha','operator_host_id','release_envelope_path',
  'owner_public_key_path','reviewer_public_key_path','coordinator_public_key_path',
  'state_endpoint','state_read_token_path','service_key_path','witness_json_path',
];
const SHA256=/^[0-9a-f]{64}$/;
const SHA40=/^[0-9a-f]{40}$/;
const PATHS=[
  'knowledge/design-references/scripts/query-runtime.mjs',
  'knowledge/design-references/scripts/query-host-runtime.mjs',
  'reference-graph/p69-installed-off-host.mjs',
  'reference-graph/p70-production-release-gate.mjs',
  'reference-graph/p70-production-host-config.mjs',
];
function exact(o,k) {
  return !!o && typeof o==='object' && !Array.isArray(o)
    && JSON.stringify(Object.keys(o).sort())===JSON.stringify([...k].sort());
}
function file(p,max) {
  if (typeof p!=='string' || !isAbsolute(p) || p.includes('\0')
    || p.length>4096) throw Error('P70 invalid file path');
  const dest=resolve(p);
  const stat=lstatSync(dest);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size<1 || stat.size>max
    || realpathSync(dest)!==dest) throw Error('P70 untrusted local file');
  const b=readFileSync(dest);
  if (b.length!==stat.size) throw Error('P70 file changed');
  return b.toString('utf8');
}
/** Binds an owner-signed release to the actual 5 installed runtime files. */
export function computeP70InstalledRuntimeDigest({repoRoot=ROOT}={}) {
  if (typeof repoRoot!=='string' || !isAbsolute(repoRoot)) throw Error('P70 root invalid');
  const joined=PATHS.map(p=>{
    const bytes=readFileSync(join(repoRoot,p));
    return p+'\0'+createHash('sha256').update(bytes).digest('hex');
  }).join('\n');
  return createHash('sha256').update(joined).digest('hex');
}
/**
 * Called only from Standard/Deep's *actual* AgentHub query-host-runtime.
 * No private production credentials are read while the three repository
 * trust pins are not enrolled. A local P68 Lab signer is never an owner grant.
 *
 * A signed release + independent reviewer attestation is still not independent
 * proof of all #275 evidence. The owners must separately verify the evidence
 * before actually enrolling these source pins and deploying this route.
 */
export async function maybeRunP70InstalledProduction({
  configPath, records,patterns,request,now=new Date(),recordUsageEnabled=true,
  usageLogPath,recordUsageFn,
  trustedPins=P70_ENROLLED_PRODUCTION_PINS,
  activate=runP70ApprovedProfile,
  read=file, repoRoot=ROOT,
}={}) {
  try {
    if (!['standard','deep'].includes(request?.profile)
      || typeof configPath!=='string' || !isAbsolute(configPath)
      || typeof read!=='function' || typeof activate!=='function'
      || !SHA256.test(trustedPins?.owner ?? '')
      || !SHA256.test(trustedPins?.reviewer ?? '')
      || !SHA256.test(trustedPins?.coordinator ?? '')
      || new Set(Object.values(trustedPins)).size!==3) return null;
    const cfg=JSON.parse(read(configPath,8192));
    if (!exact(cfg,CONFIG_KEYS)
      || cfg.schema_version!=='reference-graph.p70-trusted-host-config.v1'
      || !SHA40.test(cfg.repository_sha??'')
      || typeof cfg.operator_host_id!=='string'
      || !/^[A-Za-z0-9_.:-]{8,128}$/.test(cfg.operator_host_id)
      || typeof cfg.state_endpoint!=='string') return null;
    const envelope=JSON.parse(read(cfg.release_envelope_path,32768));
    const ownerPem=read(cfg.owner_public_key_path,8192);
    const reviewerPem=read(cfg.reviewer_public_key_path,8192);
    const coordinatorPem=read(cfg.coordinator_public_key_path,8192);
    const approved=verifyP70ProductionRelease({
      envelope,ownerPem,ownerPin:trustedPins.owner,
      reviewerPem,reviewerPin:trustedPins.reviewer,
      expectedRepositorySha:cfg.repository_sha,
      expectedHostId:cfg.operator_host_id,
      expectedRuntimeDigest:computeP70InstalledRuntimeDigest({repoRoot}),
      requestProfile:request.profile,now,
    });
    if (!approved.authorized) return null;
    const key=read(cfg.service_key_path,4096).trim();
    const stateReadToken=read(cfg.state_read_token_path,512).trim();
    // Neither secret is sent to the user or the CLI JSON output.
    if (!/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(key)
      || !/^[A-Za-z0-9_-]{43,256}$/.test(stateReadToken)) return null;
    const witnessJson=read(cfg.witness_json_path,65536);
    if (createHash('sha256').update(witnessJson).digest('hex')
      !==approved.witness_sha256) return null;
    return await activate({
      envelope,ownerPem,ownerPin:trustedPins.owner,
      reviewerPem,reviewerPin:trustedPins.reviewer,
      expectedRepositorySha:cfg.repository_sha,
      expectedHostId:cfg.operator_host_id,
      expectedRuntimeDigest:approved.runtime_artifact_sha256,
      coordinatorPem,coordinatorPin:trustedPins.coordinator,
      stateEndpoint:cfg.state_endpoint,stateReadToken,
      serviceKey:key,getWitness:async()=>({
        json:witnessJson,sha256:approved.witness_sha256,
      }),
      records,patterns,request,requestKey:cfg.operator_host_id,now,
      recordUsageEnabled,usageLogPath,recordUsageFn,
    });
  } catch { return null; }
}
