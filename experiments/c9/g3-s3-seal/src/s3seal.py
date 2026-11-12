"""Review-only AWS S3 Compliance Object Lock + If-Match seal backend.

No account provisioning, genesis/reset, secrets, or service startup in this module.
All S3 calls require an explicitly pinned expected bucket owner. Fail closed.
"""
from __future__ import annotations

import base64
import binascii
import datetime as dt
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.exceptions import InvalidSignature


class SealDenied(Exception):
    """No current trustworthy state, or an unauthorized/unsafe transition."""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def exact_json(data: bytes, fields: frozenset[str], max_size: int) -> dict:
    if not 2 <= len(data) <= max_size:
        raise SealDenied('JSON_SIZE')

    def unique(pairs):
        d = {}
        for k, v in pairs:
            if k in d:
                raise SealDenied('DUPLICATE_JSON_FIELD')
            d[k] = v
        return d

    try:
        obj = json.loads(data.decode('utf-8', errors='strict'), object_pairs_hook=unique,
                         parse_constant=lambda x: (_ for _ in ()).throw(SealDenied('NONFINITE_JSON')))
    except (UnicodeError, json.JSONDecodeError, ValueError, RecursionError) as ex:
        raise SealDenied('INVALID_JSON') from ex
    if type(obj) is not dict or obj.keys() != fields:
        raise SealDenied('JSON_SCHEMA')
    return obj


def pack(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode('ascii')


def ident(s: Any, limit: int = 120) -> bool:
    return type(s) is str and 0 < len(s) <= limit and re.fullmatch(r'[a-zA-Z0-9._:\-]+', s) is not None


def hex_string(s: Any, width: int) -> bool:
    return type(s) is str and len(s) == width and re.fullmatch('[0-9a-f]+', s) is not None


def b64_exact(s: Any, lo: int, hi: int) -> bytes:
    if type(s) is not str or len(s) > (hi + 2) // 3 * 4:
        raise SealDenied('INVALID_BASE64')
    try:
        b = base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError) as ex:
        raise SealDenied('INVALID_BASE64') from ex
    if not lo <= len(b) <= hi or base64.b64encode(b).decode('ascii') != s:
        raise SealDenied('INVALID_BASE64')
    return b


HEAD_KEYS = frozenset({'Scope', 'Epoch', 'Revision', 'ManifestSha256', 'RootKeyId',
                       'IssuerKeyId', 'IssuerSpkiSha256', 'Revoked'})
MANIFEST_KEYS = frozenset({'Version', 'RootKeyId', 'Revision', 'IssuerKeyId',
                           'IssuerPublicKeySpkiBase64', 'IssuerSpkiSha256',
                           'KeyState', 'NotBeforeUnix', 'ExpiresUnix', 'SignatureBase64'})
RECORD_KEYS = frozenset({'Version', 'Head', 'PrevSha256', 'TransitionId',
                          'SignedManifestBase64', 'CommittedUnix'})


def valid_head(h: Any) -> bool:
    return type(h) is dict and h.keys() == HEAD_KEYS and ident(h['Scope']) and \
        type(h['Epoch']) is int and h['Epoch'] > 0 and \
        type(h['Revision']) is int and h['Revision'] > 0 and \
        hex_string(h['ManifestSha256'], 64) and ident(h['RootKeyId']) and \
        ident(h['IssuerKeyId']) and hex_string(h['IssuerSpkiSha256'], 64) and \
        type(h['Revoked']) is bool


def canonical_manifest(m: dict) -> bytes:
    fields = ['agenthub-c9-trust-manifest-v1', str(m['Version']), m['RootKeyId'],
              str(m['Revision']), m['IssuerKeyId'], m['IssuerPublicKeySpkiBase64'],
              m['IssuerSpkiSha256'], m['KeyState'], str(m['NotBeforeUnix']), str(m['ExpiresUnix'])]
    return ('\n'.join(fields) + '\n').encode('ascii')


