using MemoryReviewAuthority.Core;
using Microsoft.Data.Sqlite;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MemoryReviewAuthority.Store;

/// <summary>
/// Host-owned pin for the OPERATOR'S WebAuthn credential. Importing the public
/// key is not enrollment approval, identity attestation or human consent.
/// The only importer reads a fixed file in the existing protected service
/// directory. No model-facing API receives the key, file path or credentials.
/// </summary>
public sealed record ProtectedOperatorCredential(
    PinnedCredential Credential,
    string EnrollmentState,
    long LastSignCount,
    string KeySha256,
    string StagedAtUtc,
    bool CredentialRegistrationTrusted = false,
    bool HumanApprovalVerified = false);

public sealed record ProtectedOperatorReviewOffer(
    string RequestId,
    ReviewMeaning Meaning,
    string SourceEvidenceSha256,
    string Kind,
    string SourceOrigin,
    bool HumanApprovalVerified = false,
    bool ClaimWritten = false);

public sealed partial class ProtectedPendingReviewLedger
{
    public const string OperatorCredentialFile = "operator-webauthn-credential.json";
    public const string OperatorCredentialState = "operator_pinned_unverified";
    public const string OperatorCredentialPolicy = "agenthub-operator-credential-pin-v1";
    private static readonly Regex B64Url = new(
        @"\A[A-Za-z0-9_-]+\z", RegexOptions.CultureInvariant);
    private static readonly Regex OriginPattern = new(
        @"\Ahttp://localhost:(?:[1-9][0-9]{0,4})\z",
        RegexOptions.CultureInvariant);

