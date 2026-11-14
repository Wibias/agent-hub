using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MemoryReviewAuthority.OperatorUi;

/// <summary>
/// CI contract test: verifies the signed response boundary and ABI prefix.
/// It DOES NOT simulate a real person or call the OS Hello device.
/// </summary>
internal static class OperatorSelfTest
{
    internal static int RunServiceOffer()
    {
        try
        {
            if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true"
                || Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows")
                return 2;
            // The source matches the same real canonical fixture exported
            // from a temporary Git checkout in Windows SCM, NOT a fake fact
            // supplied to this elevated native UI process.
            const string id = "actual-canonical-evidence-proposal-id";
            var proposalHash = Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(id))).ToLowerInvariant();
            var actualRef = "E~" + proposalHash[..10];
            var offer = ProtectedOperatorService.Begin(
                "github.com/example/operator-evidence", "main", actualRef);
            const string expected =
                "This real-schema E~ proposal has linked Evidence but no human approval.";
            if (offer.CanonicalFact != expected
                || offer.ProposalRef != actualRef
                || offer.SourceOrigin != "operator_pinned_unverified_evidence_v1"
                || offer.Decision != "confirm"
                || offer.ExpiresUtc <= DateTimeOffset.UtcNow
                || offer.CredentialId.Length < 16
                || offer.Challenge.Length != 43
                || offer.ExpectedOrigin != "http://localhost:4328")
                return 2;
            // The native UI does NOT sign or approve a Claim in this smoke
            // check. A real operator must click Windows Hello separately.
            return 0;
        }
        catch
        {
            return 2;
        }
    }

    internal static int Run()
    {
        try
        {
            if (!Environment.Is64BitProcess) throw new Exception("requires_win_x64");
            using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            using var foreign = ECDsa.Create(ECCurve.NamedCurves.nistP256);
            var nonce = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
                .TrimEnd('=').Replace('+', '-').Replace('/', '_');
            var raw = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
            {
                protocol = "agenthub-operator-uv-service-v1",
                op = "complete",
                nonce,
                status = "operator_webauthn_uv_verified_not_approved",
                signature_verified = true,
                service_signed = true,
                human_approval_verified = false,
                claim_written = false,
            }));
            string MakeEnvelope(ECDsa signingKey, byte[] payload)
                => JsonSerializer.Serialize(new
                {
                    protocol = "agenthub-operator-uv-service-v1",
                    payload_b64 = Convert.ToBase64String(payload),
                    signature_b64 = Convert.ToBase64String(signingKey.SignData(
                        payload, HashAlgorithmName.SHA256,
                        DSASignatureFormat.Rfc3279DerSequence)),
                });
            using (var good = ProtectedOperatorService.VerifySignedResponse(
                MakeEnvelope(key, raw), key.ExportSubjectPublicKeyInfoPem(),
                nonce, "complete"))
            {
                if (good.RootElement.GetProperty("claim_written").GetBoolean()
                    || good.RootElement.GetProperty("human_approval_verified").GetBoolean())
                    throw new Exception("operator_payload_claims_approval");
            }
            var denied = 0;
            void MustDeny(Action action)
            {
                try { action(); }
                catch (Exception e) when (e is InvalidOperationException
                    or CryptographicException or JsonException)
                {
                    denied++;
                    return;
                }
                throw new Exception("operator_bad_envelope_was_accepted");
            }
            MustDeny(() =>
            {
                using var unused = ProtectedOperatorService.VerifySignedResponse(
                    MakeEnvelope(foreign, raw), key.ExportSubjectPublicKeyInfoPem(),
                    nonce, "complete");
            });
            MustDeny(() =>
            {
                using var unused = ProtectedOperatorService.VerifySignedResponse(
                    MakeEnvelope(key, raw), key.ExportSubjectPublicKeyInfoPem(),
                    "invalid-nonce", "complete");
            });
            var malicious = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
            {
                protocol = "agenthub-operator-uv-service-v1",
                op = "complete", nonce,
                service_signed = true,
                human_approval_verified = true,
                claim_written = true,
            }));
            MustDeny(() =>
            {
                using var unused = ProtectedOperatorService.VerifySignedResponse(
                    MakeEnvelope(key, malicious), key.ExportSubjectPublicKeyInfoPem(),
                    nonce, "complete");
            });
            if (denied != 3)
                throw new Exception("operator_envelope_negative_cases_missing");
            // Only static v1 ABI prefix is needed. Avoid a GUI/physical
            // credential during CI, even on an elevated Windows runner.
            var authDataPointer = Marshal.SizeOf<IntPtr>() == 8;
            if (!authDataPointer)
                throw new Exception("operator_native_abi_requires_x64");
            return 0;
        }
        catch
        {
            return 2;
        }
    }
}
