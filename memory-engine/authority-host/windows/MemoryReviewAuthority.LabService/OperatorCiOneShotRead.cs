using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using MemoryReviewAuthority.Core;
using MemoryReviewAuthority.Store;

namespace MemoryReviewAuthority.LabService;

/// <summary>
/// Isolated synthetic Windows SCM one-shot release lab. A real protected Claim
/// is released to an ACTUALLY CONNECTED recipient only after a separate
/// exact-scope read-purpose UV assertion. This has NO production-facing Codex
/// enrollment or independently authenticated Codex process identity.
/// </summary>
internal sealed partial class OperatorWebAuthnPipe
{
    private readonly OneShotCiRecipientPipe? _ciRecipient;
    private ActiveCiRead? _activeCiRead;

    private sealed record ActiveCiRead(
        ReadDisclosureTicket Ticket,
        string ClaimId,
        string OriginalResultHash,
        OneShotCiRecipientPipe.Snapshot Recipient);

    private object? BeginCiOneShotRead(JsonElement root,string nonce,
        System.IO.Pipes.NamedPipeServerStream? operatorPipe)
    {
        if (_ciRecipient is null || operatorPipe is null || !ExactKeys(root,
            "protocol","op","nonce","projectId","branch","proposalRef"))
            return null;
        var project=Str(root,"projectId");
        var branch=Str(root,"branch");
        var proposal=Str(root,"proposalRef");
        if(project!=OneShotCiRecipientPipe.Project
            || branch!=OneShotCiRecipientPipe.Branch
            || !Regex.IsMatch(proposal ?? "",@"\AE~[a-f0-9]{10}\z")
            || (_activeCiRead is not null
                && _activeCiRead.Ticket.ExpiresUtc>DateTimeOffset.UtcNow))
            return null;
        var recipient=_ciRecipient.Peek(project!,branch!,proposal!);
        if(_ledger.IsCiOneShotRevoked())
        {
            _ciRecipient.Deny(recipient);
            return null;
        }
        var native=_ledger.ReadOperatorCredential();
        if(recipient is null || native is null
            || native.EnrollmentState != ProtectedPendingReviewLedger.NativeEnrollmentState
            // The administrator-nominated recipient must at least share
            // the actual pipe-caller Windows account; an attacker cannot
            // inject a SID into JSON to authorize a different recipient.
            || VerifiedPipePrincipalSid(operatorPipe)!=recipient.PrincipalSid)
            return null;
        // Explicit operator admin pipe and receiver must be same account in
        // the lab. The receiver PID is obtained by the Windows kernel, not
        // by a client JSON claim.
        var claims=_ledger.ReadOperatorDirectClaims(project!,branch!,100);
        var claim=claims.SingleOrDefault(c=>c.ProposalRef==proposal);
        if(claim is null || claim.Kind is not ("knowledge" or "preference"))
            return null;
        var query="exact-proposal:"+proposal;
        var resultHash=SnapshotHash(claim);
        var meaning=new ReadDisclosureMeaning(
            claim.ProjectId,claim.Branch,claim.RevisionSha,
            recipient.PrincipalSid,
            Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant(),
            ReadHash(query),resultHash,recipient.SessionSha256);
        var ticket=_readDisclosureCore.BeginProtectedReadDisclosure(
            meaning,native.Credential);
        // Durable one-use reservation bound to the protected exact Claim,
        // OS-observed session, signer challenge and short expiry. Failure
        // denies the recipient; the in-memory challenge alone grants nothing.
        if(!_ledger.ReserveCiOneShot(meaning,claim.ClaimId,
            claim.ProposalRef,recipient.KernelProcessId,ticket.ExpiresUtc))
        {
            _ciRecipient.Deny(recipient);
            return null;
        }
        _activeCiRead=new ActiveCiRead(ticket,claim.ClaimId,resultHash,recipient);
        return new
        {
            protocol=Protocol,op="ci_read_begin",nonce,
            status="ci_one_shot_exact_recipient_uv_challenge_no_release",
            service_signed=true,human_approval_verified=false,
            claim_written=false,read_released=false,published_to_codex=false,
            request_id=meaning.RequestId,ticket_id=ticket.TicketId,
            challenge=ticket.ChallengeBase64Url,
            expires_utc=ticket.ExpiresUtc.ToString("O"),
            credential_id=native.Credential.CredentialIdBase64Url,
            expected_origin=native.Credential.ExpectedOrigin,
            principal_sid=meaning.PrincipalSid,
            recipient_kernel_pid=recipient.KernelProcessId,
            recipient_session_sha256=meaning.RecipientSessionSha256,
            query,query_sha256=meaning.QuerySha256,
            result_set_sha256=resultHash,
            project_id=claim.ProjectId,branch=claim.Branch,
            revision_sha=claim.RevisionSha,
            proposal_ref=claim.ProposalRef,claim_id=claim.ClaimId,
            kind=claim.Kind,value=claim.Value,
            fact_sha256=claim.FactSha256,
            snapshot_sha256=claim.SnapshotSha256,
            historical_source_origin=claim.HistoricalSourceOrigin,
            provenance=claim.Provenance,
            recipient="CI ONLY: kernel-observed connected pipe, not verified Codex",
        };
    }

