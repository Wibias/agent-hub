"""Review-only dedicated mTLS S3 Object-Lock Seal service.

No genesis, reset, enrollment or production activation API. Requires distinct
AWS account, S3 Compliance Object Lock, KMS asymmetric signer and owner-pinned
root/genesis. CI must not launch a network listener.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import os
import re
import ssl
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import boto3
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from s3seal import SealConfig, S3SealStore, SealDenied, exact_json, pack, hex_string, ident, valid_head, digest

READ_KEYS=frozenset({'Version','Purpose','Scope','ChallengeNonce'})
CAS_KEYS=frozenset({'Version','Purpose','ChallengeNonce','TransitionId',
                    'Expected','Proposed','SignedManifestBase64'})
CONFIG_KEYS=frozenset({'Bucket','Key','ExpectedBucketOwner','Region','RootSpkiBase64',
                       'RootSpkiSha256','GenesisRecordSha256','RetentionDays',
                       'Scope','SealKeyId','KmsKeyArn','KmsSpkiSha256','Port',
                       'ServerCertificatePem','ServerPrivateKeyPem','ClientCaPem',
                       'Clients'})


def receipt_bytes(r: dict) -> bytes:
    vals=['agenthub-c9-g3-independent-seal-v1',str(r['Version']),r['SealKeyId'],
          r['Scope'],str(r['Epoch']),str(r['Revision']),r['ManifestSha256'],
          r['RootKeyId'],r['IssuerKeyId'],r['IssuerSpkiSha256'],
          'true' if r['Revoked'] else 'false',r['ChallengeNonce'],
          str(r['IssuedAtUnix']),str(r['ExpiresAtUnix'])]
    return ('\n'.join(vals)+'\n').encode('ascii')


class ServerState:
    def __init__(self, config: dict, s3=None, kms=None):
        if config.keys()!=CONFIG_KEYS or not ident(config['Scope']) or \
           not ident(config['SealKeyId']) or not isinstance(config['Port'],int) or \
           type(config['Port']) is not int or not 1024 <= config['Port'] <= 65535 or \
           not re.fullmatch(r'arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[a-zA-Z0-9-]+',config['KmsKeyArn']) or \
           not hex_string(config['KmsSpkiSha256'],64):
            raise SealDenied('CONFIG_SCHEMA')
        root=base64.b64decode(config['RootSpkiBase64'],validate=True)
        self.store=S3SealStore(s3 or boto3.client('s3',region_name=config['Region']),
            SealConfig(bucket=config['Bucket'],object_key=config['Key'],
                expected_account=config['ExpectedBucketOwner'],root_spki_der=root,
                root_pin_sha256=config['RootSpkiSha256'],
                genesis_record_sha256=config['GenesisRecordSha256'],
                retention_days=config['RetentionDays']))
        self.kms=kms or boto3.client('kms',region_name=config['Region'])
        pub=self.kms.get_public_key(KeyId=config['KmsKeyArn'])
        raw=pub['PublicKey']
        if digest(raw)!=config['KmsSpkiSha256'] or pub.get('KeyUsage')!='SIGN_VERIFY' or \
           pub.get('KeySpec')!='ECC_NIST_P256' or \
           'ECDSA_SHA_256' not in pub.get('SigningAlgorithms',[]):
            raise SealDenied('KMS_SIGNER_UNTRUSTED')
        key=serialization.load_der_public_key(raw)
        if not isinstance(key,ec.EllipticCurvePublicKey) or not isinstance(key.curve,ec.SECP256R1):
            raise SealDenied('KMS_SIGNER_CURVE')
        self.scope=config['Scope'];self.key_id=config['SealKeyId'];self.kms_arn=config['KmsKeyArn']
        self.lock=threading.Lock()
        self.clients={}
        for c in config['Clients']:
            if type(c) is not dict or c.keys()!=frozenset({'CertificateSha256','Role','Scope'}) or \
               not hex_string(c['CertificateSha256'],64) or c['Role'] not in ('reader','writer') or \
               c['Scope']!=self.scope or c['CertificateSha256'] in self.clients:
                raise SealDenied('CLIENT_POLICY_INVALID')
            self.clients[c['CertificateSha256']]=c['Role']
        if not self.clients or not any(r=='writer' for r in self.clients.values()):
            raise SealDenied('WRITER_PRINCIPAL_MISSING')
        self.store.check_bucket()
        self.config=config

    def sign_head(self, head:dict, nonce:str)->dict:
        now=int(dt.datetime.now(dt.timezone.utc).timestamp())
        r={'Version':1,'SealKeyId':self.key_id,'Scope':head['Scope'],
           'Epoch':head['Epoch'],'Revision':head['Revision'],
           'ManifestSha256':head['ManifestSha256'],'RootKeyId':head['RootKeyId'],
           'IssuerKeyId':head['IssuerKeyId'],'IssuerSpkiSha256':head['IssuerSpkiSha256'],
           'Revoked':head['Revoked'],'ChallengeNonce':nonce,
           'IssuedAtUnix':now,'ExpiresAtUnix':now+15}
        signature=self.kms.sign(KeyId=self.kms_arn,Message=receipt_bytes(r),
            MessageType='RAW',SigningAlgorithm='ECDSA_SHA_256')['Signature']
        if not 64 <= len(signature) <= 80:
            raise SealDenied('KMS_SIGNATURE_LENGTH')
        r['SignatureBase64']=base64.b64encode(signature).decode('ascii')
        return r

    def current(self, req:dict)->dict:
        if req['Version']!=1 or req['Purpose']!='G3_SEAL_READ' or \
           req['Scope']!=self.scope or not hex_string(req['ChallengeNonce'],64):
            raise SealDenied('READ_SCOPE')
        with self.lock:
            result=self.store.read_verified()
            if result.head['Scope']!=self.scope:
                raise SealDenied('CURRENT_SCOPE')
            return self.sign_head(result.head,req['ChallengeNonce'])

    def advance(self, req:dict)->dict:
        if req['Version']!=1 or req['Purpose']!='G3_SEAL_CAS' or \
           not hex_string(req['ChallengeNonce'],64) or \
           not hex_string(req['TransitionId'],32) or \
           not valid_head(req['Expected']) or not valid_head(req['Proposed']) or \
           req['Expected']['Scope']!=self.scope or req['Proposed']['Scope']!=self.scope:
            raise SealDenied('CAS_SCOPE')
        with self.lock:
            result=self.store.compare_and_seal(req['Expected'],req['Proposed'],
                req['TransitionId'],req['SignedManifestBase64'])
            return self.sign_head(result.head,req['ChallengeNonce'])


def create_handler(state:ServerState):
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'

        def do_POST(self):
            if self.path not in ('/v1/current','/v1/advance'):
                return self.respond(404)
            cert=self.connection.getpeercert(binary_form=True)
            role=state.clients.get(digest(cert)) if cert else None
            if role is None or (self.path=='/v1/advance' and role!='writer'):
                return self.respond(403)
            length=self.headers.get('Content-Length')
            if self.headers.get('Transfer-Encoding') is not None or \
               self.headers.get('Content-Type')!='application/json' or \
               length is None or not length.isascii() or not length.isdecimal() or \
               not 30 <= int(length) <= 8192:
                return self.respond(400)
            try:
                count=int(length)
                raw=self.rfile.read(count)
                if len(raw)!=count:
                    return self.respond(400)
                keys=READ_KEYS if self.path=='/v1/current' else CAS_KEYS
                req=exact_json(raw,keys,4096 if self.path=='/v1/current' else 8192)
                result=state.current(req) if self.path=='/v1/current' else state.advance(req)
                return self.respond(200,pack(result))
            except (SealDenied,ValueError,KeyError,TypeError):
                return self.respond(503)
            except Exception:
                # Any S3/KMS error or request timeout is UNKNOWN. Never issue receipt.
                return self.respond(503)

        def respond(self,code:int,body:bytes=b''):
            self.send_response(code)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.send_header('Connection','close')
            self.end_headers()
            if body:
                self.wfile.write(body)
            self.close_connection=True

        def log_message(self,fmt,*args):
            # Do not log signing material, tickets, identifiers, or request content.
            return
    return Handler


def run():
    if os.environ.get('C9_S3_SEAL_REVIEW_ENABLE')!='EXPLICIT_REVIEW_ONLY':
        raise SealDenied('DISABLED_BY_DEFAULT')
    path=os.environ.get('C9_S3_SEAL_CONFIG_PATH','')
    if not os.path.isabs(path):
        raise SealDenied('MISSING_EXTERNAL_CONFIG')
    with open(path,'rb') as f:
        cfg=exact_json(f.read(16385),CONFIG_KEYS,16384)
    state=ServerState(cfg)
    tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version=ssl.TLSVersion.TLSv1_2
    tls.verify_mode=ssl.CERT_REQUIRED
    for p in ('ServerCertificatePem','ServerPrivateKeyPem','ClientCaPem'):
        if not os.path.isabs(cfg[p]):
            raise SealDenied('UNSAFE_CERT_PATH')
    tls.load_cert_chain(cfg['ServerCertificatePem'],cfg['ServerPrivateKeyPem'])
    tls.load_verify_locations(cafile=cfg['ClientCaPem'])
    http=ThreadingHTTPServer(('0.0.0.0',cfg['Port']),create_handler(state))
    http.socket=tls.wrap_socket(http.socket,server_side=True)
    http.serve_forever()


if __name__=='__main__':
    run()
