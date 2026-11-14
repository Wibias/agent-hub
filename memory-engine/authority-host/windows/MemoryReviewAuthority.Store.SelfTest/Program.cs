using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using MemoryReviewAuthority.Core;
using System.Text;
using Microsoft.Data.Sqlite;
using MemoryReviewAuthority.Store;

internal static class Program
{
    private static int _passed;
    private static readonly PendingReview Example = new(
        "github.com/example/lab-fixture",
        "main",
        new string('a', 40),
        "E~0123456789",
        new string('b', 64),
        Hash("Synthetic fact"),
        Hash("Synthetic supporting evidence"),
        "confirm");

    private static void Main()
    {
        Run("pending_record_only", PendingOnly);
        Run("repeated_exact_request_idempotent", ExactReplay);
        Run("conflicting_action_refused", ConflictingAction);
        Run("changed_evidence_or_snapshot_refused", ChangedEvidence);
        Run("different_proposal_is_independent", DifferentProposal);
        Run("reopen_preserves_pending_not_authority", Reopen);
        Run("input_and_path_validation", Validation);
        Run("wal_and_no_claim_schema", WalAndNoClaimSchema);
        Run("signed_uv_confirm_records_intent_not_claim", VerifiedConfirm);
        Run("signed_uv_reject_records_no_claim", VerifiedReject);
        Run("exact_scope_and_fact_must_match_pending", StrictReviewScope);
        Run("bad_assertion_consumes_ticket_without_intent", BadAssertionConsumes);
        Run("verified_intent_survives_restart_once_only", VerifiedRestart);
        Run("second_coordinator_cannot_reuse_completed_proposal", CompetingCoordinators);
        Run("protected_confirm_claim_and_scoped_read_persist_reopen", ProtectedConfirm);
        Run("protected_rejection_never_creates_claim", ProtectedReject);
        Run("protected_write_requires_independent_trusted_source", SourceRequired);
        Run("protected_write_rejects_stale_and_targeted_source", SourceMismatch);
        Run("protected_duplicate_rolls_back_uv_intent_and_claim", DuplicateRollback);
        Run("protected_competing_tickets_commit_only_once", ProtectedRace);
        Run("protected_snapshot_immutable_and_reopens_with_same_request", SnapshotImmutable);
        Run("protected_targeted_confirmation_refused", TargetedConfirmDenied);
        Run("real_evidence_import_pending_without_claim", RealEvidenceImport);
        Run("real_evidence_wrong_scope_and_secret_denied", RealEvidenceScopeDenied);
        Run("real_evidence_relation_and_kind_denied", RealEvidenceUnsafeDenied);
        Run("real_evidence_changed_snapshot_denied", RealEvidenceChanged);
        Run("operator_credential_pinned_uv_real_evidence_no_approval", OperatorPinProof);
        Run("operator_credential_counter_restart_replay_denied", OperatorCounter);
        Run("operator_credential_pin_conflict_and_sql_immutability", OperatorPinImmutable);
        Run("operator_credential_wrong_key_and_generic_approval_denied", OperatorDenied);
        Console.WriteLine($"MEMORY_REVIEW_LEDGER PASS {_passed}/30; REAL_EVIDENCE_UV_PINNED_NO_APPROVAL");
    }

    private static void Run(string label, Action test)
    {
        var dir = Path.Combine(Path.GetTempPath(),
            "AgentHubReviewStoreSynthetic-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            TestDirectory = dir;
            test();
            Interlocked.Increment(ref _passed);
            Console.WriteLine("PASS " + label);
        }
        finally
        {
            TestDirectory = string.Empty;
            Directory.Delete(dir, true);
        }
    }

    private static string TestDirectory = string.Empty;
    private static ProtectedPendingReviewLedger Open()
        => ProtectedPendingReviewLedger.OpenInProtectedDirectory(TestDirectory);

    private static void PendingOnly()
    {
        using var store = Open();
        var record = store.RecordPending(Example);
        Check(record.Status == ProtectedPendingReviewLedger.PendingState);
        Check(record.Review == Example);
        Check(!string.IsNullOrWhiteSpace(record.RequestId));
        Check(store.CountPending() == 1);
        Check(store.ReadPending(Example.ProjectId, Example.Branch, Example.ProposalRef)
            == record);
        Check(store.ReadPending(Example.ProjectId, "other", Example.ProposalRef) is null);
    }

    private static void ExactReplay()
    {
        using var store = Open();
        var first = store.RecordPending(Example);
        var second = store.RecordPending(Example);
        Check(first == second);
        Check(store.CountPending() == 1);
    }

    private static void ConflictingAction()
    {
        using var store = Open();
        var original = store.RecordPending(Example);
        Throws<InvalidOperationException>(() =>
            store.RecordPending(Example with { RequestedAction = "reject" }));
        Check(store.CountPending() == 1);
        Check(store.ReadPending(Example.ProjectId, Example.Branch, Example.ProposalRef)
            == original);
    }

    private static void ChangedEvidence()
    {
        using var store = Open();
        store.RecordPending(Example);
        Throws<InvalidOperationException>(() =>
            store.RecordPending(Example with { SourceEvidenceSha256 = new string('c', 64) }));
        Throws<InvalidOperationException>(() =>
            store.RecordPending(Example with { ReviewSnapshotSha256 = new string('d', 64) }));
        Check(store.CountPending() == 1);
    }

