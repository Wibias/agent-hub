using System.Runtime.InteropServices;
using System.Security.AccessControl;
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
    // Regression for an actual WinForms UI-thread deadlock observed after
    // MakeCredential completed. No message loop is pumped while Request()
    // waits: every asynchronous named-pipe continuation must be context-free.
    private sealed class NonPumpingUiContext : SynchronizationContext
    {
        public override void Post(SendOrPostCallback callback, object? state)
        {
            // An actual blocked UI thread cannot dispatch this callback.
        }
    }

    private static T OnBlockedUiThread<T>(Func<T> call)
    {
        var completion = new TaskCompletionSource<T>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new Thread(() =>
        {
            SynchronizationContext.SetSynchronizationContext(
                new NonPumpingUiContext());
            try { completion.TrySetResult(call()); }
            catch (Exception error) { completion.TrySetException(error); }
        })
        {
            IsBackground = true,
            Name = "AgentHub-NonPumping-Ui-Deadlock-Regression",
        };
        worker.Start();
        // Never hang a Windows CI runner if context capture regresses.
        return completion.Task.WaitAsync(TimeSpan.FromSeconds(9))
            .GetAwaiter().GetResult();
    }

    internal static int RunNativeEnrollmentOffer()
    {
        // This is a source/transport smoke test in a disposable CI runner.
        // It MUST NOT invoke Win32 MakeCredential or claim any human consent.
        if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true"
            || Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows")
            return 2;
        try
        {
            const string id = "actual-canonical-evidence-proposal-id";
            var hash = Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(id))).ToLowerInvariant();
            var reference = "E~" + hash[..10];
            var offer = OnBlockedUiThread(() =>
                ProtectedOperatorService.BeginNativeEnrollment(
                    "github.com/example/operator-evidence", "main", reference));
            return offer.ProposalRef == reference
                && offer.Kind == "procedure"
                && offer.Decision == "confirm"
                && offer.SourceOrigin == "operator_pinned_unverified_evidence_v1"
                && offer.CanonicalFact ==
                   "This real-schema E~ proposal has linked Evidence but no human approval."
                && offer.ExpectedOrigin == "http://localhost:4328"
                && offer.ExpiresUtc > DateTimeOffset.UtcNow
                && offer.Challenge.Length == 43
                && offer.UserId.Length == 43
                ? 0 : 2;
        }
        catch (Exception error)
        {
            var temp = Environment.GetEnvironmentVariable("RUNNER_TEMP");
            if (!string.IsNullOrEmpty(temp))
                File.WriteAllText(Path.Combine(temp,
                    "AgentHubNativeEnrollmentSmokeFailure.txt"),
                    error.GetType().Name + ": " + error.Message);
            return 2;
        }
    }

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
            const string expectedProcedure =
                "This real-schema E~ proposal has linked Evidence but no human approval.";
            const string expectedKnowledge =
                "This knowledge statement is proposed from unverified historical Evidence.";
            if (!(offer.Kind == "procedure" && offer.CanonicalFact == expectedProcedure
                || offer.Kind == "knowledge" && offer.CanonicalFact == expectedKnowledge)
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
        catch (Exception error)
        {
            if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true"
                && Environment.GetEnvironmentVariable("RUNNER_OS") == "Windows")
            {
                var temp = Environment.GetEnvironmentVariable("RUNNER_TEMP");
                if (!string.IsNullOrWhiteSpace(temp))
                {
                    File.WriteAllText(Path.Combine(temp,
                        "AgentHubNativeOperatorSmokeFailure.txt"),
                        error.GetType().Name + ": " + error.Message);
                }
            }
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

            // A signed, purpose-bound response is STILL never a Claim and
            // never validates the historical user-writable evidence.
            var affirmative = new
            {
                status = "operator_reaffirmation_intent_recorded_no_claim",
                signature_verified = true,
                reaffirmation_intent_recorded = true,
                original_evidence_verified = false,
                human_approval_verified = false,
                claim_written = false,
            };
            using (var approved = JsonDocument.Parse(JsonSerializer.Serialize(affirmative)))
            {
                var receipt = ProtectedOperatorService.ParseReaffirmationReceipt(
                    approved.RootElement);
                if (!receipt.Verified
                    || receipt.Status != "operator_reaffirmation_intent_recorded_no_claim")
                    throw new Exception("operator_reaffirmation_intent_receipt_invalid");
            }
            foreach (var bad in new[]
            {
                new { affirmative.status, affirmative.signature_verified,
                    affirmative.reaffirmation_intent_recorded,
                    original_evidence_verified = true,
                    affirmative.human_approval_verified, affirmative.claim_written },
                new { affirmative.status, affirmative.signature_verified,
                    affirmative.reaffirmation_intent_recorded,
                    original_evidence_verified = false,
                    human_approval_verified = true, affirmative.claim_written },
                new { affirmative.status, affirmative.signature_verified,
                    affirmative.reaffirmation_intent_recorded,
                    original_evidence_verified = false,
                    affirmative.human_approval_verified, claim_written = true },
                new { affirmative.status, signature_verified = false,
                    affirmative.reaffirmation_intent_recorded,
                    affirmative.original_evidence_verified,
                    affirmative.human_approval_verified, affirmative.claim_written },
            })
            {
                using var badDoc = JsonDocument.Parse(JsonSerializer.Serialize(bad));
                MustDeny(() => { _ = ProtectedOperatorService.ParseReaffirmationReceipt(
                    badDoc.RootElement); });
            }
            if (denied != 7)
                throw new Exception("operator_reaffirmation_receipt_negative_cases_missing");
            // Only publish_complete is allowed to report a *signed*
            // protected Claim write, never user memory_recall availability.
            var claimId = "C~" + new string('a', 24);
            var publishRaw = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
            {
                protocol = "agenthub-operator-uv-service-v1",
                op = "publish_complete", nonce,
                service_signed = true,
                human_approval_verified = false,
                claim_written = true,
                signature_verified = true,
                published_to_codex = false,
                original_evidence_verified = false,
                status = "protected_user_direct_claim_committed_not_published_to_codex",
                provenance = "user_direct_reaffirmed_and_published_v1",
                claim_id = claimId,
            }));
            using (var signed = ProtectedOperatorService.VerifySignedResponse(
                MakeEnvelope(key, publishRaw), key.ExportSubjectPublicKeyInfoPem(),
                nonce, "publish_complete"))
            {
                var receipt = ProtectedOperatorService.ParsePublishReceipt(signed.RootElement);
                if (!receipt.Verified || receipt.ClaimId != claimId)
                    throw new Exception("native_claim_receipt_not_accepted");
            }
            MustDeny(() =>
            {
                using var unused = ProtectedOperatorService.VerifySignedResponse(
                    MakeEnvelope(key, publishRaw), key.ExportSubjectPublicKeyInfoPem(),
                    nonce, "complete");
            });
            void RejectPublish(bool verifiedOriginal, bool codexPublished,
                string? value, string? provenance, bool written = true)
            {
                using var doc = JsonDocument.Parse(JsonSerializer.Serialize(new
                {
                    status = "protected_user_direct_claim_committed_not_published_to_codex",
                    human_approval_verified = false,
                    claim_written = written,
                    signature_verified = true,
                    published_to_codex = codexPublished,
                    original_evidence_verified = verifiedOriginal,
                    claim_id = value,
                    provenance,
                }));
                MustDeny(() =>
                {
                    _ = ProtectedOperatorService.ParsePublishReceipt(doc.RootElement);
                });
            }
            RejectPublish(true, false, claimId, "user_direct_reaffirmed_and_published_v1");
            RejectPublish(false, true, claimId, "user_direct_reaffirmed_and_published_v1");
            RejectPublish(false, false, "C~not-a-canonical-claim-id",
                "user_direct_reaffirmed_and_published_v1");
            RejectPublish(false, false, claimId, "operator_pinned_unverified_evidence_v1");
            RejectPublish(false, false, claimId, "user_direct_reaffirmed_and_published_v1",
                written: false);
            if (denied != 13)
                throw new Exception("operator_publish_receipt_negative_cases_missing");

            foreach (var kind in new[] { "knowledge", "preference", "procedure" })
                if (!ProtectedOperatorService.ValidReviewKind(kind))
                    throw new Exception("native_supported_source_kind_rejected");
            foreach (var kind in new[] { "", "user_direct", "tool_observation", "Procedure" })
                if (ProtectedOperatorService.ValidReviewKind(kind))
                    throw new Exception("native_untrusted_source_kind_accepted");
            foreach (var valid in new[]
                { "http://localhost:4317", "http://localhost:4328",
                  "http://localhost:52348", "http://localhost:1" })
            {
                if (!NativeWindowsWebAuthn.ValidPinnedLocalOrigin(valid))
                    throw new Exception("native_local_origin_port_rejected");
            }
            foreach (var invalid in new[]
                { "", "http://localhost", "http://127.0.0.1:4328",
                  "https://localhost:4328", "http://localhost:4328.evil.test",
                  "http://localHost:4328/other", "http://x@localhost:4328",
                  "http://localhost:4328#fragment", "http://localhost:70000" })
            {
                if (NativeWindowsWebAuthn.ValidPinnedLocalOrigin(invalid))
                    throw new Exception("native_untrusted_web_origin_accepted");
            }
            if (ProtectedOperatorService.HasMutationRights(
                    FileSystemRights.ReadAndExecute)
                || ProtectedOperatorService.HasMutationRights(
                    FileSystemRights.Read)
                || !ProtectedOperatorService.HasMutationRights(
                    FileSystemRights.Modify)
                || !ProtectedOperatorService.HasMutationRights(
                    FileSystemRights.FullControl)
                || !ProtectedOperatorService.HasMutationRights(
                    FileSystemRights.Write)
                || !ProtectedOperatorService.HasMutationRights(
                    FileSystemRights.DeleteSubdirectoriesAndFiles))
                throw new Exception("operator_acl_read_vs_write_mask_regression");
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
