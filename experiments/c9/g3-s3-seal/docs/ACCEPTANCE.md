# C9 G3 S3 Seal acceptance ledger

Source: independent AWS S3 Object Lock Compliance backend, implemented for review on 2026-11-12.

| Claim | Evidence/status |
| --- | --- |
| AWS Object Lock Compliance protects object versions | AWS S3 official user guide; vendor property, **not yet verified in user's account** |
| AWS PutObject If-Match supports CAS | AWS S3 official conditional writes guide; vendor property, **not yet exercised against live account** |
| Previous versions remain immutable for retention | Designed verification checks every version's retention; no real bucket evidence |
| Conflicting, stale or rolled-back latest fails closed | Focused in-memory FakeS3 tests, **not proof of real AWS behavior** |
| Independent S3 account, IAM, KMS signing, signed genesis | **NOT PROVISIONED** |
| HTTPS mTLS in real separate host | Source only, **NOT STARTED or acceptance tested** |
| Two-host crash and rollback acceptance | **NOT EXECUTED** |
| Security gates / production | G3 HOLD, 0/7, NO_GO |

Cautions: Object Lock cannot block newer object versions or delete markers. Atomic latest-version CAS + cryptographically checked full history is required. Explicitly deny `s3:DeleteObject` and `s3:DeleteObjectVersion` in the service policy, and restrict account ownership. Retention eventually expires; continued service requires a separately accepted period-extension/recovery strategy before first expiry.

AWS authoritative references:
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/DeletingObjectVersions.html
- https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html
