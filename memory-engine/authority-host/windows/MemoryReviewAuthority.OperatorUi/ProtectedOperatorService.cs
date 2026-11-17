using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace MemoryReviewAuthority.OperatorUi;

internal sealed record ServiceOffer(
    string RequestId,
    string TicketId,
    string Challenge,
    string CredentialId,
    string ExpectedOrigin,
    DateTimeOffset ExpiresUtc,
    string ProjectId,
    string Branch,
    string RevisionSha,
    string ProposalRef,
    string ReviewSnapshotSha256,
    string CanonicalFactSha256,
    string SourceEvidenceSha256,
    string SourceOrigin,
    string Kind,
    string Decision,
    string CanonicalFact);

internal sealed record RegistrationOffer(
    string RequestId, string TicketId, string Challenge, string UserId,
    string ExpectedOrigin, string RpId, DateTimeOffset ExpiresUtc,
    string ProjectId, string Branch, string ProposalRef,
    string RevisionSha, string SnapshotSha256, string FactSha256,
    string EvidenceSha256, string Kind, string SourceOrigin,
    string Decision, string CanonicalFact);

internal sealed record NativeRegistrationData(
    string ClientDataJSON, string AuthenticatorData, string CredentialId);

internal sealed record NativeAssertion(
    string CredentialId,
    string Type,
    string ClientDataJSON,
    string AuthenticatorData,
    string Signature);

internal sealed record OperatorReceipt(bool Verified, string Status, string? ClaimId = null);

/// <summary>
/// Same existing Windows Service lab. Operator pipe is admin / exact SCM SID
/// only. The corresponding signing public key MUST come from the existing
/// Administrator-owned public pin path, never an IPC response, model argument
/// or a user-selected file. NO access to the protected SQLite from this UI.
/// </summary>
internal static class ProtectedOperatorService
{
    private const string PipeName = "AgentHubMemoryReviewLab-OperatorV1";
    private const string Protocol = "agenthub-operator-uv-service-v1";
    private const string PublicPinDirectory = "AgentHubMemoryReviewLab-Public";
    private const string PublicPinFile = "review-service-signing-key.pub.pem";
    private static readonly Regex Scope = new(
        @"\A[A-Za-z0-9._:/~-]{1,256}\z", RegexOptions.CultureInvariant);
    private static readonly Regex Ref = new(
        @"\AE~[a-f0-9]{10}\z", RegexOptions.CultureInvariant);
    private static readonly Regex Hex40 = new(
        @"\A[0-9a-f]{40}\z", RegexOptions.CultureInvariant);
    private static readonly Regex Hex64 = new(
        @"\A[0-9a-f]{64}\z", RegexOptions.CultureInvariant);
    private static readonly Regex Base64Url = new(
        @"\A[A-Za-z0-9_-]+\z", RegexOptions.CultureInvariant);
    private static readonly Encoding Utf8 = new UTF8Encoding(false, true);