def verify_manifest(raw_b64: str, head: dict, root_spki_der: bytes, expected_root_pin: str,
                    committed: int) -> None:
    if not valid_head(head) or not hex_string(expected_root_pin, 64) or digest(root_spki_der) != expected_root_pin:
        raise SealDenied('ROOT_OR_HEAD_PIN')
    raw = b64_exact(raw_b64, 300, 4096)
    m = exact_json(raw, MANIFEST_KEYS, 4096)
    if type(m['Version']) is not int or m['Version'] != 1 or \
       type(m['Revision']) is not int or m['Revision'] != head['Revision'] or \
       m['RootKeyId'] != head['RootKeyId'] or m['IssuerKeyId'] != head['IssuerKeyId'] or \
       not ident(m['IssuerKeyId'], 80) or m['IssuerKeyId'] == m['RootKeyId'] or \
       m['KeyState'] not in ('active', 'revoked') or \
       (m['KeyState'] == 'revoked') != head['Revoked'] or \
       not hex_string(m['IssuerSpkiSha256'], 64) or \
       head['IssuerSpkiSha256'] != m['IssuerSpkiSha256']:
        raise SealDenied('MANIFEST_SCOPE')
    before, expires = m['NotBeforeUnix'], m['ExpiresUnix']
    if type(before) is not int or type(expires) is not int or \
       before < 1577836800 or expires > 4102444800 or \
       expires <= before or expires-before > 30*86400 or \
       not before <= committed < expires:
        raise SealDenied('MANIFEST_TIME')
    issuer_spki = b64_exact(m['IssuerPublicKeySpkiBase64'], 60, 256)
    if digest(issuer_spki) != m['IssuerSpkiSha256'] or digest(issuer_spki) == expected_root_pin:
        raise SealDenied('ISSUER_PIN')
    try:
        issuer_pub = serialization.load_der_public_key(issuer_spki)
        root_pub = serialization.load_der_public_key(root_spki_der)
        if not isinstance(root_pub, ec.EllipticCurvePublicKey) or \
           not isinstance(issuer_pub, ec.EllipticCurvePublicKey) or \
           not isinstance(root_pub.curve, ec.SECP256R1) or \
           not isinstance(issuer_pub.curve, ec.SECP256R1):
            raise SealDenied('CURVE_DENIED')
        signature = b64_exact(m['SignatureBase64'], 64, 80)
        root_pub.verify(signature, canonical_manifest(m), ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError, TypeError) as ex:
        raise SealDenied('ROOT_SIGNATURE_INVALID') from ex
    except UnicodeEncodeError as ex:
        raise SealDenied('MANIFEST_ASCII') from ex
    if digest(canonical_manifest(m)) != head['ManifestSha256']:
        raise SealDenied('MANIFEST_HASH')


@dataclass(frozen=True)
class SealConfig:
    bucket: str
    object_key: str
    expected_account: str
    root_spki_der: bytes
    root_pin_sha256: str
    genesis_record_sha256: str
    retention_days: int = 365
    max_versions: int = 512

    def __post_init__(self):
        if not re.fullmatch('[0-9]{12}', self.expected_account) or not \
           re.fullmatch(r'[a-z0-9.\-]{3,63}', self.bucket) or \
           not self.object_key.startswith('c9-g3/seal/') or \
           self.object_key.endswith('/') or len(self.object_key) > 220 or \
           not hex_string(self.root_pin_sha256,64) or \
           not hex_string(self.genesis_record_sha256,64) or \
           digest(self.root_spki_der) != self.root_pin_sha256 or \
           self.retention_days < 365 or not 1 <= self.max_versions <= 2048:
            raise SealDenied('UNSAFE_STORAGE_CONFIG')


@dataclass(frozen=True)
class ReadResult:
    head: dict
    etag: str
    version_id: str
    raw_sha256: str
    revoked_ids: frozenset[str]
    revoked_pins: frozenset[str]


