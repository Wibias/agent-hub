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
        Run("protected_claim_requires_approval_purpose_not_possession", ProtectedPurposeGate);
        Run("protected_rejection_never_creates_claim", ProtectedReject);
        Run("protected_write_requires_independent_trusted_source", SourceRequired);
        Run("protected_write_rejects_stale_and_targeted_source", SourceMismatch);
        Run("protected_duplicate_rolls_back_uv_intent_and_claim", DuplicateRollback);
        Run("protected_competing_tickets_commit_only_once", ProtectedRace);
        Run("protected_snapshot_immutable_and_reopens_with_same_request", SnapshotImmutable);
        Run("protected_targeted_confirmation_refused", TargetedConfirmDenied);
        Run("real_evidence_import_pending_without_claim", RealEvidenceImport);
        Run("real_procedure_pending_without_claim_or_approval", RealProcedurePendingNoClaim);
        Run("fully_judged_pending_procedure_unverified_intake", RealJudgedPendingProcedure);
        Run("unjudged_pending_and_invalid_relation_denied", RealPendingJudgmentDenied);
        Run("real_evidence_wrong_scope_and_secret_denied", RealEvidenceScopeDenied);
        Run("real_evidence_relation_and_kind_denied", RealEvidenceUnsafeDenied);
        Run("real_evidence_changed_snapshot_denied", RealEvidenceChanged);
        Run("operator_credential_pinned_uv_real_evidence_no_approval", OperatorPinProof);
        Run("operator_credential_counter_restart_replay_denied", OperatorCounter);
        Run("operator_credential_pin_conflict_and_sql_immutability", OperatorPinImmutable);
        Run("operator_credential_wrong_key_and_generic_approval_denied", OperatorDenied);
        Run("native_operator_enrollment_persists_but_creates_no_claim", NativeOperatorEnrolled);
        Run("native_enrollment_does_not_upgrade_a_pinned_unverified_key", NativeOperatorCannotUpgrade);
        Run("native_operator_reaffirmation_intent_persists_no_claim", ReaffirmationNoClaim);
        Run("operator_reaffirmation_unverified_pin_denied", ReaffirmationUnverifiedDenied);
        Run("operator_reaffirmation_procedure_denied", ReaffirmationProcedureDenied);
        Run("user_direct_claim_requires_prior_reaffirmation", DirectClaimNeedsReaffirmation);
        Run("user_direct_claim_commit_wal_restart_scope_provenance", DirectClaimCommit);
        Run("user_direct_claim_commit_cross_purpose_and_counter_replay_denied", DirectClaimBadPurpose);
        Run("user_direct_claim_duplicate_denied_without_counter_advance", DirectClaimNoDuplicate);
        Run("read_enrollment_atomic_revoke_survives_sqlite_reopen", DirectReadRevokeRestart);
        Run("read_enrollment_wrong_pin_and_scope_deny_no_reenable", DirectReadWrongPinAndScope);
        Run("project_read_candidate_pending_never_grants", ProjectReadCandidatePending);
        Run("project_read_candidate_exact_replay_and_conflict", ProjectReadCandidateConflicts);
        Run("project_read_candidate_withdraw_durable_no_reenroll", ProjectReadCandidateWithdraw);
        Run("project_read_candidate_schema_tamper_denied", ProjectReadCandidateSqlImmutable);
        Run("ci_read_once_consume_persists_after_reopen", CiReadOnceConsumedRestart);
        Run("ci_read_once_abort_revocation_latches_after_reopen", CiReadOnceRevokeRestart);
        Run("ci_read_once_foreign_binding_and_expiration_refused", CiReadOnceWrongBinding);
        Run("ci_read_once_sql_receipt_and_tombstone_immutable", CiReadOnceSqlImmutable);
        Run("ci_read_once_full_snapshot_digest_changes_on_every_state_transition",
            CiReadOnceFenceSnapshotChanges);
        Console.WriteLine($"MEMORY_REVIEW_LEDGER PASS {_passed}/54; REAL_EVIDENCE_UV_PINNED_NO_APPROVAL");
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

    private static ReadDisclosureMeaning CiReadMeaning(
        string? request = null,string? recipient = null)
        => new(ProtectedPendingReviewLedger.CiOneShotProject,
            ProtectedPendingReviewLedger.CiOneShotBranch,
            new string('c',40), "S-1-5-21-111-222-333-1001",
            request??new string('a',48),new string('d',64),
            new string('e',64),recipient??new string('b',64));

    private const string CiReadClaim = "C~ffffffffffffffffffffffff";
    private const string CiReadProposal = "E~0123456789";
    private const uint CiReadPid = 1001;

    private static void CiReadOnceFenceSnapshotChanges()
    {
        var meaning=CiReadMeaning();
        string previous;
        using(var db=Open())
        {
            var baseline=db.ReadCiOneShotFenceSnapshot();
            Check(baseline.Receipts==0 && !baseline.Revoked
                && baseline.Sha256.Length==64);
            previous=baseline.Sha256;
            Check(db.ReserveCiOneShot(meaning,CiReadClaim,CiReadProposal,
                CiReadPid,DateTimeOffset.UtcNow.AddMinutes(1)));
            var reserved=db.ReadCiOneShotFenceSnapshot();
            Check(reserved.Receipts==1 && !reserved.Revoked
                && reserved.Sha256!=previous);
            previous=reserved.Sha256;
            Check(db.AbortCiOneShot(meaning.RequestId));
            var aborted=db.ReadCiOneShotFenceSnapshot();
            Check(aborted.Receipts==1 && !aborted.Revoked
                && aborted.Sha256!=previous);
            previous=aborted.Sha256;
            Check(db.RevokeCiOneShot());
            var revoked=db.ReadCiOneShotFenceSnapshot();
            Check(revoked.Receipts==1 && revoked.Revoked
                && revoked.Sha256!=previous);
            previous=revoked.Sha256;
        }
        using(var reopened=Open())
        {
            var persisted=reopened.ReadCiOneShotFenceSnapshot();
            Check(persisted.Receipts==1 && persisted.Revoked
                && persisted.Sha256==previous);
            Check(!reopened.RevokeCiOneShot());
            Check(reopened.ReadCiOneShotFenceSnapshot().Sha256==previous);
        }
    }

    private static void CiReadOnceConsumedRestart()
    {
        var m=CiReadMeaning();
        var expiry=DateTimeOffset.UtcNow.AddSeconds(60);
        using(var db=Open())
        {
            Check(!db.IsCiOneShotRevoked());
            Check(db.ReserveCiOneShot(m,CiReadClaim,CiReadProposal,
                CiReadPid,expiry));
            Check(db.ReadCiOneShotState(m.RequestId)=="reserved");
            Check(!db.ReserveCiOneShot(m,CiReadClaim,CiReadProposal,
                CiReadPid,expiry));
            Check(db.ConsumeCiOneShotBeforeIo(m,CiReadClaim,
                CiReadProposal,CiReadPid));
            Check(db.ReadCiOneShotState(m.RequestId)=="consumed_pre_io");
            Check(!db.ConsumeCiOneShotBeforeIo(m,CiReadClaim,
                CiReadProposal,CiReadPid));
            Check(!db.AbortCiOneShot(m.RequestId));
        }
        using(var reopened=Open())
        {
            Check(reopened.ReadCiOneShotState(m.RequestId)=="consumed_pre_io");
            Check(!reopened.ConsumeCiOneShotBeforeIo(
                m,CiReadClaim,CiReadProposal,CiReadPid));
            Check(!reopened.ReserveCiOneShot(m,CiReadClaim,
                CiReadProposal,CiReadPid,expiry));
        }
    }

    private static void CiReadOnceRevokeRestart()
    {
        var aborted=CiReadMeaning(new string('1',48),new string('2',64));
        var pending=CiReadMeaning(new string('3',48),new string('4',64));
        var future=CiReadMeaning(new string('5',48),new string('6',64));
        var expiry=DateTimeOffset.UtcNow.AddMinutes(2);
        using(var db=Open())
        {
            Check(db.ReserveCiOneShot(aborted,CiReadClaim,CiReadProposal,
                CiReadPid,expiry));
            Check(db.AbortCiOneShot(aborted.RequestId));
            Check(db.ReadCiOneShotState(aborted.RequestId)=="aborted");
            Check(!db.ConsumeCiOneShotBeforeIo(aborted,
                CiReadClaim,CiReadProposal,CiReadPid));
            Check(db.ReserveCiOneShot(pending,CiReadClaim,CiReadProposal,
                CiReadPid+1,expiry));
            Check(db.RevokeCiOneShot());
            Check(!db.RevokeCiOneShot());
            Check(db.IsCiOneShotRevoked());
            Check(db.ReadCiOneShotState(pending.RequestId)=="aborted");
            Check(!db.ReserveCiOneShot(future,CiReadClaim,CiReadProposal,
                CiReadPid+2,expiry));
            Check(!db.ConsumeCiOneShotBeforeIo(pending,
                CiReadClaim,CiReadProposal,CiReadPid+1));
        }
        using(var db=Open())
        {
            Check(db.IsCiOneShotRevoked());
            Check(db.ReadCiOneShotState(aborted.RequestId)=="aborted");
            Check(db.ReadCiOneShotState(pending.RequestId)=="aborted");
            Check(!db.ReserveCiOneShot(future,CiReadClaim,CiReadProposal,
                CiReadPid+2,DateTimeOffset.UtcNow.AddSeconds(70)));
        }
    }

    private static void CiReadOnceWrongBinding()
    {
        var m=CiReadMeaning();
        using var db=Open();
        Throws<ArgumentException>(()=>db.ReserveCiOneShot(
            m with {ProjectId="github.com/unapproved/repo"},
            CiReadClaim,CiReadProposal,CiReadPid,
            DateTimeOffset.UtcNow.AddMinutes(1)));
        Throws<ArgumentException>(()=>db.ReserveCiOneShot(
            m,CiReadClaim,"E~not-a-ref",CiReadPid,
            DateTimeOffset.UtcNow.AddMinutes(1)));
        Check(db.ReserveCiOneShot(m,CiReadClaim,CiReadProposal,
            CiReadPid,DateTimeOffset.UtcNow.AddSeconds(60)));
        Check(!db.ConsumeCiOneShotBeforeIo(
            m with {RecipientSessionSha256=new string('f',64)},
            CiReadClaim,CiReadProposal,CiReadPid));
        Check(!db.ConsumeCiOneShotBeforeIo(m,CiReadClaim,
            CiReadProposal,CiReadPid+1));
        Check(!db.ConsumeCiOneShotBeforeIo(m,CiReadClaim,
            "E~1111111111",CiReadPid));
        Check(db.ReadCiOneShotState(m.RequestId)=="reserved");
        Check(db.ConsumeCiOneShotBeforeIo(m,CiReadClaim,
            CiReadProposal,CiReadPid));
        var expired=CiReadMeaning(new string('7',48),new string('8',64));
        Check(db.ReserveCiOneShot(expired,CiReadClaim,CiReadProposal,
            CiReadPid,DateTimeOffset.UtcNow.AddMilliseconds(250)));
        Thread.Sleep(350);
        Check(!db.ConsumeCiOneShotBeforeIo(expired,CiReadClaim,
            CiReadProposal,CiReadPid));
        Check(db.AbortCiOneShot(expired.RequestId));
    }

    private static void CiReadOnceSqlImmutable()
    {
        var m=CiReadMeaning();
        using(var db=Open())
        {
            Check(db.ReserveCiOneShot(m,CiReadClaim,CiReadProposal,
                CiReadPid,DateTimeOffset.UtcNow.AddMinutes(2)));
            Check(db.ConsumeCiOneShotBeforeIo(m,CiReadClaim,
                CiReadProposal,CiReadPid));
            Check(db.RevokeCiOneShot());
        }
        using var connection=new SqliteConnection(
            new SqliteConnectionStringBuilder
            {
                DataSource=Path.Combine(TestDirectory,"review-authority.sqlite3"),
                Mode=SqliteOpenMode.ReadWrite,
                Pooling=false, Cache=SqliteCacheMode.Private,
            }.ToString());
        connection.Open();
        void InvalidSql(string sql)
        {
            using var command=connection.CreateCommand();
            command.CommandText=sql;
            Throws<SqliteException>(()=>command.ExecuteNonQuery());
        }
        InvalidSql("UPDATE protected_ci_read_once_receipts SET state='reserved';");
        InvalidSql("DELETE FROM protected_ci_read_once_receipts;");
        InvalidSql("DELETE FROM protected_ci_read_once_revocations;");
        InvalidSql("UPDATE protected_ci_read_once_revocations SET revoked_utc='forged';");
        using var reopened=Open();
        Check(reopened.IsCiOneShotRevoked());
        Check(reopened.ReadCiOneShotState(m.RequestId)=="consumed_pre_io");
    }

    private static void DirectReadRevokeRestart()
    {
        const string user = ProtectedPendingReviewLedger.UserDirectReadCiLane;
        const string admin = ProtectedPendingReviewLedger.AdminDirectReadCiLane;
        const string sid = "S-1-5-21-111-222-333-1001";
        const string project = "github.com/example/operator-evidence";
        var revision = new string('a',40);
        var pin = new string('b',64);
        using (var store = Open())
        {
            Check(store.ReadDirectReadCiEnrollmentState(user) == "never_enrolled");
            Check(store.BindInitialDirectReadCiEnrollment(
                user,pin,sid,project,"main",revision));
            Check(store.BindInitialDirectReadCiEnrollment(
                admin,pin,sid,project,"main",revision));
            Check(store.DirectReadCiEnrollmentActive(user,pin));
            Check(store.DirectReadCiEnrollmentActive(admin,pin));
            store.RevokeDirectReadCiEnrollment(user,pin);
            Check(store.ReadDirectReadCiEnrollmentState(user) ==
                "revoked_durable_ci_only");
            Check(!store.DirectReadCiEnrollmentActive(user,pin));
            Check(!store.BindInitialDirectReadCiEnrollment(
                user,pin,sid,project,"main",revision));
            Check(store.DirectReadCiEnrollmentActive(admin,pin));
        }
        using (var reopened = Open())
        {
            Check(reopened.ReadDirectReadCiEnrollmentState(user) ==
                "revoked_durable_ci_only");
            Check(!reopened.ReconcileDirectReadCiStartup(user,pin));
            Check(!reopened.BindInitialDirectReadCiEnrollment(
                user,pin,sid,project,"main",revision));
            Check(reopened.ReconcileDirectReadCiStartup(admin,pin));
            Check(!reopened.ReconcileDirectReadCiStartup(admin,null));
            Check(reopened.ReadDirectReadCiEnrollmentState(admin) ==
                "revoked_durable_ci_only");
        }
        using var last = Open();
        Check(last.ReadDirectReadCiEnrollmentState(user) ==
            "revoked_durable_ci_only");
        Check(last.ReadDirectReadCiEnrollmentState(admin) ==
            "revoked_durable_ci_only");
        Check(!last.ReconcileDirectReadCiStartup(user,pin));
        Check(!last.ReconcileDirectReadCiStartup(admin,pin));
        Check(!last.BindInitialDirectReadCiEnrollment(
            user,pin,sid,project,"main",revision));
    }

    private static void DirectReadWrongPinAndScope()
    {
        const string user = ProtectedPendingReviewLedger.UserDirectReadCiLane;
        const string sid = "S-1-5-21-111-222-333-1001";
        const string project = "github.com/example/operator-evidence";
        var rev = new string('c',40);
        var pin = new string('d',64);
        using (var store = Open())
        {
            Throws<ArgumentException>(() =>
                store.BindInitialDirectReadCiEnrollment(
                    "other",pin,sid,project,"main",rev));
            Throws<ArgumentException>(() =>
                store.BindInitialDirectReadCiEnrollment(
                    user,pin,sid,"github.com/unapproved/repo","main",rev));
            Throws<ArgumentException>(() =>
                store.BindInitialDirectReadCiEnrollment(
                    user,pin,"S-1-5-32-544",project,"main",rev));
            Check(store.ReadDirectReadCiEnrollmentState(user) == "never_enrolled");
            Check(store.BindInitialDirectReadCiEnrollment(
                user,pin,sid,project,"main",rev));
            Check(!store.BindInitialDirectReadCiEnrollment(
                user,new string('e',64),sid,project,"main",rev));
            Check(!store.BindInitialDirectReadCiEnrollment(
                user,pin,"S-1-5-21-111-222-333-1002",project,"main",rev));
            Check(!store.ReconcileDirectReadCiStartup(
                user,new string('f',64)));
            Check(!store.ReconcileDirectReadCiStartup(user,pin));
            Check(store.ReadDirectReadCiEnrollmentState(user) ==
                "revoked_durable_ci_only");
        }
        using (var reopened = Open())
        {
            Check(!reopened.BindInitialDirectReadCiEnrollment(
                user,pin,sid,project,"main",rev));
            Check(!reopened.DirectReadCiEnrollmentActive(user,pin));
        }
        using var sql = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(TestDirectory, "review-authority.sqlite3"),
            Mode = SqliteOpenMode.ReadWrite, Pooling = false,
        }.ToString());
        sql.Open();
        using var update = sql.CreateCommand();
        update.CommandText = """
            UPDATE protected_direct_read_enrollment_events
            SET event_kind='enrolled' WHERE event_number=2;
            """;
        Throws<SqliteException>(() => update.ExecuteNonQuery());
        using var remove = sql.CreateCommand();
        remove.CommandText = """
            DELETE FROM protected_direct_read_enrollment_events
            WHERE event_number=2;
            """;
        Throws<SqliteException>(() => remove.ExecuteNonQuery());
    }


    private static ProtectedProjectReadRequest RealReadCandidate() => new(
        "github.com/wibias/agent-hub", "main", new string('a',40),
        "S-1-5-21-111-222-333-1001",new string('b',64),new string('c',64));

    private static void ProjectReadCandidatePending()
    {
        var request = RealReadCandidate();
        using var store = Open();
        // Default OFF even for a service-owned Store open.
        Throws<SqliteException>(() => store.RecordProjectReadCandidate(request));
        store.InitializeProjectReadIntakePreviewSchema();
        var item = store.RecordProjectReadCandidate(request);
        Check(item.CandidateId.Length == 48);
        Check(item.State == ProtectedPendingReviewLedger.ProjectReadPending);
        Check(item.Request == request);
        Check(store.ReadProjectReadCandidate(request) == item);
        Check(store.ReadProjectReadCandidate(request with {
            Branch = "feature/new-branch" }) is null);
        // There is intentionally no activation/Claim/read-authorization API.
        Check(store.ReadDirectReadCiEnrollmentState(
            ProtectedPendingReviewLedger.UserDirectReadCiLane) == "never_enrolled");
    }

    private static void ProjectReadCandidateConflicts()
    {
        var request = RealReadCandidate();
        using var store = Open();
        store.InitializeProjectReadIntakePreviewSchema();
        var item = store.RecordProjectReadCandidate(request);
        Check(store.RecordProjectReadCandidate(request) == item);
        Throws<InvalidOperationException>(() =>
            store.RecordProjectReadCandidate(request with {
                ProposedSignerSha256 = new string('d',64) }));
        Check(store.ReadProjectReadCandidate(request with {
            ProposedSignerSha256 = new string('d',64) }) is null);
        Throws<InvalidOperationException>(() =>
            store.RecordProjectReadCandidate(request with {
                ProposedGitRootSha256 = new string('d',64) }));
        Throws<ArgumentException>(() =>
            store.RecordProjectReadCandidate(request with {
                ProjectId = "github.com/x/../unsafe" }));
        Throws<ArgumentException>(() =>
            store.RecordProjectReadCandidate(request with {
                PrincipalSid = "S-1-5-32-544" }));
        Throws<ArgumentException>(() =>
            store.RecordProjectReadCandidate(request with {
                RevisionSha = new string('x',40) }));
        Throws<ArgumentException>(() =>
            store.RecordProjectReadCandidate(request with {
                Branch = "feature/../malicious" }));
        Check(store.ReadProjectReadCandidate(request) == item);
    }

    private static void ProjectReadCandidateWithdraw()
    {
        var request = RealReadCandidate();
        string id;
        using (var store = Open())
        {
            store.InitializeProjectReadIntakePreviewSchema();
            id = store.RecordProjectReadCandidate(request).CandidateId;
            store.WithdrawProjectReadCandidate(request,"operator_denied");
            store.WithdrawProjectReadCandidate(request,"operator_denied");
            Throws<InvalidOperationException>(() =>
                store.WithdrawProjectReadCandidate(request,"scope_superseded"));
            Check(store.ReadProjectReadCandidate(request)?.State ==
                ProtectedPendingReviewLedger.ProjectReadWithdrawn);
            Throws<InvalidOperationException>(() =>
                store.RecordProjectReadCandidate(request));
        }
        using (var reopened = Open())
        {
            Check(reopened.ReadProjectReadCandidate(request)?.CandidateId == id);
            Check(reopened.ReadProjectReadCandidate(request)?.State ==
                ProtectedPendingReviewLedger.ProjectReadWithdrawn);
            Throws<InvalidOperationException>(() =>
                reopened.RecordProjectReadCandidate(request));
            Throws<InvalidOperationException>(() =>
                reopened.WithdrawProjectReadCandidate(request with {
                    ProposedSignerSha256=new string('d',64)}, "operator_denied"));
            Check(reopened.ReadDirectReadCiEnrollmentState(
                ProtectedPendingReviewLedger.UserDirectReadCiLane) == "never_enrolled");
        }
    }

    private static void ProjectReadCandidateSqlImmutable()
    {
        var request = RealReadCandidate();
        using (var store = Open())
        {
            store.InitializeProjectReadIntakePreviewSchema();
            store.RecordProjectReadCandidate(request);
            store.WithdrawProjectReadCandidate(request,"suspected_compromise");
        }
        using var sql = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(TestDirectory,"review-authority.sqlite3"),
            Mode = SqliteOpenMode.ReadWrite,Pooling = false,
        }.ToString());
        sql.Open();
        foreach (var commandText in new [] {
            "UPDATE protected_project_read_candidates SET branch='other';",
            "DELETE FROM protected_project_read_candidates;",
            "UPDATE protected_project_read_withdrawals SET reason='operator_denied';",
            "DELETE FROM protected_project_read_withdrawals;"
        })
        {
            using var cmd = sql.CreateCommand();
            cmd.CommandText = commandText;
            Throws<SqliteException>(() => cmd.ExecuteNonQuery());
        }
    }

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

    private static void ProtectedPurposeGate()
    {
        using var store = Open();
        using var key = TestCredential.New();
        store.RecordPending(Example);
        store.StageSyntheticLabSource(Example, SourceFor(Example));
        var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
        var meaning = MeaningFor(Example);

        // Even the same UV credential and exact E~ meaning cannot turn
        // a possession-proof ticket into a durable Claim approval.
        var ordinary = coordinator.Begin(meaning);
        var denied = coordinator.CompleteProtected(ordinary.TicketId,
            meaning, key.Sign(ordinary));
        Check(!denied.Verified && !denied.ClaimWritten
            && denied.Status == "challenge_purpose_mismatch");
        Check(!coordinator.Complete(ordinary.TicketId,
            meaning, key.Sign(ordinary)).Verified);
        Check(store.ReadVerifiedIntent(Example.ProjectId, Example.Branch,
            Example.ProposalRef) is null);
        Check(store.ReadProtectedClaims(Example.ProjectId, Example.Branch).Count == 0);

        // Nor can the regular non-authorizing completion consume a real
        // approval-purpose ticket and later replay it as a Claim.
        var approval = coordinator.BeginProtectedApproval(meaning);
        var wrongPath = coordinator.Complete(approval.TicketId, meaning,
            key.Sign(approval, forcedSignCount: 2));
        Check(!wrongPath.Verified && wrongPath.Status == "challenge_purpose_mismatch");
        Check(!coordinator.CompleteProtected(approval.TicketId,
            meaning, key.Sign(approval, forcedSignCount: 2)).Verified);
        Check(store.ReadProtectedClaims(Example.ProjectId, Example.Branch).Count == 0);

        // A fresh, distinct approval-purpose ticket can still commit the
        // synthetic lab fixture once, never a real operator-pinned E~.
        var fresh = coordinator.BeginProtectedApproval(meaning);
        var saved = coordinator.CompleteProtected(fresh.TicketId,
            meaning, key.Sign(fresh, forcedSignCount: 3));
        Check(saved.Verified && saved.ClaimWritten && !saved.ApprovedClaim);
        Check(store.ReadProtectedClaims(Example.ProjectId, Example.Branch).Count == 1);
        Check(!coordinator.CompleteProtected(fresh.TicketId,
            meaning, key.Sign(fresh, forcedSignCount: 4)).Verified);
    }

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
            var ticket = coordinator.BeginProtectedApproval(meaning);
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
        var ticket = coordinator.BeginProtectedApproval(meaning);
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
        var ticket = coordinator.BeginProtectedApproval(meaning);
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
        var another = coordinator.BeginProtectedApproval(meaning);
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
        var ticket = coordinator.BeginProtectedApproval(meaning);
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
        var firstTicket = firstCoordinator.BeginProtectedApproval(firstMeaning);
        Check(firstCoordinator.CompleteProtected(firstTicket.TicketId,
            firstMeaning, key.Sign(firstTicket)).Verified);

        var secondMeaning = MeaningFor(second);
        var secondTicket = secondCoordinator.BeginProtectedApproval(secondMeaning);
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
        var firstTicket = first.BeginProtectedApproval(meaning);
        var secondTicket = second.BeginProtectedApproval(meaning);
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
            var ticket = coordinator.BeginProtectedApproval(meaning);
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
        var ticket = coordinator.BeginProtectedApproval(meaning);
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

    private static void CreateRealEvidenceFixture(string kind = "knowledge", bool fullyJudgedPending = false)
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
                  fingerprint TEXT NOT NULL, importance_json TEXT, support_json TEXT);
                CREATE TABLE memory_evidence_proposal_relations (
                  proposal_id TEXT PRIMARY KEY, relation TEXT,
                  related_claim_id TEXT, result_json TEXT);
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
                  policy_version,fingerprint,importance_json,support_json)
                VALUES ($id,$p,$b,$kind,$fact,$status,
                  'test-v1',$fingerprint,$importance,$support);
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
            insert.Parameters.AddWithValue("$kind", kind);
            insert.Parameters.AddWithValue("$status",
                fullyJudgedPending ? "pending" : "needs_confirmation");
            insert.Parameters.AddWithValue("$importance",
                fullyJudgedPending ? (object)"""
                  {"decision":"promote","durability":"long","future_utility":"high","confidence":"high","meaning_preserved":true,"risk_flags":[]}
                  """ : DBNull.Value);
            insert.Parameters.AddWithValue("$support",
                fullyJudgedPending ? (object)"""
                  {"decision":"supported","confidence":"high","meaning_preserved":true,"risk_flags":[]}
                  """ : DBNull.Value);
            insert.Parameters.AddWithValue("$fingerprint",
                Hash(kind + "\0" + RealFact.ToLowerInvariant()));
            insert.ExecuteNonQuery();
            if (fullyJudgedPending)
            {
                using var relation = conn.CreateCommand();
                relation.CommandText = """
                    INSERT INTO memory_evidence_proposal_relations
                     (proposal_id,relation,related_claim_id,result_json)
                    VALUES ($id,'unrelated',NULL,$result);
                    """;
                relation.Parameters.AddWithValue("$id", RealProposalId);
                relation.Parameters.AddWithValue("$result", """
                    {"relation":"unrelated","target_ref":null,"confidence":"high","meaning_preserved":true}
                    """);
                relation.ExecuteNonQuery();
            }
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
            var ticket = coordinator.BeginProtectedApproval(meaning);
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

    private static void RealProcedurePendingNoClaim()
    {
        CreateRealEvidenceFixture(kind: "procedure");
        string request;
        using (var store = Open())
        {
            var imported = store.ImportOperatorPinnedEvidence();
            request = imported.PendingRequestId;
            Check(imported.Kind == "procedure"
                && imported.CanonicalFact == RealFact
                && imported.SourceOrigin == ProtectedPendingReviewLedger.OperatorSourceOrigin
                && !imported.HumanApprovalVerified && !imported.ClaimWritten);
            var offer = store.ReadOperatorReviewOffer(
                RealProject, RealBranch, RealERef);
            Check(offer is not null && offer.Kind == "procedure"
                && offer.SourceOrigin == ProtectedPendingReviewLedger.OperatorSourceOrigin
                && offer.Meaning.CanonicalFact == RealFact);
            Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
            Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);

            // A synthetic P-256 signature/UV bit is NEVER human consent.
            using var credential = TestCredential.New();
            var meaning = RealReviewMeaning(imported);
            var coordinator = new VerifiedReviewCoordinator(store, credential.Pinned);
            var ticket = coordinator.BeginProtectedApproval(meaning);
            var denied = coordinator.CompleteProtected(
                ticket.TicketId, meaning, credential.Sign(ticket));
            Check(!denied.Verified && !denied.ClaimWritten
                && denied.Status == "protected_review_scope_or_commit_denied");
            Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
            Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
        }
        using (var reopened = Open())
        {
            Check(reopened.ImportOperatorPinnedEvidence().PendingRequestId == request);
            Check(reopened.ReadOperatorReviewOffer(
                RealProject, RealBranch, RealERef)?.Kind == "procedure");
            Check(reopened.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
        }
    }

    private static void RealJudgedPendingProcedure()
    {
        // This is a PENDING source with completed untrusted model judgments.
        // The service accepts it for human REVIEW only, not as approval.
        CreateRealEvidenceFixture(kind: "procedure", fullyJudgedPending: true);
        string request;
        using (var store = Open())
        {
            var imported = store.ImportOperatorPinnedEvidence();
            request = imported.PendingRequestId;
            Check(imported.Kind == "procedure"
                && imported.CanonicalFact == RealFact
                && imported.SourceOrigin == ProtectedPendingReviewLedger.OperatorSourceOrigin
                && !imported.HumanApprovalVerified && !imported.ClaimWritten);
            Check(store.ReadOperatorReviewOffer(
                RealProject, RealBranch, RealERef)?.Kind == "procedure");
            Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);

            // Even a synthetically user-verified ES256 signature is not a
            // trusted real user's approval or a protected Claim.
            using var key = TestCredential.New();
            var meaning = RealReviewMeaning(imported);
            var coordinator = new VerifiedReviewCoordinator(store, key.Pinned);
            var ticket = coordinator.BeginProtectedApproval(meaning);
            var denied = coordinator.CompleteProtected(
                ticket.TicketId, meaning, key.Sign(ticket));
            Check(!denied.Verified && !denied.ClaimWritten
                && denied.Status == "protected_review_scope_or_commit_denied");
            Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
            Check(store.CountPending() == 1);
        }
        using (var reopened = Open())
        {
            Check(reopened.ImportOperatorPinnedEvidence().PendingRequestId == request);
            Check(reopened.ReadOperatorReviewOffer(
                RealProject, RealBranch, RealERef)?.Kind == "procedure");
            Check(reopened.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
        }
    }

    private static void RealPendingJudgmentDenied()
    {
        CreateRealEvidenceFixture(kind: "procedure");
        MutateRealSnapshot("UPDATE memory_evidence_proposals SET status='pending';");
        using var store = Open();
        Throws<InvalidOperationException>(() => store.ImportOperatorPinnedEvidence());
        Check(store.CountPending() == 0);

        // A syntactically plausible but incomplete model verdict cannot
        // turn the unverified source into a review-ready candidate.
        MutateRealSnapshot("""
            UPDATE memory_evidence_proposals
              SET importance_json='{"decision":"promote","confidence":"high"}',
                  support_json='{"decision":"supported","confidence":"high"}';
            """);
        Throws<InvalidOperationException>(() => store.ImportOperatorPinnedEvidence());
        Check(store.CountPending() == 0);
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

    private static void NativeOperatorEnrolled()
    {
        CreateRealEvidenceFixture(kind: "procedure", fullyJudgedPending: true);
        using var user = TestCredential.New();
        ReviewMeaning meaning;
        using (var store = Open())
        {
            var candidate = store.ImportOperatorPinnedEvidence();
            meaning = RealReviewMeaning(candidate);
            var challenges = new ReviewChallengeCore();
            var ticket = challenges.Begin(meaning, user.Pinned);
            var proof = challenges.VerifyAndConsume(
                ticket.TicketId, meaning, user.Sign(ticket));
            Check(proof.Verified && proof.UserVerified && proof.UserPresent
                && !proof.ApprovedReviewDecision && !proof.ClaimWritten);
            var saved = store.RecordNativeUvEnrollment(meaning, user.Pinned, proof);
            Check(saved.EnrollmentState ==
                ProtectedPendingReviewLedger.NativeEnrollmentState);
            Check(saved.Credential == user.Pinned);
            Check(saved.LastSignCount == 1);
            Check(!saved.HumanApprovalVerified);
            Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
            Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
            Throws<InvalidOperationException>(() =>
                store.RecordNativeUvEnrollment(meaning, user.Pinned, proof));
            var coordinator = VerifiedReviewCoordinator.ForOperatorCredentialProbe(store);
            var subsequent = coordinator.BeginOperatorProof(meaning);
            var verified = coordinator.CompleteOperatorProof(
                subsequent.TicketId, meaning, user.Sign(subsequent, forcedSignCount: 2));
            Check(verified.Verified && !verified.ApprovedClaim && !verified.ClaimWritten);
            Check(store.ReadOperatorCredential()?.LastSignCount == 2);
            Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
        }
        using (var reopened = Open())
        {
            var key = reopened.ReadOperatorCredential();
            Check(key?.EnrollmentState ==
                ProtectedPendingReviewLedger.NativeEnrollmentState);
            Check(key?.LastSignCount == 2);
            Check(key?.Credential == user.Pinned);
            Check(reopened.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
            Check(reopened.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
            WriteOperatorPin(user.Pinned);
            // An unsigned/browser-exported candidate cannot overwrite or
            // retroactively upgrade a native-enrolled protected key.
            Throws<InvalidOperationException>(() =>
                reopened.StageUnverifiedOperatorCredential());
        }
    }

    private static void NativeOperatorCannotUpgrade()
    {
        CreateRealEvidenceFixture(kind: "procedure", fullyJudgedPending: true);
        using var original = TestCredential.New();
        using var different = TestCredential.New();
        WriteOperatorPin(original.Pinned);
        using var store = Open();
        var imported = store.ImportOperatorPinnedEvidence();
        store.StageUnverifiedOperatorCredential();
        var meaning = RealReviewMeaning(imported);
        var core = new ReviewChallengeCore();
        var challenge = core.Begin(meaning, different.Pinned);
        var proof = core.VerifyAndConsume(
            challenge.TicketId, meaning, different.Sign(challenge));
        Throws<InvalidOperationException>(() =>
            store.RecordNativeUvEnrollment(meaning, different.Pinned, proof));
        var unchanged = store.ReadOperatorCredential();
        Check(unchanged?.Credential == original.Pinned
            && unchanged.EnrollmentState ==
                ProtectedPendingReviewLedger.OperatorCredentialState
            && !unchanged.HumanApprovalVerified);
        Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
        Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
    }

    private static void ReaffirmationNoClaim()
    {
        CreateRealEvidenceFixture();
        using var key = TestCredential.New();
        string requestId;
        using (var store = Open())
        {
            var imported = store.ImportOperatorPinnedEvidence();
            var meaning = RealReviewMeaning(imported);
            requestId = imported.PendingRequestId;
            var enrollCore = new ReviewChallengeCore();
            var enroll = enrollCore.Begin(meaning, key.Pinned);
            var proof = enrollCore.VerifyAndConsume(
                enroll.TicketId, meaning, key.Sign(enroll));
            store.RecordNativeUvEnrollment(meaning, key.Pinned, proof);
            var review = OperatorReaffirmationCoordinator.ForNativeCredential(store);
            var ticket = review.Begin(meaning);
            var result = review.Complete(ticket.TicketId,
                meaning, key.Sign(ticket, forcedSignCount: 2));
            Check(result.Verified && result.RequestId == requestId
                && result.Status == "operator_reaffirmation_intent_recorded_no_claim"
                && !result.HistoricalEvidenceVerified && !result.ClaimWritten);
            var receipt = store.ReadOperatorReaffirmationIntent(
                RealProject, RealBranch, RealERef);
            Check(receipt is not null && receipt.RequestId == requestId
                && receipt.OriginalSourceOrigin ==
                    ProtectedPendingReviewLedger.OperatorSourceOrigin
                && receipt.HistoricalEvidenceSha256 == imported.SourceEvidenceSha256
                && receipt.SignCount == 2
                && !receipt.HistoricalEvidenceVerified && !receipt.ClaimWritten);
            Check(store.ReadOperatorCredential()?.LastSignCount == 2);
            Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
            Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
            Check(store.CountPending() == 1);
            Throws<InvalidOperationException>(() => review.Begin(meaning));
            Check(!review.Complete(ticket.TicketId,
                meaning, key.Sign(ticket, forcedSignCount: 3)).Verified);
        }
        using (var reopened = Open())
        {
            var saved = reopened.ReadOperatorReaffirmationIntent(
                RealProject, RealBranch, RealERef);
            Check(saved?.RequestId == requestId
                && saved.SignCount == 2 && !saved.ClaimWritten);
            Check(reopened.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
        }
        using var sql = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(TestDirectory, "review-authority.sqlite3"),
            Mode = SqliteOpenMode.ReadWrite, Pooling = false,
        }.ToString());
        sql.Open();
        using var update = sql.CreateCommand();
        update.CommandText =
            "UPDATE protected_operator_reaffirmation_intents SET kind='preference';";
        Throws<SqliteException>(() => update.ExecuteNonQuery());
        using var delete = sql.CreateCommand();
        delete.CommandText = "DELETE FROM protected_operator_reaffirmation_intents;";
        Throws<SqliteException>(() => delete.ExecuteNonQuery());
    }

    private static void ReaffirmationUnverifiedDenied()
    {
        CreateRealEvidenceFixture();
        using var key = TestCredential.New();
        using var store = Open();
        store.ImportOperatorPinnedEvidence();
        WriteOperatorPin(key.Pinned);
        store.StageUnverifiedOperatorCredential();
        Throws<InvalidOperationException>(() =>
            OperatorReaffirmationCoordinator.ForNativeCredential(store));
        Check(store.ReadOperatorReaffirmationIntent(
            RealProject, RealBranch, RealERef) is null);
        Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
    }

    private static void ReaffirmationProcedureDenied()
    {
        CreateRealEvidenceFixture(kind: "procedure", fullyJudgedPending: true);
        using var key = TestCredential.New();
        using var store = Open();
        var imported = store.ImportOperatorPinnedEvidence();
        var meaning = RealReviewMeaning(imported);
        var enrollCore = new ReviewChallengeCore();
        var enroll = enrollCore.Begin(meaning, key.Pinned);
        var proof = enrollCore.VerifyAndConsume(
            enroll.TicketId, meaning, key.Sign(enroll));
        store.RecordNativeUvEnrollment(meaning, key.Pinned, proof);
        var review = OperatorReaffirmationCoordinator.ForNativeCredential(store);
        Throws<InvalidOperationException>(() => review.Begin(meaning));
        Check(store.ReadOperatorReaffirmationIntent(
            RealProject, RealBranch, RealERef) is null);
        Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
        Check(store.ReadOperatorCredential()?.LastSignCount == 1);
    }

    private static ReviewMeaning PrepareNativeReaffirmation(
        ProtectedPendingReviewLedger store, TestCredential key)
    {
        var imported = store.ImportOperatorPinnedEvidence();
        var meaning = RealReviewMeaning(imported);
        var enrolCore = new ReviewChallengeCore();
        var enrolled = enrolCore.Begin(meaning, key.Pinned);
        store.RecordNativeUvEnrollment(meaning, key.Pinned,
            enrolCore.VerifyAndConsume(
                enrolled.TicketId, meaning, key.Sign(enrolled)));
        var reaffirmer = OperatorReaffirmationCoordinator.ForNativeCredential(store);
        var ticket = reaffirmer.Begin(meaning);
        var result = reaffirmer.Complete(ticket.TicketId,
            meaning, key.Sign(ticket, forcedSignCount: 2));
        Check(result.Verified && !result.ClaimWritten
            && store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
        return meaning;
    }

    private static void DirectClaimNeedsReaffirmation()
    {
        CreateRealEvidenceFixture();
        using var key = TestCredential.New();
        using var store = Open();
        var imported = store.ImportOperatorPinnedEvidence();
        Throws<InvalidOperationException>(() =>
            OperatorDirectClaimCoordinator.ForNativeCredential(store));
        var meaning = RealReviewMeaning(imported);
        var enrolCore = new ReviewChallengeCore();
        var ticket = enrolCore.Begin(meaning, key.Pinned);
        store.RecordNativeUvEnrollment(meaning, key.Pinned,
            enrolCore.VerifyAndConsume(ticket.TicketId, meaning, key.Sign(ticket)));
        var coordinator = OperatorDirectClaimCoordinator.ForNativeCredential(store);
        Throws<InvalidOperationException>(() => coordinator.Begin(meaning));
        Check(store.ReadOperatorDirectClaims(RealProject, RealBranch).Count == 0);
        Check(store.ReadOperatorCredential()?.LastSignCount == 1);
    }

    private static void DirectClaimCommit()
    {
        CreateRealEvidenceFixture();
        using var key = TestCredential.New();
        string claimId;
        using (var store = Open())
        {
            var meaning = PrepareNativeReaffirmation(store, key);
            var publisher = OperatorDirectClaimCoordinator.ForNativeCredential(store);
            var ticket = publisher.Begin(meaning);
            var saved = publisher.Complete(ticket.TicketId,
                meaning, key.Sign(ticket, forcedSignCount: 3));
            Check(saved.ClaimWritten
                && !saved.PublishedToCodex
                && !saved.HistoricalEvidenceVerified
                && saved.Status ==
                    "protected_user_direct_claim_committed_not_published_to_codex"
                && saved.Provenance ==
                    ProtectedPendingReviewLedger.OperatorDirectClaimOrigin);
            claimId = saved.ClaimId ?? throw new Exception("no_direct_claim_id");
            var claims = store.ReadOperatorDirectClaims(RealProject, RealBranch);
            Check(claims.Count == 1 && claims[0].ClaimId == claimId
                && claims[0].Value == RealFact
                && claims[0].Provenance ==
                    ProtectedPendingReviewLedger.OperatorDirectClaimOrigin
                && claims[0].HistoricalSourceOrigin ==
                    ProtectedPendingReviewLedger.OperatorSourceOrigin
                && !claims[0].HistoricalEvidenceVerified);
            Check(store.ReadOperatorDirectClaims(RealProject, "unrelated").Count == 0);
            Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
            Check(store.ReadVerifiedIntent(RealProject, RealBranch, RealERef) is null);
            Check(store.CountPending() == 1);
            Check(store.ReadOperatorCredential()?.LastSignCount == 3);
            Check(!publisher.Complete(ticket.TicketId,
                meaning, key.Sign(ticket, forcedSignCount: 4)).ClaimWritten);
            Throws<InvalidOperationException>(() => publisher.Begin(meaning));
        }
        using (var reopened = Open())
        {
            Check(reopened.ReadOperatorDirectClaims(RealProject, RealBranch)
                .Single().ClaimId == claimId);
            Check(reopened.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
            Check(reopened.ReadOperatorReaffirmationIntent(
                RealProject, RealBranch, RealERef)?.ClaimWritten == false);
            Check(reopened.ReadOperatorCredential()?.LastSignCount == 3);
        }
        using var sql = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(TestDirectory, "review-authority.sqlite3"),
            Mode = SqliteOpenMode.ReadWrite, Pooling = false,
        }.ToString());
        sql.Open();
        using var update = sql.CreateCommand();
        update.CommandText =
            "UPDATE protected_operator_direct_claims SET source_origin='forged';";
        Throws<SqliteException>(() => update.ExecuteNonQuery());
        using var remove = sql.CreateCommand();
        remove.CommandText = "DELETE FROM protected_operator_direct_claims;";
        Throws<SqliteException>(() => remove.ExecuteNonQuery());
    }

    private static void DirectClaimBadPurpose()
    {
        CreateRealEvidenceFixture();
        using var key = TestCredential.New();
        using var store = Open();
        var meaning = PrepareNativeReaffirmation(store, key);
        var core = new ReviewChallengeCore();
        var publisher = OperatorDirectClaimCoordinator.ForNativeCredential(store, core);
        var wrong = core.BeginProtectedApproval(meaning, key.Pinned);
        var denied = publisher.Complete(wrong.TicketId,
            meaning, key.Sign(wrong, forcedSignCount: 3));
        Check(!denied.ClaimWritten && denied.Status == "challenge_purpose_mismatch");
        Check(!core.VerifyProtectedApprovalAndConsume(wrong.TicketId,
            meaning, key.Sign(wrong, forcedSignCount: 3)).Verified);
        var replay = publisher.Begin(meaning);
        // Counter 2 was already consumed by the previous reaffirmation,
        // despite this having a separate NEW commit-purpose challenge.
        var stale = publisher.Complete(replay.TicketId,
            meaning, key.Sign(replay, forcedSignCount: 2));
        Check(!stale.ClaimWritten && stale.Status == "direct_claim_transaction_denied");
        Check(store.ReadOperatorCredential()?.LastSignCount == 2);
        Check(store.ReadOperatorDirectClaims(RealProject, RealBranch).Count == 0);
        var fresh = publisher.Begin(meaning);
        var good = publisher.Complete(fresh.TicketId,
            meaning, key.Sign(fresh, forcedSignCount: 3));
        Check(good.ClaimWritten);
        Check(store.ReadOperatorCredential()?.LastSignCount == 3);
    }

    private static void DirectClaimNoDuplicate()
    {
        CreateRealEvidenceFixture();
        using var key = TestCredential.New();
        using var store = Open();
        var meaning = PrepareNativeReaffirmation(store, key);
        var publisher = OperatorDirectClaimCoordinator.ForNativeCredential(store);
        var first = publisher.Begin(meaning);
        Check(publisher.Complete(first.TicketId, meaning,
            key.Sign(first, forcedSignCount: 3)).ClaimWritten);
        var counter = store.ReadOperatorCredential()?.LastSignCount;
        // The host-only coordinator must refuse a second consent ceremony,
        // without exposing the internal SQLite transaction as a public API.
        Throws<InvalidOperationException>(() => publisher.Begin(meaning));
        var secondCoordinator = OperatorDirectClaimCoordinator.ForNativeCredential(store);
        Throws<InvalidOperationException>(() => secondCoordinator.Begin(meaning));
        Check(store.ReadOperatorDirectClaims(RealProject, RealBranch).Count == 1);
        Check(store.ReadOperatorCredential()?.LastSignCount == counter);
        Check(store.ReadProtectedClaims(RealProject, RealBranch).Count == 0);
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