    private static void DifferentProposal()
    {
        using var store = Open();
        store.RecordPending(Example);
        var other = Example with { ProposalRef = "E~9876543210" };
        store.RecordPending(other);
        Check(store.CountPending() == 2);
        Check(store.ReadPending(other.ProjectId, other.Branch, other.ProposalRef)?.Review == other);
    }

    private static void Reopen()
    {
        PendingReviewRecord before;
        using (var first = Open())
            before = first.RecordPending(Example);
        using var second = Open();
        Check(second.RecordPending(Example) == before);
        Check(second.CountPending() == 1);
        Check(second.ReadPending(Example.ProjectId, Example.Branch, Example.ProposalRef) == before);
    }

    private static void Validation()
    {
        using var store = Open();
        Throws<ArgumentException>(() =>
            store.RecordPending(Example with { RevisionSha = "main" }));
        Throws<ArgumentException>(() =>
            store.RecordPending(Example with { ProposalRef = "~pbad" }));
        Throws<ArgumentException>(() =>
            store.RecordPending(Example with { RequestedAction = "approved" }));
        Throws<ArgumentException>(() =>
            store.RecordPending(Example with { ProjectId = "../escape" }));
        Check(store.CountPending() == 0);
        Throws<ArgumentException>(() =>
            ProtectedPendingReviewLedger.OpenInProtectedDirectory(
                Path.Combine(TestDirectory, "missing")));
    }