    private object? RevokeCiOneShot(JsonElement root,string nonce)
    {
        if(_ciRecipient is null
            || !ExactKeys(root,"protocol","op","nonce"))
            return null;
        // Deny-only administrative action. This cannot grant a read and
        // the protected WAL tombstone is never removed or reset on restart.
        _ledger.RevokeCiOneShot();
        if(_activeCiRead is { } active)
        {
            _ciRecipient.Deny(active.Recipient);
            _activeCiRead=null;
        }
        return new {
            protocol=Protocol,op="ci_read_revoke",nonce,
            status="ci_read_durably_revoked_no_claim",
            service_signed=true,human_approval_verified=false,
            claim_written=false,read_released=false,
            published_to_codex=false,production_authorized=false,
        };
    }

    private object? CompleteCiOneShotRead(JsonElement root,string nonce)
    {
        var active=_activeCiRead;
        _activeCiRead=null; // consume on the FIRST completion attempt
        if(active is null || _ciRecipient is null)return null;
        var delivered=false;
        var status="ci_read_denied";
        try
        {
            if(!ExactKeys(root,"protocol","op","nonce","ticketId","assertion")
                || Str(root,"ticketId")!=active.Ticket.TicketId
                || !root.TryGetProperty("assertion",out var assertion)
                || !ExactKeys(assertion,"credentialId","type",
                    "clientDataJSON","authenticatorData","signature"))
                return null;
            var proof=new BrowserAssertion(
                Str(assertion,"credentialId")??"",
                Str(assertion,"type")??"",
                Str(assertion,"clientDataJSON")??"",
                Str(assertion,"authenticatorData")??"",
                Str(assertion,"signature")??"");
            // Do not authorize based on a once-validated client-provided
            // claim or an untrusted cache. Re-read the service-owned source.
            var meaning=active.Ticket.Meaning;
            var claim=_ledger.ReadOperatorDirectClaims(
                meaning.ProjectId,meaning.Branch,100)
                .SingleOrDefault(c=>c.ClaimId==active.ClaimId);
            if(claim is null || SnapshotHash(claim)!=active.OriginalResultHash
                || _ciRecipient.Peek(claim.ProjectId,claim.Branch,claim.ProposalRef)
                    != active.Recipient)
                return null;
            var result=_readDisclosureCore.VerifyProtectedReadDisclosureAndConsume(
                active.Ticket.TicketId,meaning,proof);
            status=result.Status;
            if(!result.Verified || !result.UserPresent || !result.UserVerified
                || result.Status!="verified_read_disclosure_intent_only")
                return new {
                    protocol=Protocol,op="ci_read_complete",nonce,status,
                    service_signed=true,human_approval_verified=false,
                    claim_written=false,read_released=false,
                    published_to_codex=false,
                };
            // The only private text release is to the previously connected
            // CI-only recipient pipe. No dynamic account/group or bearer ACL.
            var payload=JsonSerializer.SerializeToUtf8Bytes(new
            {
                protocol=OneShotCiRecipientPipe.Protocol,
                status="exact_one_shot_synthetic_ci_claim",
                request_id=meaning.RequestId,
                claim_id=claim.ClaimId,
                project_id=claim.ProjectId,branch=claim.Branch,
                revision_sha=claim.RevisionSha,proposal_ref=claim.ProposalRef,
                fact_sha256=claim.FactSha256,result_set_sha256=meaning.ResultSetSha256,
                recipient_session_sha256=active.Recipient.SessionSha256,
                recipient_client_nonce=active.Recipient.ClientNonce,
                recipient_kernel_pid=active.Recipient.KernelProcessId,
                value=claim.Value,
                provenance=claim.Provenance,
                production_authorized=false,
            });
            var signature=_signer.SignData(payload,HashAlgorithmName.SHA256,
                DSASignatureFormat.Rfc3279DerSequence);
            var encoded=JsonSerializer.SerializeToUtf8Bytes(new
            {
                protocol=OneShotCiRecipientPipe.Protocol,
                payload_b64=Convert.ToBase64String(payload),
                signature_b64=Convert.ToBase64String(signature),
            });
            var wire=new byte[encoded.Length+1];
            encoded.CopyTo(wire,0); wire[^1]=(byte)'\n';
            // CRITICAL: commit a durable, irreversible consumed_pre_io row
            // before the first private byte can reach the recipient pipe.
            // No successful transfer is claimed merely by this journal.
            if(!_ledger.ConsumeCiOneShotBeforeIo(
                meaning,claim.ClaimId,claim.ProposalRef,
                active.Recipient.KernelProcessId))
                return new {
                    protocol=Protocol,op="ci_read_complete",nonce,
                    status="ci_read_durable_consume_denied",
                    signature_verified=true,service_signed=true,
                    human_approval_verified=false,claim_written=false,
                    read_released=false,published_to_codex=false,
                    production_authorized=false,
                    request_id=meaning.RequestId,
                };
            delivered=_ciRecipient.TryDeliver(active.Recipient,wire);
            status=delivered?"ci_exact_one_shot_delivered_no_production_authority"
                :"ci_one_shot_delivery_denied";
            return new {
                protocol=Protocol,op="ci_read_complete",nonce,status,
                signature_verified=true,service_signed=true,
                human_approval_verified=false,claim_written=false,
                read_released=delivered,published_to_codex=false,
                production_authorized=false,
                request_id=meaning.RequestId,
            };
        }
        finally
        {
            // A failed/invalid completed request cannot leave its original
            // pending recipient available for a later unrelated ticket.
            _ciRecipient.Deny(active.Recipient);
            // A wrong-purpose or failed assertion also leaves a durable
            // terminal row. Already consumed_pre_io rows never regress.
            _ledger.AbortCiOneShot(active.Ticket.Meaning.RequestId);
        }
    }
}
