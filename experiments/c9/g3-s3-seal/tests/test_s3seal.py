"""Focused contract-level checks. FakeS3 is not a live AWS/WORM acceptance test."""
import base64
import datetime as dt
import hashlib
import io
import json
import sys
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from s3seal import (S3SealStore, SealConfig, SealDenied, digest,pack,canonical_manifest,
                    exact_json,HEAD_KEYS,RECORD_KEYS)


class FakeS3:
    def __init__(self):
        self.items=[]
        self.mode='COMPLIANCE'
        self.delete_marker=False
        self.bucket_enabled=True

    def get_bucket_versioning(self, **kw):
        return {'Status':'Enabled' if self.bucket_enabled else 'Suspended'}

    def get_object_lock_configuration(self,**kw):
        return {'ObjectLockConfiguration':{'ObjectLockEnabled':'Enabled',
                    'Rule':{'DefaultRetention':{'Mode':'COMPLIANCE','Days':365}}}}

    def put(self, b:bytes):
        ver=str(len(self.items)+1)
        self.items.append((ver,b,'"'+hashlib.md5(b).hexdigest()+'"'))
        return ver

    def put_object(self,**kw):
        if kw['IfMatch']!=self.items[-1][2]:
            raise RuntimeError('412 Precondition Failed')
        self.put(kw['Body'])
        return {'VersionId':self.items[-1][0]}

    def list_object_versions(self,**kw):
        return {'Versions':[{'Key':kw['Prefix'],'VersionId':v,'ETag':etag,'IsLatest':idx==len(self.items)-1}
                            for idx,(v,_,etag) in enumerate(self.items)],
                'DeleteMarkers':[{'Key':kw['Prefix']} ] if self.delete_marker else [],
                'IsTruncated':False}

    def get_object(self,**kw):
        item=next((x for x in self.items if x[0]==kw['VersionId']),None)
        if item is None:
            raise RuntimeError('no object')
        return {'Body':io.BytesIO(item[1]),'VersionId':item[0]}

    def get_object_retention(self,**kw):
        return {'Retention':{'Mode':self.mode,
          'RetainUntilDate':dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=350)}}

    def head_object(self,**kw):
        v,_,etag=self.items[-1]
        return {'VersionId':v,'ETag':etag}


class SealTest(unittest.TestCase):
    def setUp(self):
        self.root=ec.generate_private_key(ec.SECP256R1())
        self.spki=self.root.public_key().public_bytes(serialization.Encoding.DER,
                  serialization.PublicFormat.SubjectPublicKeyInfo)
        self.issuer_a=ec.generate_private_key(ec.SECP256R1())
        self.issuer_b=ec.generate_private_key(ec.SECP256R1())
        self.now=int(dt.datetime.now(dt.timezone.utc).timestamp())
        self.s3=FakeS3()
        self.genesis_head, gen_manifest=self.new_state(1,self.issuer_a,'issuer-a')
        genesis={'Version':1,'Head':self.genesis_head,'PrevSha256':'0'*64,
                'TransitionId':'1'*32,'SignedManifestBase64':gen_manifest,
                'CommittedUnix':self.now}
        self.s3.put(pack(genesis))
        self.cfg=SealConfig('c9-g3-review-bucket','c9-g3/seal/instance-a/head.json',
                            '123456789012',self.spki,digest(self.spki),digest(pack(genesis)))
        self.store=S3SealStore(self.s3,self.cfg)

    def new_state(self,revision,issuer,key_id,state='active'):
        spki=issuer.public_key().public_bytes(serialization.Encoding.DER,
                  serialization.PublicFormat.SubjectPublicKeyInfo)
        m={'Version':1,'RootKeyId':'root-a','Revision':revision,
           'IssuerKeyId':key_id,'IssuerPublicKeySpkiBase64':base64.b64encode(spki).decode(),
           'IssuerSpkiSha256':digest(spki),'KeyState':state,
           'NotBeforeUnix':self.now-100,'ExpiresUnix':self.now+3600,'SignatureBase64':''}
        signature=self.root.sign(canonical_manifest(m),ec.ECDSA(hashes.SHA256()))
        m['SignatureBase64']=base64.b64encode(signature).decode()
        head={'Scope':'instance-a','Epoch':1,'Revision':revision,
              'ManifestSha256':digest(canonical_manifest(m)),
              'RootKeyId':'root-a','IssuerKeyId':key_id,
              'IssuerSpkiSha256':digest(spki),'Revoked':state=='revoked'}
        return head,base64.b64encode(pack(m)).decode()

    def test_valid_genesis_and_cas(self):
        self.assertEqual(1,self.store.read_verified().head['Revision'])
        h2,m2=self.new_state(2,self.issuer_b,'issuer-b')
        result=self.store.compare_and_seal(self.genesis_head,h2,'2'*32,m2)
        self.assertEqual(2,result.head['Revision'])
        self.assertEqual(2,len(self.s3.items))

    def test_stale_cas_denied(self):
        h2,m2=self.new_state(2,self.issuer_b,'issuer-b')
        self.store.compare_and_seal(self.genesis_head,h2,'2'*32,m2)
        with self.assertRaises(SealDenied):
            self.store.compare_and_seal(self.genesis_head,h2,'3'*32,m2)

    def test_replayed_latest_or_deleted_version_denied(self):
        h2,m2=self.new_state(2,self.issuer_b,'issuer-b')
        self.store.compare_and_seal(self.genesis_head,h2,'2'*32,m2)
        self.s3.put(self.s3.items[0][1])
        with self.assertRaises(SealDenied):self.store.read_verified()
        self.s3.items.pop()
        self.s3.items.pop(0)
        with self.assertRaises(SealDenied):self.store.read_verified()

    def test_delete_marker_or_noncompliance_denied(self):
        self.s3.delete_marker=True
        with self.assertRaises(SealDenied):self.store.read_verified()
        self.s3.delete_marker=False;self.s3.mode='GOVERNANCE'
        with self.assertRaises(SealDenied):self.store.read_verified()
        self.s3.mode='COMPLIANCE';self.s3.bucket_enabled=False
        with self.assertRaises(SealDenied):self.store.read_verified()

    def test_forged_root_manifest_denied(self):
        h2,m2=self.new_state(2,self.issuer_b,'issuer-b')
        m=json.loads(base64.b64decode(m2))
        m['IssuerKeyId']='forged'
        forged=base64.b64encode(pack(m)).decode()
        with self.assertRaises(SealDenied):
            self.store.compare_and_seal(self.genesis_head,h2,'2'*32,forged)

    def test_revoked_key_cannot_reappear_after_intervening_rotation(self):
        revoked,m2=self.new_state(2,self.issuer_a,'issuer-a','revoked')
        self.store.compare_and_seal(self.genesis_head,revoked,'2'*32,m2)
        rotated,m3=self.new_state(3,self.issuer_b,'issuer-b')
        self.store.compare_and_seal(revoked,rotated,'3'*32,m3)
        restored,m4=self.new_state(4,self.issuer_a,'issuer-a')
        with self.assertRaises(SealDenied):
            self.store.compare_and_seal(rotated,restored,'4'*32,m4)
        self.assertEqual(3,len(self.s3.items))

    def test_record_has_no_unknown_or_duplicate_members(self):
        with self.assertRaises(SealDenied):
            exact_json(b'{"Version":1,"Version":2}',RECORD_KEYS,8192)
        with self.assertRaises(SealDenied):
            exact_json(b'{}',RECORD_KEYS,8192)


if __name__=='__main__':unittest.main()