    private static void InitializeOperatorCredentialSchema(SqliteConnection connection)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS protected_operator_credentials (
                singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
                credential_id TEXT NOT NULL,
                public_key_pem TEXT NOT NULL,
                expected_origin TEXT NOT NULL,
                key_sha256 TEXT NOT NULL CHECK(length(key_sha256)=64),
                enrollment_state TEXT NOT NULL
                    CHECK(enrollment_state='operator_pinned_unverified'),
                last_sign_count INTEGER NOT NULL DEFAULT 0
                    CHECK(last_sign_count BETWEEN 0 AND 4294967295),
                staged_at_utc TEXT NOT NULL,
                policy_version TEXT NOT NULL CHECK(
                  policy_version='agenthub-operator-credential-pin-v1'
                )
            ) STRICT;
            CREATE TRIGGER IF NOT EXISTS deny_operator_credential_delete
              BEFORE DELETE ON protected_operator_credentials
              BEGIN SELECT RAISE(ABORT, 'operator_credential_immutable'); END;
            CREATE TRIGGER IF NOT EXISTS deny_operator_credential_replace
              BEFORE UPDATE OF credential_id, public_key_pem, expected_origin,
                key_sha256, enrollment_state, staged_at_utc, policy_version
              ON protected_operator_credentials
              BEGIN SELECT RAISE(ABORT, 'operator_credential_immutable'); END;
            """;
        cmd.ExecuteNonQuery();
    }

    private static string CanonicalB64(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > max * 2
            || !B64Url.IsMatch(value))
            throw new InvalidOperationException("operator_credential_id_invalid");
        var normalized = value.Replace('-', '+').Replace('_', '/');
        var decoded = Convert.FromBase64String(
            normalized.PadRight((normalized.Length + 3) / 4 * 4, '='));
        if (decoded.Length is < 16 or > 1024
            || Convert.ToBase64String(decoded).TrimEnd('=')
                 .Replace('+', '-').Replace('/', '_') != value)
            throw new InvalidOperationException("operator_credential_id_invalid");
        return value;
    }

    private static byte[] ValidateOperatorKey(PinnedCredential credential)
    {
        CanonicalB64(credential.CredentialIdBase64Url, 1024);
        if (credential.PublicKeyPem is not { Length: > 0 and <= 4096 }
            || !OriginPattern.IsMatch(credential.ExpectedOrigin))
            throw new InvalidOperationException("operator_credential_origin_or_key_invalid");
        var uri = new Uri(credential.ExpectedOrigin);
        if (uri.Port is < 1 or > 65535
            || uri.UserInfo.Length != 0 || uri.PathAndQuery != "/"
            || uri.Fragment.Length != 0)
            throw new InvalidOperationException("operator_credential_origin_invalid");
        try
        {
            using var ec = ECDsa.Create();
            ec.ImportFromPem(credential.PublicKeyPem);
            if (ec.ExportParameters(false).Curve.Oid.Value !=
                "1.2.840.10045.3.1.7")
                throw new InvalidOperationException("operator_credential_requires_es256");
            return ec.ExportSubjectPublicKeyInfo();
        }
        catch (CryptographicException)
        {
            throw new InvalidOperationException("operator_credential_invalid_public_key");
        }
    }

    /// <summary>
    /// A deliberately non-authorizing bootstrap. The host must have already
    /// verified service-SID DACL and admin-controlled staging ownership. A
    /// user-writable source file alone cannot be trusted as actual enrollment.
    /// </summary>
    public ProtectedOperatorCredential StageUnverifiedOperatorCredential()
    {
        EnsureOpen();
        var path = Path.Combine(_protectedDirectory, OperatorCredentialFile);
        var info = new FileInfo(path);
        if (!info.Exists || info.Length is < 32 or > 8192
            || info.Attributes.HasFlag(FileAttributes.ReparsePoint))
            throw new InvalidOperationException("operator_credential_file_missing_or_unsafe");
        using var json = JsonDocument.Parse(File.ReadAllBytes(path));
        var root = json.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || root.EnumerateObject().Count() != 4)
            throw new InvalidOperationException("operator_credential_manifest_invalid");
        static string RequiredString(JsonElement root, string property)
            => root.TryGetProperty(property, out var field)
               && field.ValueKind == JsonValueKind.String
                ? field.GetString() ?? "" : "";
        if (RequiredString(root, "protocol") != OperatorCredentialPolicy)
            throw new InvalidOperationException("operator_credential_policy_invalid");
        var pinned = new PinnedCredential(
            RequiredString(root, "credentialId"),
            RequiredString(root, "publicKeyPem"),
            RequiredString(root, "expectedOrigin"));
        var bytes = ValidateOperatorKey(pinned);
        var keySha = Convert.ToHexString(SHA256.HashData(bytes))
            .ToLowerInvariant();
        using var tx = _connection.BeginTransaction(deferred: false);
        var existing = FindOperatorCredential(tx);
        if (existing is not null)
        {
            if (existing.Credential.CredentialIdBase64Url != pinned.CredentialIdBase64Url
                || existing.Credential.PublicKeyPem != pinned.PublicKeyPem
                || existing.Credential.ExpectedOrigin != pinned.ExpectedOrigin
                || existing.KeySha256 != keySha)
                throw new InvalidOperationException("operator_credential_pin_conflict");
            tx.Commit();
            return existing;
        }
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            INSERT INTO protected_operator_credentials
            (singleton,credential_id,public_key_pem,expected_origin,key_sha256,
             enrollment_state,last_sign_count,staged_at_utc,policy_version)
            VALUES (1,$id,$key,$origin,$sha,$state,0,$when,$policy);
            """;
        cmd.Parameters.AddWithValue("$id", pinned.CredentialIdBase64Url);
        cmd.Parameters.AddWithValue("$key", pinned.PublicKeyPem);
        cmd.Parameters.AddWithValue("$origin", pinned.ExpectedOrigin);
        cmd.Parameters.AddWithValue("$sha", keySha);
        cmd.Parameters.AddWithValue("$state", OperatorCredentialState);
        cmd.Parameters.AddWithValue("$when", DateTimeOffset.UtcNow.ToString("O"));
        cmd.Parameters.AddWithValue("$policy", OperatorCredentialPolicy);
        if (cmd.ExecuteNonQuery() != 1)
            throw new InvalidOperationException("operator_credential_stage_failed");
        tx.Commit();
        return ReadOperatorCredential()
            ?? throw new InvalidOperationException("operator_credential_stage_incomplete");
    }

    private ProtectedOperatorCredential? FindOperatorCredential(SqliteTransaction? tx)
    {
        using var cmd = _connection.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = """
            SELECT credential_id, public_key_pem, expected_origin, key_sha256,
              enrollment_state, last_sign_count, staged_at_utc, policy_version
            FROM protected_operator_credentials WHERE singleton=1;
            """;
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) return null;
        if (reader.GetString(7) != OperatorCredentialPolicy
            || reader.GetString(4) != OperatorCredentialState)
            throw new InvalidOperationException("unrecognized_operator_credential_policy");
        var pinned = new PinnedCredential(reader.GetString(0),
            reader.GetString(1), reader.GetString(2));
        var actualSha = Convert.ToHexString(SHA256.HashData(
            ValidateOperatorKey(pinned))).ToLowerInvariant();
        if (actualSha != reader.GetString(3))
            throw new InvalidOperationException("operator_credential_integrity_invalid");
        var record = new ProtectedOperatorCredential(
            pinned, reader.GetString(4), reader.GetInt64(5),
            actualSha, reader.GetString(6));
        if (reader.Read())
            throw new InvalidOperationException("duplicate_operator_credential");
        return record;
    }

    public ProtectedOperatorCredential? ReadOperatorCredential()
    {
        EnsureOpen();
        return FindOperatorCredential(null);
    }

    /// <summary>
    /// Service-owned exact display object, resolved by protected pending
    /// request and immutable source. No fact, action, Git revision or hash
    /// comes from any browser/IPC caller. No model-facing public pipe can
    /// access this projection, only the explicitly Admin-ACL operator pipe.
    /// </summary>
    public ProtectedOperatorReviewOffer? ReadOperatorReviewOffer(
        string projectId, string branch, string proposalRef)
    {
        EnsureOpen();
        var pending = ReadPending(projectId, branch, proposalRef);
        if (pending is null) return null;
        var source = FindServiceOwnedSource(pending.RequestId, null);
        if (source is null || source.SourceOrigin != OperatorSourceOrigin)
            return null;
        ValidateSource(pending.Review, source.Source);
        var p = pending.Review;
        return new ProtectedOperatorReviewOffer(
            pending.RequestId,
            new ReviewMeaning(p.ProjectId, p.Branch, p.RevisionSha,
                p.ProposalRef, p.ReviewSnapshotSha256, p.CanonicalFactSha256,
                p.RequestedAction, source.Source.CanonicalFact),
            p.SourceEvidenceSha256,
            source.Source.Kind,
            source.SourceOrigin);
    }

    /// <summary>
    /// Persist a successful hardware-OR-software WebAuthn UV PROBE against an
    /// imported real E~ source. NO intent, approval or Claim is ever created.
    /// The public key is independently read from protected SQLite, never from
    /// the incoming assertion or model. Nonzero sign counters are monotonic
    /// across restarts; zero counters do not establish anti-clone protection.
    /// </summary>
    internal void RecordOperatorCredentialProof(
        ReviewMeaning meaning, PinnedCredential pinned, VerificationResult proof)
    {
        EnsureOpen();
        if (!proof.Verified || !proof.UserPresent || !proof.UserVerified
            || proof.ApprovedReviewDecision || proof.ClaimWritten)
            throw new InvalidOperationException("operator_proof_not_verified");
        using var tx = _connection.BeginTransaction(deferred: false);
        var credential = FindOperatorCredential(tx)
            ?? throw new InvalidOperationException("operator_credential_not_staged");
        if (credential.Credential != pinned)
            throw new InvalidOperationException("operator_credential_mismatch");
        var pending = Lookup(meaning.ProjectId, meaning.Branch,
            meaning.ProposalRef, tx);
        if (pending is null || pending.Status != PendingState
            || pending.Review.RevisionSha != meaning.RevisionSha
            || pending.Review.ReviewSnapshotSha256 != meaning.ReviewSnapshotSha256
            || pending.Review.CanonicalFactSha256 != meaning.CanonicalFactSha256
            || pending.Review.RequestedAction != meaning.Decision
            || Hash(meaning.CanonicalFact) != meaning.CanonicalFactSha256
            || FindVerifiedIntent(pending.RequestId, tx) is not null)
            throw new InvalidOperationException("operator_review_context_changed");
        var origin = FindServiceOwnedSource(pending.RequestId, tx);
        if (origin is null || origin.SourceOrigin != OperatorSourceOrigin
            || origin.Source.CanonicalFact != meaning.CanonicalFact)
            throw new InvalidOperationException("operator_evidence_not_staged");
        if (proof.SignCount > 0 && credential.LastSignCount > 0
            && proof.SignCount <= credential.LastSignCount)
            throw new InvalidOperationException("operator_counter_replay");
        if (proof.SignCount > credential.LastSignCount)
        {
            using var update = _connection.CreateCommand();
            update.Transaction = tx;
            update.CommandText = """
                UPDATE protected_operator_credentials
                SET last_sign_count=$counter
                WHERE singleton=1 AND last_sign_count=$previous;
                """;
            update.Parameters.AddWithValue("$counter", (long)proof.SignCount);
            update.Parameters.AddWithValue("$previous", credential.LastSignCount);
            if (update.ExecuteNonQuery() != 1)
                throw new InvalidOperationException("operator_counter_conflict");
        }
        tx.Commit();
    }
}
