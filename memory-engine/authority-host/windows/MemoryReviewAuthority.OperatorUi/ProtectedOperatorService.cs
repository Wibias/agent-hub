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
    string Decision,
    string CanonicalFact);

internal sealed record NativeAssertion(
    string CredentialId,
    string Type,
    string ClientDataJSON,
    string AuthenticatorData,
    string Signature);

internal sealed record OperatorReceipt(bool Verified, string Status);

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
            // Do not OR composite rights like Modify or FullControl here:
            // they CONTAIN ordinary ReadAndExecute bits and would classify a
            // Users READ-ONLY ACE as writeable. Inspect only the primitive
            // actual mutation bits; FullControl still necessarily matches.
            const FileSystemRights write =
                FileSystemRights.WriteData | FileSystemRights.AppendData
                | FileSystemRights.WriteExtendedAttributes
                | FileSystemRights.WriteAttributes | FileSystemRights.Delete
                | FileSystemRights.DeleteSubdirectoriesAndFiles
                | FileSystemRights.ChangePermissions
                | FileSystemRights.TakeOwnership;
            if ((ace.FileSystemRights & write) != 0)
                throw new InvalidOperationException(
                    "Nichtadministrativer Schreibzugriff auf Dienst-Pin-Verzeichnis");
        }
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

    /// <summary>Service signature, nonce, exact source bytes and NO authority.</summary>
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
                || result.GetProperty("claim_written").GetBoolean())
                throw new InvalidOperationException("Dienstantwort nicht vertrauenswürdig");
            return document;
        }
        catch
        {
            document.Dispose();
            throw;
        }
    }

    private static JsonDocument Request(string operation, object fields)
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
        var message = JsonSerializer.Serialize(payload) + "\n";

        // Verify the installed admin-owned pin BEFORE talking to a pipe that
        // could be forged by a same-user agent in a less restricted design.
        var pin = LoadAdminOwnedServicePin();
        using var pipe = new NamedPipeClientStream(".", PipeName,
            PipeDirection.InOut, PipeOptions.None,
            TokenImpersonationLevel.Identification);
        pipe.Connect(3000);
        pipe.ReadTimeout = 5500;
        pipe.WriteTimeout = 5500;
        using (var writer = new StreamWriter(pipe, Utf8, bufferSize: 1024, leaveOpen: true)
        {
            AutoFlush = true,
        })
            writer.Write(message);

        using var reader = new StreamReader(pipe, Utf8,
            detectEncodingFromByteOrderMarks: false, bufferSize: 1024, leaveOpen: true);
        var response = new StringBuilder(12_000);
        for (int i = 0; i < 16_384; i++)
        {
            var ch = reader.Read();
            if (ch < 0) break;
            if (ch == '\n') return VerifySignedResponse(
                response.ToString(), pin, nonce, operation);
            response.Append((char)ch);
        }
        throw new InvalidOperationException("Unvollständige Dienstantwort");
    }

    internal static ServiceOffer Begin(string project, string branch, string proposalRef)
    {
        if (project.Length > 256 || branch.Length > 128
            || !Scope.IsMatch(project) || !Scope.IsMatch(branch)
            || !Ref.IsMatch(proposalRef))
            throw new InvalidOperationException("Projekt, Branch oder E~-Ref ungültig");
        using var verified = Request("begin", new
        {
            projectId = project, branch, proposalRef,
        });
        var r = verified.RootElement;
        var m = r.GetProperty("meaning");
        if (!HasExactFields(m, "projectId", "branch", "revisionSha",
            "proposalRef", "reviewSnapshotSha256", "canonicalFactSha256",
            "decision", "canonicalFact")
            || Str(r, "status") != "operator_service_uv_challenge_not_approval"
            || Str(m, "projectId") != project
            || Str(m, "branch") != branch
            || Str(m, "proposalRef") != proposalRef
            || !Hex40.IsMatch(Str(m, "revisionSha"))
            || !Hex64.IsMatch(Str(m, "reviewSnapshotSha256"))
            || !Hex64.IsMatch(Str(m, "canonicalFactSha256"))
            || !Hex64.IsMatch(Str(r, "evidence_sha256"))
            || Str(r, "source_origin") != "operator_pinned_unverified_evidence_v1"
            || Str(m, "decision") is not ("confirm" or "reject")
            || Str(r, "kind") is not ("knowledge" or "preference"))
            throw new InvalidOperationException("Dienstquelle oder Scope ungültig");
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
        if (!DateTimeOffset.TryParse(Str(r, "expires_utc"), out var expires))
            throw new InvalidOperationException("Challenge-Ablauf unzulässig");
        return new ServiceOffer(
            Str(r, "request_id"), Str(r, "ticket_id"), Str(r, "challenge"),
            Str(r, "credential_id"), origin, expires,
            project, branch, Str(m, "revisionSha"), proposalRef,
            Str(m, "reviewSnapshotSha256"), Str(m, "canonicalFactSha256"),
            Str(r, "evidence_sha256"), Str(r, "source_origin"),
            Str(m, "decision"), fact);
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
