# AgentHub C9 G3: AWS S3 Object Lock Seal V0.1 (review, no deployment)

This is the **provider-specific independent Seal storage backend** for the existing `g3-audit` service. It is not a new production deployment or a G3 sign-off. It does **not** create AWS accounts, buckets, root keys, genesis records, certificates or IAM roles automatically.

## Why this platform

Amazon S3 general-purpose bucket, **Object Lock COMPLIANCE**, versioning enabled, plus S3 `PutObject If-Match` on a *single versioned `head.json` object*. Each successful CAS creates a new WORM-protected version. The reader enumerates **every retained version**, verifies the complete SHA256-linked monotone history and the root-signed manifest for every record, checks object-level retention, denies delete markers/forks/stale latest, and compares the current `VersionId` a second time before signing. Independent first-record hash is required in external config.

A separate AWS KMS asymmetric ECC_NIST_P256 key signs only 15-second nonce-bound Seal receipts. No signing private key is exported or stored in this repository.

**Critical nuance:** Object Lock prevents deletion of protected *versions* during retention, but does not prevent publishing newer versions or delete markers. A scan of the version chain, deny-delete bucket policy, dedicated account and read-only external genesis pin are all required. This provides a bounded, retention-time WORM assumption, not absolute forever immutability or availability. If historical versions expire, become missing, or exceed the configured scan cap, the system DENIES until separately reviewed recovery. Anyone who can change the Seal code, signer, account policy or trusted pin remains a high-consequence threat.

## Exact boundaries

- `src/s3seal.py`: AWS SDK adapter with read-verify, strict signed-manifest validation and `If-Match` CAS; no genesis creator.
- `src/seal_http.py`: dedicated mTLS HTTPS server, exact `/v1/current` and `/v1/advance` schemas matching `AuditHttpBackend`, pin-authenticated certificate roles, AWS KMS signer. Disabled by default.
- `infra/aws-s3-object-lock.yaml`: **NOT APPLIED** CloudFormation with deliberately irreversible Compliance retention and signer. Operator must accept account isolation, cost and retention period before execution.
- `infra/runtime-role-policy.example.json`: narrowly scoped runtime policy. Separate management principal must control account/key/bucket policy. Do not share this role or AWS account administration with Windows Broker, Anchor, or Audit.
- `tests/test_s3seal.py`: 6 isolated contract tests using FakeS3. NOT an AWS integration test.

The seal server refuses to start without external configuration, pinned root & genesis, a dedicated AWS account ID, a valid KMS public-key pin and mTLS certificate allowlist. AWS SDK credentials must come from an off-host **role or workload identity**. No AWS access keys are supplied.

### Verification (no AWS access required)

Python 3.13, boto3 1.43.18, botocore 1.43.18, cryptography 46.0.4:

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python -m compileall -q src
```

### External provisioning gate (operator required)

1. Create or connect a **dedicated AWS account** with independent administrator/backup authority. Confirm billing ownership and desired WORM retention (default CloudFormation **3650 days**). Never apply Compliance mode without accepting non-reversibility.
2. Review `infra/aws-s3-object-lock.yaml`, scope IAM role and deployment account permissions. Run `aws sts get-caller-identity` under that operator account. Only then deploy the stack with explicit owner approval. This conversation did not do so.
3. Provision a genuinely root-signed **genesis manifest** with independent root SPKI hash and genesis record SHA256 pinned **outside** S3 and the Audit/Anchor host. An authorized separate operator must write the first S3 object using `If-None-Match: *` and confirm version retention. **No genesis enrollment script is enabled in this package.**
4. Configure Audit mTLS client identity and Seal KMS/certificate pins independently. Launch on separate controlled infrastructure, with firewall, host audit, certificate expiry/CRL and backup boundaries reviewed.
5. Run a **real, isolated AWS test**: two concurrent CAS requests, failed CAS, deleted/modified version attempted, delete marker, local restore after successful CAS, process restart and WORM-retention proof. Record AWS account, region, bucket, version IDs, object retention, observed build SHA and independently signed results. Synthetic tests do not qualify.

### No claims of production completeness

Actual AWS credentials/account, billing, CloudFormation application, KMS key, genesis, a two-host system and real WORM tests are **NOT** present. There is no authorization to execute file mutations. G3 HOLD; seven final gates 0/7; Production NO_GO. Do not merge this into the active read-only broker.