    private static string PinPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        PublicPinDirectory, PublicPinFile);

    /// <summary>
    /// The actual INTERACTIVE Windows Hello window must never be elevated
    /// from a user/agent-writable checkout. The only supported location is
    /// the pinned local preview installation's Admin-owned sealed binary.
    /// Contract/SCM smoke tests do not issue Hello and bypass this guard
    /// only because they have no interactive/authorizing action.
    /// </summary>
    internal static void RequireProtectedInteractiveExecutable()
    {
        var programData = Environment.GetFolderPath(
            Environment.SpecialFolder.CommonApplicationData);
        var root = Path.Combine(programData, "AgentHubMemoryReviewLab-PreviewApp");
        var directory = Path.Combine(root, "Operator");
        var expected = Path.Combine(directory,
            "MemoryReviewAuthority.OperatorUi.exe");
        if (!OperatingSystem.IsWindows() || Environment.ProcessPath is null
            || !string.Equals(Path.GetFullPath(Environment.ProcessPath),
                Path.GetFullPath(expected), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "Native Windows-Hello-Oberfläche darf nicht aus einem Git-Checkout erhöht gestartet werden");
        foreach (var dir in new[] { root, directory })
        {
            var item = new DirectoryInfo(dir);
            if (!item.Exists
                || (item.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Geschütztes natives Verzeichnis fehlt");
            VerifyAdminOwnedDacl(item.GetAccessControl(
                AccessControlSections.Owner | AccessControlSections.Access));
        }
        var binary = new FileInfo(expected);
        if (!binary.Exists
            || (binary.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Geschützte native ausführbare Datei fehlt");
        VerifyAdminOwnedDacl(binary.GetAccessControl(
            AccessControlSections.Owner | AccessControlSections.Access));
    }

    private static string LoadAdminOwnedServicePin()
    {
        var file = new FileInfo(PinPath);
        if (!file.Exists || file.Length is < 100 or > 4096
            || (file.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Geschützter Dienst-Pin fehlt");
        // A same-account, non-admin agent may READ the pin but must not
        // replace it with a forged service identity.
        var parent = file.Directory;
        if (parent is null || !parent.Exists
            || (parent.Attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Dienst-Pin-Verzeichnis ungültig");
        VerifyAdminOwnedDacl(file.GetAccessControl(
            AccessControlSections.Owner | AccessControlSections.Access));
        VerifyAdminOwnedDacl(parent.GetAccessControl(
            AccessControlSections.Owner | AccessControlSections.Access));
        return File.ReadAllText(PinPath, Utf8);
    }

    private static void VerifyAdminOwnedDacl(FileSystemSecurity acl)
    {
        var owner = acl.GetOwner(typeof(SecurityIdentifier))
            as SecurityIdentifier;
        if (owner?.Value != "S-1-5-32-544"
            || !acl.AreAccessRulesProtected)
            throw new InvalidOperationException(
                "Dienst-Signaturpfad ist nicht Administrator-geschützt");
        foreach (FileSystemAccessRule ace in acl.GetAccessRules(
            true, true, typeof(SecurityIdentifier)))
        {
            if (ace.AccessControlType != AccessControlType.Allow) continue;
            var sid = (SecurityIdentifier)ace.IdentityReference;
            if (sid.Value is "S-1-5-18" or "S-1-5-32-544") continue;
            if (HasMutationRights(ace.FileSystemRights))
                throw new InvalidOperationException(
                    "Nichtadministrativer Schreibzugriff auf Dienst-Pin-Verzeichnis");
        }
    }

    // Composite Modify/FullControl include READ bits, so testing those
    // masks directly rejects legitimate read-only Users ACLs. Test only
    // primitive mutation rights instead. This is covered by native CI.
    internal static bool HasMutationRights(FileSystemRights rights)
    {
        const FileSystemRights mutation =
            FileSystemRights.WriteData | FileSystemRights.AppendData
            | FileSystemRights.WriteExtendedAttributes
            | FileSystemRights.WriteAttributes | FileSystemRights.Delete
            | FileSystemRights.DeleteSubdirectoriesAndFiles
            | FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership;
        return (rights & mutation) != 0;
    }

    private static string Encode(ReadOnlySpan<byte> bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=')
            .Replace('+', '-').Replace('/', '_');

    private static byte[] Decode(string? value, int maxBytes)
    {
        if (value is null || !Base64Url.IsMatch(value)
            || value.Length > maxBytes * 2)
            throw new InvalidOperationException("Ungültige kodierte Daten");
        var chars = value.Replace('-', '+').Replace('_', '/');
        var bytes = Convert.FromBase64String(
            chars.PadRight((chars.Length + 3) / 4 * 4, '='));
        if (bytes.Length is 0 || bytes.Length > maxBytes || Encode(bytes) != value)
            throw new InvalidOperationException("Nichtkanonische kodierte Daten");
        return bytes;
    }

    private static bool HasExactFields(JsonElement obj, params string[] expected)
    {
        if (obj.ValueKind != JsonValueKind.Object) return false;
        var keys = obj.EnumerateObject().Select(p => p.Name).ToArray();
        return keys.Length == expected.Length
            && keys.Distinct(StringComparer.Ordinal).Count() == keys.Length
            && keys.ToHashSet(StringComparer.Ordinal)
                .SetEquals(expected);
    }

    private static string Str(JsonElement obj, string name)
        => obj.GetProperty(name).GetString()
            ?? throw new InvalidOperationException("Dienstfeld fehlt: " + name);

    /// <summary>Service-signed, nonce-bound answer. Only the separate publish
    /// completion may report a Claim write, and it is NOT a Codex read grant.</summary>
    internal static JsonDocument VerifySignedResponse(
        string json, string pem, string nonce, string operation)
    {
        using var envelope = JsonDocument.Parse(json);
        if (!HasExactFields(envelope.RootElement,
            "protocol", "payload_b64", "signature_b64")
            || Str(envelope.RootElement, "protocol") != Protocol
            || !Base64Url.IsMatch(nonce))
            throw new InvalidOperationException("Unerwartete Dienstsignatur-Hülle");
        var raw = Convert.FromBase64String(Str(envelope.RootElement, "payload_b64"));
        var signature = Convert.FromBase64String(
            Str(envelope.RootElement, "signature_b64"));
        if (raw.Length is < 24 or > 12_000
            || signature.Length is < 64 or > 96)
            throw new InvalidOperationException("Dienstsignatur zu groß/ungültig");
        using var key = ECDsa.Create();
        key.ImportFromPem(pem);
        if (key.ExportParameters(false).Curve.Oid.Value
            != "1.2.840.10045.3.1.7"
            || !key.VerifyData(raw, signature, HashAlgorithmName.SHA256,
                DSASignatureFormat.Rfc3279DerSequence))
            throw new InvalidOperationException("Dienstsignatur falsch");
        var document = JsonDocument.Parse(raw);
        var result = document.RootElement;
        try
        {
            if (Str(result, "protocol") != Protocol
                || Str(result, "op") != operation
                || Str(result, "nonce") != nonce
                || result.GetProperty("service_signed").GetBoolean() != true
                || result.GetProperty("human_approval_verified").GetBoolean()
                || (operation != "publish_complete"
                    && result.GetProperty("claim_written").GetBoolean()))
                throw new InvalidOperationException("Dienstantwort nicht vertrauenswürdig");
            return document;
        }
        catch
        {
            document.Dispose();
            throw;
        }
    }

    // Called synchronously from the WinForms WebAuthn completion handler.
    // RequestAsync must never capture its SynchronizationContext: the caller
    // is blocked waiting for this result and cannot pump UI continuations.
    private static JsonDocument Request(string operation, object fields)
        => RequestAsync(operation, fields).GetAwaiter().GetResult();

    private static async Task<JsonDocument> RequestAsync(
        string operation, object fields)
    {
        var nonce = Encode(RandomNumberGenerator.GetBytes(32));
        var payload = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["protocol"] = Protocol,
            ["op"] = operation,
            ["nonce"] = nonce,
        };
        foreach (var property in JsonSerializer.SerializeToElement(fields)
            .EnumerateObject())
            payload[property.Name] = property.Value.Clone();
        var message = Utf8.GetBytes(JsonSerializer.Serialize(payload) + "\n");

        // This pin and its parent DIRECTORY must both be Admin-owned and
        // nonwritable to the ordinary user before opening a named pipe.
        var pin = LoadAdminOwnedServicePin();
        using var pipe = new NamedPipeClientStream(".", PipeName,
            PipeDirection.InOut, PipeOptions.Asynchronous,
            TokenImpersonationLevel.Identification);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(6));
        await pipe.ConnectAsync(3000, deadline.Token).ConfigureAwait(false);
        await pipe.WriteAsync(message, deadline.Token).ConfigureAwait(false);
        await pipe.FlushAsync(deadline.Token).ConfigureAwait(false);
        // The server's response is one ASCII JSON envelope line. Enforce an
        // absolute response-size cap even if a compromised pipe never sends
        // a newline, and an actual cancellation deadline on every read.
        using var bytes = new MemoryStream();
        var buffer = new byte[1024];
        while (bytes.Length < 16_384)
        {
            var count = await pipe.ReadAsync(buffer, deadline.Token).ConfigureAwait(false);
            if (count == 0)
                throw new InvalidOperationException("Leere Dienstantwort");
            var lineEnd = Array.IndexOf(buffer, (byte)'\n', 0, count);
            var size = lineEnd < 0 ? count : lineEnd;
            if (bytes.Length + size > 16_384)
                throw new InvalidOperationException("Dienstantwort zu groß");
            bytes.Write(buffer, 0, size);
            if (lineEnd >= 0)
                return VerifySignedResponse(Utf8.GetString(bytes.ToArray()),
                    pin, nonce, operation);
        }
        throw new InvalidOperationException("Unvollständige Dienstantwort");
    }

    internal static bool ValidReviewKind(string? kind)
        => kind is "knowledge" or "preference" or "procedure";

    private static void ValidateExactOperatorMeaning(
        JsonElement m, string project, string branch, string proposalRef)
    {
        if (!HasExactFields(m, "projectId", "branch", "revisionSha",
            "proposalRef", "reviewSnapshotSha256", "canonicalFactSha256",
            "decision", "canonicalFact")
            || Str(m, "projectId") != project
            || Str(m, "branch") != branch
            || Str(m, "proposalRef") != proposalRef
            || !Hex40.IsMatch(Str(m, "revisionSha"))
            || !Hex64.IsMatch(Str(m, "reviewSnapshotSha256"))
            || !Hex64.IsMatch(Str(m, "canonicalFactSha256"))
            || Str(m, "decision") is not ("confirm" or "reject"))
            throw new InvalidOperationException("Dienstgebundener Einschreib-Kontext falsch");
        var fact = Str(m, "canonicalFact");
        if (fact.Length is < 1 or > 4000
            || Convert.ToHexString(SHA256.HashData(Utf8.GetBytes(fact)))
                .ToLowerInvariant() != Str(m, "canonicalFactSha256"))
            throw new InvalidOperationException("Einschreib-Fakt SHA256 falsch");
    }

    internal static RegistrationOffer BeginNativeEnrollment(
        string project, string branch, string proposalRef)
    {
        if (!Scope.IsMatch(project) || project.Length > 256
            || !Scope.IsMatch(branch) || branch.Length > 128
            || !Ref.IsMatch(proposalRef))
            throw new InvalidOperationException("Ungültige native Einschreib-Referenz");
        using var verified = Request("enroll_begin", new
        {
            projectId = project, branch, proposalRef,
        });
        var r = verified.RootElement;
        var m = r.GetProperty("meaning");
        ValidateExactOperatorMeaning(m, project, branch, proposalRef);
        if (Str(r, "status") != "operator_native_registration_challenge_unapproved"
            || Str(r, "expected_origin") != "http://localhost:4328"
            || !ValidReviewKind(Str(r, "kind"))
            || Str(r, "source_origin") != "operator_pinned_unverified_evidence_v1"
            || !Hex64.IsMatch(Str(r, "evidence_sha256"))
            || Decode(Str(r, "challenge"), 64).Length != 32
            || Decode(Str(r, "user_id"), 64).Length != 32
            || !Base64Url.IsMatch(Str(r, "ticket_id"))
            || !DateTimeOffset.TryParse(Str(r, "expires_utc"), out var expiry)
            || expiry <= DateTimeOffset.UtcNow
            || expiry > DateTimeOffset.UtcNow.AddMinutes(2))
            throw new InvalidOperationException("Ungültige signierte Einschreib-Challenge");
        return new RegistrationOffer(
            Str(r, "request_id"), Str(r, "ticket_id"),
            Str(r, "challenge"), Str(r, "user_id"),
            Str(r, "expected_origin"), "localhost", expiry,
            project, branch, proposalRef,
            Str(m, "revisionSha"), Str(m, "reviewSnapshotSha256"),
            Str(m, "canonicalFactSha256"), Str(r, "evidence_sha256"),
            Str(r, "kind"), Str(r, "source_origin"),
            Str(m, "decision"), Str(m, "canonicalFact"));
    }

    internal static ServiceOffer VerifyNativeEnrollmentKey(
        RegistrationOffer original, NativeRegistrationData data)
    {
        _ = Decode(original.TicketId, 64);
        _ = Decode(data.CredentialId, 1024);
        _ = Decode(data.ClientDataJSON, 8192);
        _ = Decode(data.AuthenticatorData, 2048);
        using var verified = Request("enroll_key", new
        {
            ticketId = original.TicketId,
            clientDataJSON = data.ClientDataJSON,
            authenticatorData = data.AuthenticatorData,
            credentialId = data.CredentialId,
        });
        var r = verified.RootElement;
        var m = r.GetProperty("meaning");
        ValidateExactOperatorMeaning(m, original.ProjectId,
            original.Branch, original.ProposalRef);
        if (Str(r, "status") != "operator_native_possession_challenge_unapproved"
            || Str(r, "request_id") != original.RequestId
            || Str(r, "source_origin") != original.SourceOrigin
            || Str(r, "kind") != original.Kind
            || Str(r, "evidence_sha256") != original.EvidenceSha256
            || Str(m, "revisionSha") != original.RevisionSha
            || Str(m, "reviewSnapshotSha256") != original.SnapshotSha256
            || Str(m, "canonicalFactSha256") != original.FactSha256
            || Str(m, "decision") != original.Decision
            || Str(m, "canonicalFact") != original.CanonicalFact
            || Str(r, "credential_id") != data.CredentialId
            || Str(r, "expected_origin") != original.ExpectedOrigin
            || Decode(Str(r, "challenge"), 64).Length != 32
            || !Base64Url.IsMatch(Str(r, "ticket_id"))
            || !DateTimeOffset.TryParse(Str(r, "expires_utc"), out var expiry)
            || expiry <= DateTimeOffset.UtcNow
            || expiry > DateTimeOffset.UtcNow.AddMinutes(2))
            throw new InvalidOperationException("Ungültige native Besitz-Challenge");
        return new ServiceOffer(
            original.RequestId, Str(r, "ticket_id"), Str(r, "challenge"),
            Str(r, "credential_id"), original.ExpectedOrigin, expiry,
            original.ProjectId, original.Branch, original.RevisionSha,
            original.ProposalRef, original.SnapshotSha256, original.FactSha256,
            original.EvidenceSha256, original.SourceOrigin, original.Kind,
            original.Decision, original.CanonicalFact);
    }

    internal static OperatorReceipt CompleteNativeEnrollment(
        string ticketId, NativeAssertion assertion)
    {
        _ = Decode(ticketId, 64);
        using var verified = Request("enroll_finish", new
        {
            ticketId,
            assertion = new
            {
                credentialId = assertion.CredentialId,
                type = assertion.Type,
                clientDataJSON = assertion.ClientDataJSON,
                authenticatorData = assertion.AuthenticatorData,
                signature = assertion.Signature,
            },
        });
        var r = verified.RootElement;
        var approved = r.GetProperty("signature_verified").GetBoolean();
        var status = Str(r, "status");
        if (approved && (
                status != "operator_native_uv_enrolled_unapproved"
                || Str(r, "enrollment_state")
                    != "operator_native_uv_enrolled_unapproved_v1"))
            throw new InvalidOperationException(
                "Dienst behauptet fremde Einschreibung oder Genehmigung");
        return new OperatorReceipt(approved, status);
    }

    internal static ServiceOffer Begin(string project, string branch, string proposalRef)
        => BeginSignedOffer(project, branch, proposalRef,
            "begin", "operator_service_uv_challenge_not_approval");

    internal static ServiceOffer BeginReaffirmation(
        string project, string branch, string proposalRef)
        => BeginSignedOffer(project, branch, proposalRef,
            "reaffirm_begin", "operator_reaffirmation_challenge_no_claim");

    internal static ServiceOffer BeginPublish(
        string project, string branch, string proposalRef)
        => BeginSignedOffer(project, branch, proposalRef,
            "publish_begin", "operator_direct_claim_publication_challenge");

    private static ServiceOffer BeginSignedOffer(
        string project, string branch, string proposalRef,
        string operation, string requiredStatus)
    {
        if (project.Length > 256 || branch.Length > 128
            || !Scope.IsMatch(project) || !Scope.IsMatch(branch)
            || !Ref.IsMatch(proposalRef))
            throw new InvalidOperationException("Projekt, Branch oder E~-Ref ungültig");
        using var verified = Request(operation, new
        {
            projectId = project, branch, proposalRef,
        });
        var r = verified.RootElement;
        var m = r.GetProperty("meaning");
        if (!HasExactFields(m, "projectId", "branch", "revisionSha",
            "proposalRef", "reviewSnapshotSha256", "canonicalFactSha256",
            "decision", "canonicalFact")
            || Str(r, "status") != requiredStatus
            || Str(m, "projectId") != project
            || Str(m, "branch") != branch
            || Str(m, "proposalRef") != proposalRef
            || !Hex40.IsMatch(Str(m, "revisionSha"))
            || !Hex64.IsMatch(Str(m, "reviewSnapshotSha256"))
            || !Hex64.IsMatch(Str(m, "canonicalFactSha256"))
            || !Hex64.IsMatch(Str(r, "evidence_sha256"))
            || Str(r, "source_origin") != "operator_pinned_unverified_evidence_v1"
            || Str(m, "decision") is not ("confirm" or "reject")
            || !ValidReviewKind(Str(r, "kind")))
            throw new InvalidOperationException("Dienstquelle oder Scope ungültig");
        if (operation == "publish_begin"
            && (Str(r, "confirmation_scope") != "publish_new_user_direct_memory_claim"
                || Str(r, "provenance") != "user_direct_reaffirmed_and_published_v1"
                || r.GetProperty("published_to_codex").GetBoolean()
                || r.GetProperty("original_evidence_verified").GetBoolean()
                || Str(m, "decision") != "confirm"
                || Str(r, "kind") is not ("knowledge" or "preference")))
            throw new InvalidOperationException(
                "Dienstsignatur erlaubt keine eigene Claim-Veröffentlichung");
        if (operation == "reaffirm_begin"
            && (Str(r, "confirmation_scope") != "new_user_statement_only"
                || r.GetProperty("reaffirmation_intent_recorded").GetBoolean()
                || r.GetProperty("original_evidence_verified").GetBoolean()
                || Str(m, "decision") != "confirm"
                || Str(r, "kind") is not ("knowledge" or "preference")))
            throw new InvalidOperationException(
                "Keine eindeutige persönliche Bestätigungs-Challenge");
        var fact = Str(m, "canonicalFact");
        if (fact.Length is < 1 or > 4000
            || Convert.ToHexString(SHA256.HashData(Utf8.GetBytes(fact)))
                .ToLowerInvariant() != Str(m, "canonicalFactSha256"))
            throw new InvalidOperationException("Originalfakt SHA256 falsch");
        var origin = Str(r, "expected_origin");
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var originUri)
            || originUri.Host != "localhost"
            || originUri.Scheme != Uri.UriSchemeHttp
            || originUri.GetLeftPart(UriPartial.Authority) != origin)
            throw new InvalidOperationException("WebAuthn-Origin unzulässig");
        _ = Decode(Str(r, "credential_id"), 1024);
        if (Decode(Str(r, "challenge"), 64).Length != 32)
            throw new InvalidOperationException("Challenge muss 32 Bytes sein");
        _ = Decode(Str(r, "ticket_id"), 64);
        if (!DateTimeOffset.TryParse(Str(r, "expires_utc"), out var expires)
            || expires <= DateTimeOffset.UtcNow
            || expires > DateTimeOffset.UtcNow.AddMinutes(2))
            throw new InvalidOperationException("Challenge-Ablauf unzulässig");
        return new ServiceOffer(
            Str(r, "request_id"), Str(r, "ticket_id"), Str(r, "challenge"),
            Str(r, "credential_id"), origin, expires,
            project, branch, Str(m, "revisionSha"), proposalRef,
            Str(m, "reviewSnapshotSha256"), Str(m, "canonicalFactSha256"),
            Str(r, "evidence_sha256"), Str(r, "source_origin"),
            Str(r, "kind"), Str(m, "decision"), fact);
    }

    internal static OperatorReceipt CompletePublish(
        string ticketId, NativeAssertion assertion)
    {
        _ = Decode(ticketId, 64);
        using var verified = Request("publish_complete", new
        {
            ticketId,
            assertion = new
            {
                credentialId = assertion.CredentialId,
                type = assertion.Type,
                clientDataJSON = assertion.ClientDataJSON,
                authenticatorData = assertion.AuthenticatorData,
                signature = assertion.Signature,
            },
        });
        return ParsePublishReceipt(verified.RootElement);
    }

    internal static OperatorReceipt ParsePublishReceipt(JsonElement result)
    {
        if (result.GetProperty("human_approval_verified").GetBoolean()
            || result.GetProperty("published_to_codex").GetBoolean()
            || result.GetProperty("original_evidence_verified").GetBoolean())
            throw new InvalidOperationException("Unzulässiger Claim- oder Herkunftsstatus");
        var written = result.GetProperty("claim_written").GetBoolean();
        var signed = result.GetProperty("signature_verified").GetBoolean();
        var status = Str(result, "status");
        var provenance = result.TryGetProperty("provenance", out var origin)
            && origin.ValueKind == JsonValueKind.String
            ? origin.GetString() : null;
        var id = result.TryGetProperty("claim_id", out var identifier)
            && identifier.ValueKind == JsonValueKind.String
            ? identifier.GetString() : null;
        if (signed != written
            || written && (status !=
                "protected_user_direct_claim_committed_not_published_to_codex"
                || provenance != "user_direct_reaffirmed_and_published_v1"
                || id is null
                || !Regex.IsMatch(id, @"\AC~[0-9a-f]{24}\z",
                    RegexOptions.CultureInvariant))
            || !written && (id is not null || provenance is not null))
            throw new InvalidOperationException(
                "Der signierte Dienstbeleg enthält eine unzulässige Claim-Behauptung");
        return new OperatorReceipt(written, status, id);
    }

    internal static OperatorReceipt CompleteReaffirmation(
        string ticketId, NativeAssertion assertion)
    {
        _ = Decode(ticketId, 64);
        using var verified = Request("reaffirm_complete", new
        {
            ticketId,
            assertion = new
            {
                credentialId = assertion.CredentialId,
                type = assertion.Type,
                clientDataJSON = assertion.ClientDataJSON,
                authenticatorData = assertion.AuthenticatorData,
                signature = assertion.Signature,
            },
        });
        return ParseReaffirmationReceipt(verified.RootElement);
    }

    internal static OperatorReceipt ParseReaffirmationReceipt(JsonElement result)
    {
        if (result.GetProperty("human_approval_verified").GetBoolean()
            || result.GetProperty("claim_written").GetBoolean())
            throw new InvalidOperationException("Unzulässige Claim-Freigabe");
        var success = result.GetProperty("signature_verified").GetBoolean();
        var recorded = result.GetProperty("reaffirmation_intent_recorded").GetBoolean();
        var originalVerified = result.GetProperty("original_evidence_verified").GetBoolean();
        var status = Str(result, "status");
        if (originalVerified || success != recorded
            || (success && status != "operator_reaffirmation_intent_recorded_no_claim"))
            throw new InvalidOperationException(
                "Dienst behauptet eine unzulässige Quellenfreigabe oder einen Claim");
        return new OperatorReceipt(success, status);
    }

    internal static OperatorReceipt Complete(string ticketId, NativeAssertion assertion)
    {
        _ = Decode(ticketId, 64);
        using var verified = Request("complete", new
        {
            ticketId,
            assertion = new
            {
                credentialId = assertion.CredentialId,
                type = assertion.Type,
                clientDataJSON = assertion.ClientDataJSON,
                authenticatorData = assertion.AuthenticatorData,
                signature = assertion.Signature,
            },
        });
        var result = verified.RootElement;
        var success = result.GetProperty("signature_verified").GetBoolean();
        var status = Str(result, "status");
        if (success && status != "operator_webauthn_uv_verified_not_approved")
            throw new InvalidOperationException("Dienst behauptet unerlaubte Genehmigung");
        return new OperatorReceipt(success, status);
    }
}