class S3SealStore:
    """Full-history S3 Object Lock compliance scan, with one-key optimistic CAS."""

    def __init__(self, client, cfg: SealConfig):
        self.s3, self.cfg = client, cfg

    def check_bucket(self) -> None:
        cfg = self.cfg
        own = {'Bucket':cfg.bucket, 'ExpectedBucketOwner':cfg.expected_account}
        try:
            if self.s3.get_bucket_versioning(**own).get('Status') != 'Enabled':
                raise SealDenied('VERSIONING_NOT_ENABLED')
            lock = self.s3.get_object_lock_configuration(**own)['ObjectLockConfiguration']
            rule = lock.get('Rule',{}).get('DefaultRetention',{})
            if lock.get('ObjectLockEnabled') != 'Enabled' or \
               rule.get('Mode') != 'COMPLIANCE' or \
               rule.get('Days',0) < cfg.retention_days:
                raise SealDenied('COMPLIANCE_DEFAULT_MISSING')
        except (KeyError, TypeError) as ex:
            raise SealDenied('INVALID_BUCKET_CONFIGURATION') from ex

    def _versions(self) -> list[dict]:
        cfg=self.cfg
        kwargs = {'Bucket':cfg.bucket, 'Prefix':cfg.object_key,
                  'ExpectedBucketOwner':cfg.expected_account, 'MaxKeys':1000}
        versions=[]
        for _ in range(4):
            r=self.s3.list_object_versions(**kwargs)
            if any(m['Key']==cfg.object_key for m in r.get('DeleteMarkers',[])):
                raise SealDenied('DELETE_MARKER_PRESENT')
            versions.extend(v for v in r.get('Versions',[]) if v['Key']==cfg.object_key)
            if len(versions)>cfg.max_versions:
                raise SealDenied('VERSION_HISTORY_LIMIT')
            if not r.get('IsTruncated'):
                return versions
            if not r.get('NextKeyMarker'):
                raise SealDenied('INVALID_PAGINATION')
            kwargs['KeyMarker']=r['NextKeyMarker']
            kwargs['VersionIdMarker']=r.get('NextVersionIdMarker','')
        raise SealDenied('VERSION_PAGINATION_LIMIT')

    def read_verified(self) -> ReadResult:
        self.check_bucket()
        cfg=self.cfg
        versions=self._versions()
        if not versions or sum(v.get('IsLatest') is True for v in versions)!=1:
            raise SealDenied('NO_UNIQUE_CURRENT_VERSION')
        seen_versions=set(); by_hash={}
        latest=None
        now=dt.datetime.now(dt.timezone.utc)
        for v in versions:
            vid=v.get('VersionId')
            if type(vid) is not str or not vid or vid=='null' or vid in seen_versions:
                raise SealDenied('VERSION_ID_INVALID')
            seen_versions.add(vid)
            args={'Bucket':cfg.bucket,'Key':cfg.object_key,'VersionId':vid,
                  'ExpectedBucketOwner':cfg.expected_account}
            r=self.s3.get_object(**args)
            raw=r['Body'].read(8193)
            if len(raw)>8192 or not raw:
                raise SealDenied('RECORD_TOO_LARGE')
            if r.get('VersionId')!=vid:
                raise SealDenied('RECORD_VERSION_MISMATCH')
            retention=self.s3.get_object_retention(**args).get('Retention',{})
            until=retention.get('RetainUntilDate')
            if retention.get('Mode')!='COMPLIANCE' or not isinstance(until,dt.datetime) or \
               until.tzinfo is None or until <= now+dt.timedelta(seconds=60):
                raise SealDenied('VERSION_NOT_IMMUTABLE')
            rec=exact_json(raw,RECORD_KEYS,8192)
            if type(rec['Version']) is not int or rec['Version']!=1 or \
               not valid_head(rec['Head']) or \
               not hex_string(rec['PrevSha256'],64) or \
               not hex_string(rec['TransitionId'],32) or \
               type(rec['CommittedUnix']) is not int or \
               rec['CommittedUnix'] < 1577836800:
                raise SealDenied('RECORD_SCHEMA')
            verify_manifest(rec['SignedManifestBase64'],rec['Head'],cfg.root_spki_der,
                            cfg.root_pin_sha256,rec['CommittedUnix'])
            if pack(rec)!=raw:
                raise SealDenied('NONCANONICAL_RECORD')
            sha=digest(raw)
            if sha in by_hash:
                raise SealDenied('RECORD_HASH_COLLISION')
            by_hash[sha]=(rec,v)
            if v.get('IsLatest') is True:
                latest=(sha,rec,v)
        if latest is None:
            raise SealDenied('NO_LATEST')
        current_sha,rec,v=latest
        # Strict full chain: every retained version belongs to exactly one linked lineage.
        # Replaying a historical version as latest, forks, gaps, or orphan updates DENY.
        used=set()
        while True:
            if current_sha in used or current_sha not in by_hash:
                raise SealDenied('HISTORY_LINK_BROKEN')
            used.add(current_sha)
            record,_=by_hash[current_sha]
            head=record['Head']
            prev=record['PrevSha256']
            if head['Revision']==1:
                if prev!='0'*64 or current_sha!=cfg.genesis_record_sha256 or head['Epoch']!=1:
                    raise SealDenied('GENESIS_MISMATCH')
                break
            if prev not in by_hash:
                raise SealDenied('HISTORY_MISSING_PREVIOUS')
            p=by_hash[prev][0]['Head']
            if head['Revision']!=p['Revision']+1 or head['Epoch']!=p['Epoch'] or \
               head['Scope']!=p['Scope'] or head['RootKeyId']!=p['RootKeyId']:
                raise SealDenied('HISTORY_NONMONOTONIC')
            if p['Revoked'] and not head['Revoked'] and \
               (head['IssuerKeyId']==p['IssuerKeyId'] or head['IssuerSpkiSha256']==p['IssuerSpkiSha256']):
                raise SealDenied('REVOKED_KEY_REACTIVATED')
            current_sha=prev
        if len(used)!=len(by_hash):
            raise SealDenied('HISTORY_FORK_OR_ROLLBACK')
        # Traverse chronologically so a revoked ID or public key cannot be
        # resurrected several rotations later, not just in the next revision.
        history=[]
        h=latest[0]
        while True:
            record=by_hash[h][0]
            history.append(record['Head'])
            if record['Head']['Revision']==1:
                break
            h=record['PrevSha256']
        revoked_ids=set();revoked_pins=set()
        for h in reversed(history):
            if not h['Revoked'] and (h['IssuerKeyId'] in revoked_ids or
                                      h['IssuerSpkiSha256'] in revoked_pins):
                raise SealDenied('HISTORIC_REVOKED_KEY_REUSED')
            if h['Revoked']:
                revoked_ids.add(h['IssuerKeyId'])
                revoked_pins.add(h['IssuerSpkiSha256'])
        # A second latest retrieval narrows, but cannot completely remove, a concurrent-update race.
        current=self.s3.head_object(Bucket=cfg.bucket,Key=cfg.object_key,
                                   ExpectedBucketOwner=cfg.expected_account)
        if current.get('VersionId')!=v['VersionId'] or current.get('ETag')!=v.get('ETag'):
            raise SealDenied('CURRENT_CHANGED_DURING_SCAN')
        return ReadResult(rec['Head'],v['ETag'],v['VersionId'],digest(pack(rec)),
                          frozenset(revoked_ids),frozenset(revoked_pins))

    def compare_and_seal(self,expected:dict,proposed:dict,transition_id:str,
                         signed_manifest_base64:str) -> ReadResult:
        cfg=self.cfg
        if not valid_head(expected) or not valid_head(proposed) or \
           not hex_string(transition_id,32) or \
           expected['Scope']!=proposed['Scope'] or \
           proposed['RootKeyId']!=expected['RootKeyId'] or \
           proposed['Epoch']!=expected['Epoch'] or \
           proposed['Revision']!=expected['Revision']+1:
            raise SealDenied('INVALID_CAS_SCOPE_OR_REVISION')
        current=self.read_verified()
        if current.head!=expected:
            raise SealDenied('CAS_MISMATCH')
        if proposed['Revoked'] and (proposed['IssuerKeyId']!=expected['IssuerKeyId'] or
                                    proposed['IssuerSpkiSha256']!=expected['IssuerSpkiSha256']):
            raise SealDenied('REVOCATION_MUST_TARGET_EXISTING_KEY')
        if not proposed['Revoked'] and (proposed['IssuerKeyId'] in current.revoked_ids or
                                       proposed['IssuerSpkiSha256'] in current.revoked_pins):
            raise SealDenied('HISTORIC_REVOKED_KEY_REUSED')
        # Archive a root-signed exact proposed state; verified independently of Audit caller.
        committed=int(dt.datetime.now(dt.timezone.utc).timestamp())
        verify_manifest(signed_manifest_base64,proposed,cfg.root_spki_der,
                        cfg.root_pin_sha256,committed)
        rec={'Version':1,'Head':proposed,'PrevSha256':current.raw_sha256,
             'TransitionId':transition_id,'SignedManifestBase64':signed_manifest_base64,
             'CommittedUnix':committed}
        raw=pack(rec)
        if len(raw)>8192:
            raise SealDenied('NEW_RECORD_TOO_LARGE')
        try:
            # One S3 PutObject is the atomic CAS + retained immutable version.
            # Any exception/timeout is UNKNOWN to the caller, never an automatic retry.
            self.s3.put_object(Bucket=cfg.bucket,Key=cfg.object_key,
                ExpectedBucketOwner=cfg.expected_account,IfMatch=current.etag,
                Body=raw,ContentType='application/json',
                ChecksumSHA256=base64.b64encode(hashlib.sha256(raw).digest()).decode('ascii'),
                ObjectLockMode='COMPLIANCE',
                ObjectLockRetainUntilDate=dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=cfg.retention_days))
        except Exception as ex:
            raise SealDenied('CAS_RESULT_UNKNOWN_OR_CONFLICT') from ex
        actual=self.read_verified()
        if actual.head!=proposed or actual.raw_sha256!=digest(raw):
            raise SealDenied('CAS_POSTFLIGHT_MISMATCH')
        return actual