    private static void WalAndNoClaimSchema()
    {
        using (var store = Open())
        {
            store.RecordPending(Example);
            Check(store.CountPending() == 1);
        }
        var path = Path.Combine(TestDirectory, "review-authority.sqlite3");
        Check(File.Exists(path) && new FileInfo(path).Length > 0);
        using var connection = new SqliteConnection(
            new SqliteConnectionStringBuilder
            {
                DataSource = path,
                Mode = SqliteOpenMode.ReadOnly,
                Pooling = false,
            }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA journal_mode;";
        Check(string.Equals(command.ExecuteScalar()?.ToString(), "wal",
            StringComparison.OrdinalIgnoreCase));
        command.CommandText = "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='claims';";
        Check(Convert.ToInt32(command.ExecuteScalar()) == 0);
        command.CommandText = "SELECT COUNT(*) FROM review_requests WHERE status='awaiting_independent_host_authorization';";
        Check(Convert.ToInt32(command.ExecuteScalar()) == 1);
    }

    private static ReviewMeaning MeaningFor(PendingReview pending)
        => new(pending.ProjectId, pending.Branch, pending.RevisionSha,
            pending.ProposalRef, pending.ReviewSnapshotSha256,
            pending.CanonicalFactSha256, pending.RequestedAction, "Synthetic fact");

    private static void VerifiedConfirm()
    {
        using var store = Open();
        using var key = TestCredential.New();
        var pending = store.RecordPending(Example);
        var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var meaning = MeaningFor(Example);
        var ticket = coordinator.Begin(meaning);
        var finished = coordinator.Complete(ticket.TicketId, meaning, key.Sign(ticket));
        Check(finished.Verified && finished.Status == "verified_intent_recorded_no_claim");
        Check(finished.Disposition == ProtectedPendingReviewLedger.ConfirmDisposition);
        Check(finished.RequestId == pending.RequestId);
        Check(!finished.ClaimWritten && !finished.ApprovedClaim);
        Check(store.CountPending() == 0);
        Check(store.ReadPending(Example.ProjectId, Example.Branch, Example.ProposalRef) is null);
        Check(store.ReadVerifiedIntent(Example.ProjectId, Example.Branch, Example.ProposalRef)?.RequestId
            == pending.RequestId);
        Throws<InvalidOperationException>(() => store.RecordPending(Example));
        var replay = coordinator.Complete(ticket.TicketId, meaning, key.Sign(ticket));
        Check(!replay.Verified && replay.Status == "ticket_missing_or_consumed");
        using var db = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(TestDirectory, "review-authority.sqlite3"),
            Mode = SqliteOpenMode.ReadOnly,
            Pooling = false,
        }.ToString());
        db.Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE name='claims';";
        Check(Convert.ToInt32(cmd.ExecuteScalar()) == 0);
    }

    private static void VerifiedReject()
    {
        using var store = Open();
        using var key = TestCredential.New();
        var reject = Example with { RequestedAction = "reject" };
        store.RecordPending(reject);
        var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var meaning = MeaningFor(reject);
        var ticket = coordinator.Begin(meaning);
        var result = coordinator.Complete(ticket.TicketId, meaning, key.Sign(ticket));
        Check(result.Verified);
        Check(result.Disposition == ProtectedPendingReviewLedger.RejectDisposition);
        Check(store.CountPending() == 0);
        Check(store.ReadVerifiedIntent(reject.ProjectId, reject.Branch, reject.ProposalRef)?
            .ClaimWritten == false);
    }

    private static void StrictReviewScope()
    {
        using var store = Open();
        using var key = TestCredential.New();
        store.RecordPending(Example);
        var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var meaning = MeaningFor(Example);
        Throws<InvalidOperationException>(() =>
            coordinator.Begin(meaning with { RevisionSha = new string('c', 40) }));
        Throws<InvalidOperationException>(() =>
            coordinator.Begin(meaning with { ReviewSnapshotSha256 = new string('d', 64) }));
        Throws<InvalidOperationException>(() =>
            coordinator.Begin(meaning with { CanonicalFact = "Modified fact" }));
        Throws<InvalidOperationException>(() =>
            coordinator.Begin(meaning with { Decision = "reject" }));
        Throws<InvalidOperationException>(() =>
            coordinator.Begin(meaning with { Branch = "feature" }));
        Check(store.CountPending() == 1);
        Check(store.ReadVerifiedIntent(Example.ProjectId, Example.Branch, Example.ProposalRef) is null);
    }

    private static void BadAssertionConsumes()
    {
        using var store = Open();
        using var key = TestCredential.New();
        store.RecordPending(Example);
        var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var meaning = MeaningFor(Example);
        var ticket = coordinator.Begin(meaning);
        var invalid = key.Sign(ticket) with
        {
            SignatureBase64Url = Encode(RandomNumberGenerator.GetBytes(72)),
        };
        var result = coordinator.Complete(ticket.TicketId, meaning, invalid);
        Check(!result.Verified);
        Check(!coordinator.Complete(ticket.TicketId, meaning, key.Sign(ticket)).Verified);
        Check(store.CountPending() == 1);
        Check(store.ReadVerifiedIntent(Example.ProjectId, Example.Branch, Example.ProposalRef) is null);
    }

    private static void VerifiedRestart()
    {
        using var key = TestCredential.New();
        string requestId;
        using (var first = Open())
        {
            requestId = first.RecordPending(Example).RequestId;
            var coordinator = new VerifiedReviewCoordinator(first, key.Pinned);
            var meaning = MeaningFor(Example);
        var ticket = coordinator.Begin(meaning);
            Check(coordinator.Complete(ticket.TicketId, meaning, key.Sign(ticket)).Verified);
        }
        using var reopened = Open();
        Check(reopened.ReadVerifiedIntent(Example.ProjectId, Example.Branch, Example.ProposalRef)
            ?.RequestId == requestId);
        Check(reopened.CountPending() == 0);
        Check(reopened.ReadPending(Example.ProjectId, Example.Branch, Example.ProposalRef) is null);
        Throws<InvalidOperationException>(() => reopened.RecordPending(Example));
        var second = new VerifiedReviewCoordinator(reopened, key.Pinned);
        Throws<InvalidOperationException>(() => second.Begin(MeaningFor(Example)));
    }

    private static void CompetingCoordinators()
    {
        using var firstStore = Open();
        using var secondStore = Open();
        using var key = TestCredential.New();
        firstStore.RecordPending(Example);
        var first = new VerifiedReviewCoordinator(firstStore, key.Pinned);
        var second = new VerifiedReviewCoordinator(secondStore, key.Pinned);
        var meaning = MeaningFor(Example);
        var ticketA = first.Begin(meaning);
        var ticketB = second.Begin(meaning);
        Check(first.Complete(ticketA.TicketId, meaning, key.Sign(ticketA)).Verified);
        var blocked = second.Complete(ticketB.TicketId, meaning, key.Sign(ticketB));
        Check(!blocked.Verified && blocked.Status == "pending_scope_or_commit_denied");
        Check(firstStore.CountPending() == 0);
        Check(secondStore.ReadVerifiedIntent(Example.ProjectId, Example.Branch, Example.ProposalRef)
            is not null);
    }


    private static TrustedReviewSource SourceFor(PendingReview pending,
        string relation = "unrelated", string? target = null)
        => new(pending.ProjectId, pending.Branch, pending.RevisionSha,
            pending.ProposalRef, pending.ReviewSnapshotSha256,
            "Synthetic fact", pending.SourceEvidenceSha256, "knowledge",
            relation, target);

    private static void ProtectedConfirm()
    {
        using var key = TestCredential.New();
        string claimId;
        string requestId;
        using (var store = Open())
        {
            requestId = store.RecordPending(Example).RequestId;
            store.StageSyntheticLabSource(Example, SourceFor(Example));
            var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
            var meaning = MeaningFor(Example);
            var ticket = coordinator.Begin(meaning);
            var result = coordinator.CompleteProtected(ticket.TicketId,
                meaning, key.Sign(ticket));
            Check(result.Verified && result.ClaimWritten && !result.ApprovedClaim);
            Check(result.Status == "protected_claim_written");
            Check(result.RequestId == requestId);
            var claims = store.ReadProtectedClaims(Example.ProjectId, Example.Branch);
            Check(claims.Count == 1);
            var claim = claims[0];
            Check(claim.ClaimId.StartsWith("C~", StringComparison.Ordinal));
            Check(claim.Value == meaning.CanonicalFact);
            Check(claim.RequestId == requestId);
            Check(claim.SourceEvidenceSha256 == Example.SourceEvidenceSha256);
            Check(claim.PolicyVersion == ProtectedPendingReviewLedger.ProtectedClaimPolicyVersion);
            Check(claim.Kind == "knowledge");
            claimId = claim.ClaimId;
            Check(store.CountPending() == 0);
            Check(store.ReadProtectedClaims("github.com/other/repo", Example.Branch).Count == 0);
            Check(store.ReadProtectedClaims(Example.ProjectId, "other").Count == 0);
            Check(!coordinator.CompleteProtected(ticket.TicketId, meaning,
                key.Sign(ticket)).Verified);
            Throws<ArgumentException>(() =>
                store.ReadProtectedClaims(Example.ProjectId, Example.Branch, 101));
        }
        using (var reopened = Open())
        {
            var claims = reopened.ReadProtectedClaims(Example.ProjectId, Example.Branch);
            Check(claims.Count == 1);
            Check(claims[0].ClaimId == claimId);
            Check(claims[0].RequestId == requestId);
            Check(reopened.ReadVerifiedIntent(Example.ProjectId,
                Example.Branch, Example.ProposalRef)?.Disposition
                == ProtectedPendingReviewLedger.ConfirmDisposition);
            Throws<InvalidOperationException>(() => reopened.RecordPending(Example));
        }
    }

    private static void ProtectedReject()
    {
        using var store = Open();
        using var key = TestCredential.New();
        var proposal = Example with { RequestedAction = "reject" };
        store.RecordPending(proposal);
        // Reject a protected related source without ever writing a Claim.
        store.StageSyntheticLabSource(proposal,
            SourceFor(proposal, "contradict", "foreign-claim"));
        var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var meaning = MeaningFor(proposal);
        var ticket = coordinator.Begin(meaning);
        var result = coordinator.CompleteProtected(ticket.TicketId, meaning, key.Sign(ticket));
        Check(result.Verified && !result.ClaimWritten && !result.ApprovedClaim);
        Check(result.Status == "verified_rejection_no_claim");
        Check(result.Disposition == ProtectedPendingReviewLedger.RejectDisposition);
        Check(store.ReadProtectedClaims(proposal.ProjectId, proposal.Branch).Count == 0);
        Check(store.CountPending() == 0);
    }

    private static void SourceRequired()
    {
        using var store = Open();
        using var key = TestCredential.New();
        store.RecordPending(Example);
        var meaning = MeaningFor(Example);
        var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var ticket = coordinator.Begin(meaning);
        var denied = coordinator.CompleteProtected(ticket.TicketId,
            meaning, key.Sign(ticket));
        Check(!denied.Verified
            && denied.Status == "protected_review_source_not_staged");
        Check(!coordinator.CompleteProtected(ticket.TicketId,
            meaning, key.Sign(ticket)).Verified);
        Check(store.CountPending() == 1);
        Check(store.ReadProtectedClaims(Example.ProjectId, Example.Branch).Count == 0);
        Check(store.ReadVerifiedIntent(Example.ProjectId, Example.Branch,
            Example.ProposalRef) is null);

        // Staging the original source in protected SQLite permits a NEW
        // one-time challenge. A consumed proof cannot be replayed.
        store.StageSyntheticLabSource(Example, SourceFor(Example));
        var another = coordinator.Begin(meaning);
        Check(coordinator.CompleteProtected(another.TicketId, meaning,
            key.Sign(another)).Verified);
        Check(store.CountPending() == 0);
    }

    private static void SourceMismatch()
    {
        using var store = Open();
        using var key = TestCredential.New();
        store.RecordPending(Example);
        var source = SourceFor(Example);
        var changes = new[]
        {
            source with { CanonicalFact = "Tampered fact" },
            source with { SourceEvidenceSha256 = new string('e', 64) },
            source with { RevisionSha = new string('c', 40) },
            source with { ReviewSnapshotSha256 = new string('c', 64) },
            source with { ProjectId = "github.com/foreign/repo" },
            source with { Kind = "arbitrary" },
        };
        foreach (var candidate in changes)
            Throws<InvalidOperationException>(() =>
                store.StageSyntheticLabSource(Example, candidate));
        Check(store.CountPending() == 1);
        Check(store.ReadProtectedClaims(Example.ProjectId, Example.Branch).Count == 0);
        Check(store.ReadVerifiedIntent(Example.ProjectId, Example.Branch,
            Example.ProposalRef) is null);

        var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var meaning = MeaningFor(Example);
        var ticket = coordinator.Begin(meaning);
        Check(!coordinator.CompleteProtected(ticket.TicketId, meaning,
            key.Sign(ticket)).Verified);
        Check(store.CountPending() == 1);
    }

    private static void DuplicateRollback()
    {
        using var store = Open();
        using var key = TestCredential.New();
        var first = Example;
        var second = Example with { ProposalRef = "E~9876543210" };
        store.RecordPending(first);
        store.RecordPending(second);
        store.StageSyntheticLabSource(first, SourceFor(first));
        store.StageSyntheticLabSource(second, SourceFor(second));
        var firstCoordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var secondCoordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var firstMeaning = MeaningFor(first);
        var firstTicket = firstCoordinator.Begin(firstMeaning);
        Check(firstCoordinator.CompleteProtected(firstTicket.TicketId,
            firstMeaning, key.Sign(firstTicket)).Verified);

        var secondMeaning = MeaningFor(second);
        var secondTicket = secondCoordinator.Begin(secondMeaning);
        var rejected = secondCoordinator.CompleteProtected(secondTicket.TicketId,
            secondMeaning, key.Sign(secondTicket));
        Check(!rejected.Verified
            && rejected.Status == "protected_review_scope_or_commit_denied");
        Check(store.ReadProtectedClaims(Example.ProjectId, Example.Branch).Count == 1);
        Check(store.CountPending() == 1);
        Check(store.ReadVerifiedIntent(second.ProjectId, second.Branch,
            second.ProposalRef) is null);
        Check(store.ReadPending(second.ProjectId, second.Branch,
            second.ProposalRef) is not null);
    }

    private static void ProtectedRace()
    {
        using var firstStore = Open();
        using var secondStore = Open();
        using var key = TestCredential.New();
        firstStore.RecordPending(Example);
        firstStore.StageSyntheticLabSource(Example, SourceFor(Example));
        var first = new VerifiedReviewCoordinator(firstStore, key.Pinned);
        var second = new VerifiedReviewCoordinator(secondStore, key.Pinned);
        var meaning = MeaningFor(Example);
        var firstTicket = first.Begin(meaning);
        var secondTicket = second.Begin(meaning);
        Check(first.CompleteProtected(firstTicket.TicketId, meaning,
            key.Sign(firstTicket)).Verified);
        Check(!second.CompleteProtected(secondTicket.TicketId, meaning,
            key.Sign(secondTicket)).Verified);
        Check(firstStore.ReadProtectedClaims(Example.ProjectId, Example.Branch).Count == 1);
        Check(secondStore.ReadProtectedClaims(Example.ProjectId, Example.Branch).Count == 1);
    }

    private static void SnapshotImmutable()
    {
        var reference = Example;
        using (var store = Open())
        {
            store.RecordPending(reference);
            store.StageSyntheticLabSource(reference, SourceFor(reference));
            // Exactly identical re-staging is harmless and idempotent.
            store.StageSyntheticLabSource(reference, SourceFor(reference));
            Throws<InvalidOperationException>(() =>
                store.StageSyntheticLabSource(reference,
                    SourceFor(reference) with { Kind = "preference" }));
        }
        using (var reopened = Open())
        {
            // Service-owned snapshot persists across database close/reopen.
            using var key = TestCredential.New();
            var coordinator = new VerifiedReviewCoordinator(reopened, key.Pinned);
            var meaning = MeaningFor(reference);
            var ticket = coordinator.Begin(meaning);
            var confirmed = coordinator.CompleteProtected(ticket.TicketId,
                meaning, key.Sign(ticket));
            Check(confirmed.Verified && confirmed.ClaimWritten);
            Throws<InvalidOperationException>(() =>
                reopened.StageSyntheticLabSource(reference, SourceFor(reference)));
        }
        // Even a direct SQLite update cannot change the immutable snapshot
        // after staging. The directory's service-SID ACL protects against
        // unprivileged file access in the native SCM integration test.
        using var sql = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(TestDirectory, "review-authority.sqlite3"),
            Mode = SqliteOpenMode.ReadWrite, Pooling = false,
        }.ToString());
        sql.Open();
        using var update = sql.CreateCommand();
        update.CommandText = "UPDATE protected_review_sources SET canonical_fact='forged';";
        Throws<SqliteException>(() => update.ExecuteNonQuery());
        using var deletion = sql.CreateCommand();
        deletion.CommandText = "DELETE FROM protected_review_sources;";
        Throws<SqliteException>(() => deletion.ExecuteNonQuery());
    }

    private static void TargetedConfirmDenied()
    {
        using var store = Open();
        using var key = TestCredential.New();
        store.RecordPending(Example);
        store.StageSyntheticLabSource(Example,
            SourceFor(Example, "update", "existing-other-claim"));
        var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var meaning = MeaningFor(Example);
        var ticket = coordinator.Begin(meaning);
        var result = coordinator.CompleteProtected(ticket.TicketId,
            meaning, key.Sign(ticket));
        Check(!result.Verified);
        Check(result.Status == "protected_review_scope_or_commit_denied");
        Check(store.ReadVerifiedIntent(Example.ProjectId, Example.Branch,
            Example.ProposalRef) is null);
        Check(store.ReadProtectedClaims(Example.ProjectId, Example.Branch).Count == 0);
        Check(store.CountPending() == 1);
    }

    private const string RealProject = "github.com/example/operator-evidence";
    private const string RealBranch = "main";
    private const string RealProposalId = "actual-canonical-evidence-proposal-id";
    private const string RealFact = "This real-schema E~ proposal has linked Evidence but no human approval.";

    private static string RealERef => "E~" + Hash(RealProposalId)[..10];
    private static string RealSnapshotPath => Path.Combine(TestDirectory,
        ProtectedPendingReviewLedger.OperatorSnapshotFile);

    private static void CreateRealEvidenceFixture()
    {
        using (var conn = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = RealSnapshotPath, Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
        }.ToString()))
        {
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE memory_evidence_proposals (
                  id TEXT PRIMARY KEY, project_id TEXT, branch TEXT, kind TEXT,
                  canonical_fact TEXT, status TEXT, policy_version TEXT,
                  fingerprint TEXT NOT NULL);
                CREATE TABLE memory_evidence_proposal_evidence (
                  proposal_id TEXT, evidence_id TEXT,
                  PRIMARY KEY(proposal_id, evidence_id));
                CREATE TABLE evidence (
                  id TEXT PRIMARY KEY, project_id TEXT, branch TEXT,
                  authority_class TEXT, sensitivity TEXT,
                  content_redacted TEXT, metadata_json TEXT);
                CREATE TABLE claims (
                  id TEXT PRIMARY KEY, project_id TEXT, branch_scope TEXT,
                  state TEXT, value_text TEXT);
                """;
            cmd.ExecuteNonQuery();
            using var insert = conn.CreateCommand();
            insert.CommandText = """
                INSERT INTO memory_evidence_proposals
                 (id,project_id,branch,kind,canonical_fact,status,
                  policy_version,fingerprint)
                VALUES ($id,$p,$b,'knowledge',$fact,'needs_confirmation',
                  'test-v1',$fingerprint);
                INSERT INTO memory_evidence_proposal_evidence
                 (proposal_id,evidence_id) VALUES ($id,'real-evidence-1');
                INSERT INTO evidence
                 (id,project_id,branch,authority_class,sensitivity,
                  content_redacted,metadata_json)
                VALUES ('real-evidence-1',$p,$b,'user_direct','normal',
                  'Unverified user-supplied evidence text','{"event_type":"user_prompt"}');
                """;
            insert.Parameters.AddWithValue("$id", RealProposalId);
            insert.Parameters.AddWithValue("$p", RealProject);
            insert.Parameters.AddWithValue("$b", RealBranch);
            insert.Parameters.AddWithValue("$fact", RealFact);
            insert.Parameters.AddWithValue("$fingerprint",
                Hash("knowledge\0" + RealFact.ToLowerInvariant()));
            insert.ExecuteNonQuery();
        }
        File.WriteAllText(Path.Combine(TestDirectory,
            ProtectedPendingReviewLedger.OperatorManifestFile),
            JsonSerializer.Serialize(new
            {
                projectId = RealProject,
                branch = RealBranch,
                revisionSha = new string('b', 40),
                proposalRef = RealERef,
                decision = "confirm",
            }));
    }

    private static void MutateRealSnapshot(string statement)
    {
        using var conn = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = RealSnapshotPath, Mode = SqliteOpenMode.ReadWrite,
            Pooling = false,
        }.ToString());
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = statement;
        cmd.ExecuteNonQuery();
    }

    private static void RealEvidenceImport()
    {
        CreateRealEvidenceFixture();
        string request;
        using (var store = Open())
        {
            var review = store.ImportOperatorPinnedEvidence();
            Check(review.ProposalRef == RealERef
                && review.CanonicalFact == RealFact
                && review.Kind == "knowledge"
                && review.EvidenceCount == 1
                && review.SourceOrigin == ProtectedPendingReviewLedger.OperatorSourceOrigin
                && !review.HumanApprovalVerified && !review.ClaimWritten);
            Check(store.CountPending() == 1);
            Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
            Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
            request = review.PendingRequestId;
            var repeated = store.ImportOperatorPinnedEvidence();
            Check(repeated.PendingRequestId == request);

            // Prove that a synthetic ES256 passkey can NEVER finalize REAL E~
            // imports without independent credential enrollment.
            using var credential = TestCredential.New();
            var meaning = new ReviewMeaning(RealProject, RealBranch,
                new string('b', 40), RealERef, review.ReviewSnapshotSha256,
                review.CanonicalFactSha256, "confirm", RealFact);
            var coordinator = new VerifiedReviewCoordinator(store, credential.Pinned);
            var ticket = coordinator.Begin(meaning);
            var denied = coordinator.CompleteProtected(
                ticket.TicketId, meaning, credential.Sign(ticket));
            Check(!denied.Verified && !denied.ClaimWritten
                && denied.Status == "protected_review_scope_or_commit_denied");
            Check(store.CountPending() == 1);
            Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
        }
        using (var reopened = Open())
        {
            Check(reopened.ReadPending(RealProject, RealBranch, RealERef)?.RequestId
                == request);
            Check(reopened.ImportOperatorPinnedEvidence().PendingRequestId == request);
            Check(reopened.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
        }
    }

    private static void RealEvidenceScopeDenied()
    {
        CreateRealEvidenceFixture();
        MutateRealSnapshot("UPDATE evidence SET project_id='github.com/foreign/claim';");
        using var store = Open();
        Throws<InvalidOperationException>(() => store.ImportOperatorPinnedEvidence());
        Check(store.CountPending() == 0);
        MutateRealSnapshot("""
            UPDATE evidence SET project_id='github.com/example/operator-evidence',
            sensitivity='secret_redacted';
            """);
        Throws<InvalidOperationException>(() => store.ImportOperatorPinnedEvidence());
        Check(store.CountPending() == 0);
    }

    private static void RealEvidenceUnsafeDenied()
    {
        CreateRealEvidenceFixture();
        MutateRealSnapshot("""
            INSERT INTO claims (id,project_id,branch_scope,state,value_text)
            VALUES ('prior','github.com/example/operator-evidence','main',
                    'active','Existing fact');
            """);
        using var store = Open();
        Throws<InvalidOperationException>(() => store.ImportOperatorPinnedEvidence());
        Check(store.CountPending() == 0);
        MutateRealSnapshot("DELETE FROM claims; UPDATE memory_evidence_proposals SET kind='procedure';");
        Throws<InvalidOperationException>(() => store.ImportOperatorPinnedEvidence());
        Check(store.CountPending() == 0);
    }

    private static void RealEvidenceChanged()
    {
        CreateRealEvidenceFixture();
        using var store = Open();
        var first = store.ImportOperatorPinnedEvidence();
        MutateRealSnapshot("""
            UPDATE evidence SET content_redacted='Agent changed the original source';
            """);
        Throws<InvalidOperationException>(() => store.ImportOperatorPinnedEvidence());
        Check(store.ReadPending(RealProject, RealBranch, RealERef)?.RequestId
            == first.PendingRequestId);
        Check(store.CountPending() == 1);
        Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
    }

    private static void WriteOperatorPin(PinnedCredential credential)
    {
        File.WriteAllText(Path.Combine(TestDirectory,
            ProtectedPendingReviewLedger.OperatorCredentialFile),
            JsonSerializer.Serialize(new
            {
                protocol = ProtectedPendingReviewLedger.OperatorCredentialPolicy,
                credentialId = credential.CredentialIdBase64Url,
                publicKeyPem = credential.PublicKeyPem,
                expectedOrigin = credential.ExpectedOrigin,
            }));
    }

    private static ReviewMeaning RealReviewMeaning(OperatorEvidenceImport evidence)
        => new(evidence.ProjectId, evidence.Branch, evidence.RevisionSha,
            evidence.ProposalRef, evidence.ReviewSnapshotSha256,
            evidence.CanonicalFactSha256, evidence.RequestedAction,
            evidence.CanonicalFact);

    private static void OperatorPinProof()
    {
        CreateRealEvidenceFixture();
        using var userCredential = TestCredential.New();
        WriteOperatorPin(userCredential.Pinned);
        using (var store = Open())
        {
            var evidence = store.ImportOperatorPinnedEvidence();
            var staged = store.StageUnverifiedOperatorCredential();
            Check(staged.Credential == userCredential.Pinned
                && staged.EnrollmentState ==
                   ProtectedPendingReviewLedger.OperatorCredentialState
                && !staged.CredentialRegistrationTrusted
                && !staged.HumanApprovalVerified
                && staged.LastSignCount == 0);
            Check(store.StageUnverifiedOperatorCredential() == staged);
            var coordinator = VerifiedReviewCoordinator.ForOperatorCredentialProbe(store);
            var meaning = RealReviewMeaning(evidence);
            var challenge = coordinator.BeginOperatorProof(meaning);
            var proof = coordinator.CompleteOperatorProof(challenge.TicketId,
                meaning, userCredential.Sign(challenge));
            Check(proof.Verified
                && proof.Status == "operator_webauthn_uv_verified_not_approved"
                && !proof.ApprovedClaim && !proof.ClaimWritten);
            Check(store.ReadOperatorCredential()?.LastSignCount == 1);
            Check(store.CountPending() == 1);
            Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
            Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
            Check(!coordinator.CompleteOperatorProof(challenge.TicketId,
                meaning, userCredential.Sign(challenge)).Verified);
            Check(!coordinator.CompleteProtected(challenge.TicketId,
                meaning, userCredential.Sign(challenge)).Verified);
        }
        using var reopened = Open();
        Check(reopened.ReadOperatorCredential()?.Credential == userCredential.Pinned);
        Check(reopened.ReadOperatorCredential()?.LastSignCount == 1);
        Check(reopened.CountPending() == 1);
        Check(reopened.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
    }

    private static void OperatorCounter()
    {
        CreateRealEvidenceFixture();
        using var userCredential = TestCredential.New();
        WriteOperatorPin(userCredential.Pinned);
        using (var store = Open())
        {
            var evidence = store.ImportOperatorPinnedEvidence();
            store.StageUnverifiedOperatorCredential();
            var coordinator = VerifiedReviewCoordinator.ForOperatorCredentialProbe(store);
            var meaning = RealReviewMeaning(evidence);
            var first = coordinator.BeginOperatorProof(meaning);
            Check(coordinator.CompleteOperatorProof(first.TicketId,
                meaning, userCredential.Sign(first)).Verified);
        }
        using var reopened = Open();
        var current = reopened.ImportOperatorPinnedEvidence();
        var other = VerifiedReviewCoordinator.ForOperatorCredentialProbe(reopened);
        var otherMeaning = RealReviewMeaning(current);
        var replay = other.BeginOperatorProof(otherMeaning);
        var denied = other.CompleteOperatorProof(replay.TicketId,
            otherMeaning, userCredential.Sign(replay, forcedSignCount: 1));
        Check(!denied.Verified
            && denied.Status == "operator_proof_scope_or_counter_denied");
        Check(reopened.ReadOperatorCredential()?.LastSignCount == 1);
        var fresh = other.BeginOperatorProof(otherMeaning);
        var allowed = other.CompleteOperatorProof(fresh.TicketId,
            otherMeaning, userCredential.Sign(fresh, forcedSignCount: 2));
        Check(allowed.Verified && !allowed.ApprovedClaim && !allowed.ClaimWritten);
        Check(reopened.ReadOperatorCredential()?.LastSignCount == 2);
        Check(reopened.CountPending() == 1);
        Check(reopened.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
    }

    private static void OperatorPinImmutable()
    {
        CreateRealEvidenceFixture();
        using var original = TestCredential.New();
        using var replacement = TestCredential.New();
        WriteOperatorPin(original.Pinned);
        using var store = Open();
        store.ImportOperatorPinnedEvidence();
        store.StageUnverifiedOperatorCredential();
        WriteOperatorPin(replacement.Pinned);
        Throws<InvalidOperationException>(() =>
            store.StageUnverifiedOperatorCredential());
        Check(store.ReadOperatorCredential()?.Credential == original.Pinned);
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(TestDirectory, "review-authority.sqlite3"),
            Mode = SqliteOpenMode.ReadWrite, Pooling = false,
        }.ToString());
        connection.Open();
        using var change = connection.CreateCommand();
        change.CommandText = """
            UPDATE protected_operator_credentials
            SET credential_id='forged';
            """;
        Throws<SqliteException>(() => change.ExecuteNonQuery());
        using var deletion = connection.CreateCommand();
        deletion.CommandText = "DELETE FROM protected_operator_credentials;";
        Throws<SqliteException>(() => deletion.ExecuteNonQuery());
    }

    private static void OperatorDenied()
    {
        CreateRealEvidenceFixture();
        using var original = TestCredential.New();
        using var outsider = TestCredential.New();
        WriteOperatorPin(original.Pinned);
        using var store = Open();
        var evidence = store.ImportOperatorPinnedEvidence();
        var meaning = RealReviewMeaning(evidence);
        Throws<InvalidOperationException>(() =>
            VerifiedReviewCoordinator.ForOperatorCredentialProbe(store));
        store.StageUnverifiedOperatorCredential();
        var protectedCoordinator =
            VerifiedReviewCoordinator.ForOperatorCredentialProbe(store);
        Throws<InvalidOperationException>(() => protectedCoordinator.Begin(meaning));
        var ticket = protectedCoordinator.BeginOperatorProof(meaning);
        var forged = protectedCoordinator.CompleteOperatorProof(ticket.TicketId,
            meaning, outsider.Sign(ticket));
        Check(!forged.Verified);
        Check(store.ReadOperatorCredential()?.LastSignCount == 0);
        var injected = new VerifiedReviewCoordinator(store, outsider.Pinned);
        Throws<InvalidOperationException>(() =>
            injected.BeginOperatorProof(meaning));
        var generalTicket = injected.Begin(meaning);
        Check(!injected.CompleteProtected(generalTicket.TicketId,
            meaning, outsider.Sign(generalTicket)).Verified);
        Check(store.CountPending() == 1);
        Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
    }

    private static string Encode(byte[] data)
        => Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed class TestCredential : IDisposable
    {
        private readonly ECDsa _key;
        private uint _signCount;
        public PinnedCredential Pinned { get; }

        private TestCredential(ECDsa key)
        {
            _key = key;
            Pinned = new PinnedCredential(
                Encode(RandomNumberGenerator.GetBytes(32)),
                key.ExportSubjectPublicKeyInfoPem(), "http://localhost:4328");
        }

        public static TestCredential New()
            => new(ECDsa.Create(ECCurve.NamedCurves.nistP256));

        public BrowserAssertion Sign(ChallengeTicket ticket, uint? forcedSignCount = null)
        {
            var client = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(
                new Dictionary<string, object>
                {
                    ["type"] = "webauthn.get",
                    ["challenge"] = ticket.ChallengeBase64Url,
                    ["origin"] = Pinned.ExpectedOrigin,
                    ["crossOrigin"] = false,
                }));
            var authenticator = new byte[37];
            SHA256.HashData(Encoding.UTF8.GetBytes("localhost")).CopyTo(authenticator, 0);
            authenticator[32] = 0x05;
            BinaryPrimitives.WriteUInt32BigEndian(authenticator.AsSpan(33),
                forcedSignCount ?? checked(++_signCount));
            var signed = new byte[authenticator.Length + 32];
            authenticator.CopyTo(signed, 0);
            SHA256.HashData(client).CopyTo(signed, authenticator.Length);
            var signature = _key.SignData(
                signed, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
            return new BrowserAssertion(Pinned.CredentialIdBase64Url,
                "public-key", Encode(client), Encode(authenticator), Encode(signature));
        }

        public void Dispose() => _key.Dispose();
    }

    private static string Hash(string value)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static void Check(bool pass)
    {
        if (!pass) throw new InvalidOperationException("synthetic_store_assertion_failed");
    }

    private static void Throws<T>(Action action) where T : Exception
    {
        try { action(); }
        catch (T) { return; }
        throw new InvalidOperationException("expected_" + typeof(T).Name);
    }
}
