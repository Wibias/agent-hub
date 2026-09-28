# Data, Model, Vector, and Embedding Security

> Source: mukul975/Anthropic-Cybersecurity-Skills
> (https://github.com/mukul975/Anthropic-Cybersecurity-Skills), Apache-2.0
> License. Adapted 2026-07-10. Drawn from
> \`detecting-data-and-model-poisoning\` and
> \`assessing-vector-and-embedding-weaknesses\`.

> **AUTHORIZED USE ONLY.** Run these checks only against datasets, models,
> vector stores, and endpoints you own or have explicit permission to assess.
> Use isolated test collections for poisoning exercises.

## Choose the Check

| Signal or risk | Start with |
|---|---|
| Untrusted checkpoint or weights | Provenance, hashes, safe serialization |
| Suspicious labels or training rows | Cleanlab label-quality scan |
| Backdoor-like model behavior | Activation clustering, spectral signatures |
| Cross-tenant retrieval | Server-side namespace isolation test |
| Corpus membership leakage | Membership inference comparison |
| Recoverable source text from vectors | Embedding inversion assessment |
| Poisoned RAG documents | Retrieval dominance and injection scanning |

## 1. Establish Provenance

Record the source, version, license, expected digest, training-data lineage, and
approval owner for every dataset and model artifact. Refuse artifacts whose
provenance cannot be reconstructed.

\`\`\`powershell
Get-FileHash -Algorithm SHA256 .\model.safetensors
\`\`\`

Compare the digest with an independently published value. Prefer
\`safetensors\` over pickle-based formats; never load an untrusted pickle merely
to inspect it.

\`\`\`python
from pathlib import Path

unsafe = []
for path in Path("models").rglob("*"):
    if path.suffix.lower() in {".pkl", ".pickle", ".joblib", ".pt", ".pth"}:
        unsafe.append(str(path))

if unsafe:
    raise SystemExit(f"Unsafe serialization formats require review: {unsafe}")
\`\`\`

## 2. Find Label and Data-Quality Anomalies

Use out-of-sample predicted probabilities. In-sample probabilities can hide
memorized poison.

\`\`\`python
from cleanlab.filter import find_label_issues

# labels: integer class labels
# pred_probs: out-of-sample probabilities, shape [rows, classes]
issue_indices = find_label_issues(
    labels=labels,
    pred_probs=pred_probs,
    return_indices_ranked_by="self_confidence",
)

for index in issue_indices[:100]:
    quarantine_for_review(index)
\`\`\`

Treat this as triage, not proof. Review provenance, duplicates, rare classes,
and annotator history before changing labels.

## 3. Detect Backdoor Clusters

Run two independent methods when possible:

- ART \`ActivationDefence\` to find suspicious activation clusters.
- ART \`SpectralSignatureDefense\` to identify outliers in learned features.
- Trigger probes using benign, owned test inputs to confirm whether a suspected
  pattern reliably changes the target prediction.

A cluster is actionable only when it is reproducible, maps to concrete samples,
and differs materially from legitimate minority-class structure.

## 4. Quarantine and Recover

1. Freeze the affected model and dataset versions.
2. Preserve hashes and minimal evidence for investigation.
3. Remove or relabel only reviewed rows.
4. Retrain from a trusted checkpoint and clean data snapshot.
5. Re-run clean accuracy, minority-class, and trigger regression tests.
6. Publish the affected versions and replacement digest.

## 5. Inventory the RAG Boundary

Document:

- embedding model and version;
- chunking and normalization rules;
- collection and namespace layout;
- server-side tenant filters;
- metadata included in responses;
- who may insert, update, and delete documents;
- retention and deletion behavior.

## 6. Test Tenant Isolation

Use two synthetic tenants and unique marker documents. Query as tenant B for
tenant A's marker. The server must reject or filter it even when the client
omits its usual filter.

\`\`\`python
hits = qdrant.search(
    collection_name="rag-test",
    query_vector=query_vector,
    query_filter=tenant_b_filter,
    limit=20,
)

assert all(hit.payload["tenant_id"] == "B" for hit in hits)
\`\`\`

Repeat through the real application API. A client-only filter is not an access
control.

## 7. Assess Membership and Inversion Risk

For membership inference, compare similarity or confidence distributions for
known members and matched non-members. A stable positive separation indicates
that corpus membership may be inferable.

For inversion, use synthetic sensitive-looking text and an isolated embedding
endpoint. Measure whether candidate reconstruction can recover distinctive
phrases. Do not test real secrets.

Mitigations include:

- return documents, not raw embeddings;
- rate-limit and authenticate embedding endpoints;
- reduce unnecessary precision and metadata;
- separate tenant collections or enforce server-side namespaces;
- avoid embedding secrets and direct identifiers.

## 8. Test Knowledge-Base Poisoning

Insert a benign marker document into an isolated test collection. Measure:

- retrieval rank across representative queries;
- whether repetition or keyword stuffing dominates trusted documents;
- whether low-trust sources are distinguishable in metadata;
- whether retrieved chunks are scanned before model ingestion.

Require source allowlists, ingestion authentication, content scanning, document
signatures where feasible, and an audit trail for corpus mutations.

## Validation

- [ ] Dataset and model provenance is complete and hashes match
- [ ] Unsafe serialization formats are blocked or reviewed in isolation
- [ ] Label-quality scan uses out-of-sample predictions
- [ ] Suspected poison is confirmed by a second method
- [ ] Clean and trigger regression tests pass after retraining
- [ ] Vector-store tenant isolation is enforced server-side
- [ ] Membership and inversion tests use synthetic data
- [ ] Corpus mutations are authenticated and audited
- [ ] Retrieved chunks are scanned as untrusted input
- [ ] Findings map to affected versions and concrete remediation
