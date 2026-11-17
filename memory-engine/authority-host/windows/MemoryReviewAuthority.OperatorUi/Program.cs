using System.Diagnostics;
using System.Drawing;
using System.Security.Principal;
using System.Windows.Forms;

namespace MemoryReviewAuthority.OperatorUi;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindowsVersionAtLeast(10)
                || !Environment.Is64BitProcess)
                return 2;
            if (args.Length == 1 && args[0] == "--contract-selftest")
                return OperatorSelfTest.Run();
            if (args.Length == 1 && args[0] == "--ci-hold-uninstall-preflight"
                && Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true"
                && Environment.GetEnvironmentVariable("RUNNER_OS") == "Windows")
            {
                // Read-only headless CI hold: no Hello, credentials or Claims.
                ProtectedOperatorService.RequireProtectedInteractiveExecutable();
                Thread.Sleep(TimeSpan.FromSeconds(30));
                return 0;
            }

            if ((args.Length != 0
                    && !(args.Length == 1
                        && args[0] is "--service-smoke" or "--read-preview-smoke"
                            or "--ci-one-shot-offer-smoke"
                            or "--installed-path-selftest"
                            or "--installed-native-enrollment-selftest"))
                || !new WindowsPrincipal(WindowsIdentity.GetCurrent())
                    .IsInRole(WindowsBuiltInRole.Administrator))
            {
                if (args.Length == 1 && args[0] == "--service-smoke"
                    && Environment.GetEnvironmentVariable("GITHUB_ACTIONS") == "true")
                {
                    var temp = Environment.GetEnvironmentVariable("RUNNER_TEMP");
                    if (!string.IsNullOrWhiteSpace(temp))
                        File.WriteAllText(Path.Combine(temp,
                            "AgentHubNativeOperatorSmokeFailure.txt"),
                            "SecurityException: native process not elevated");
                    return 2;
                }
                MessageBox.Show(
                    "Diese lokale Prüfoberfläche muss bewusst als Administrator"
                    + " gestartet werden. Sie ist kein produktiver Memory-Writer.",
                    "AgentHub Memory", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 2;
            }

            if (args.Length == 1 && args[0] == "--service-smoke")
                return OperatorSelfTest.RunServiceOffer();
            if (args.Length == 1 && args[0] == "--read-preview-smoke")
                return OperatorSelfTest.RunReadDisclosureOffer();
            if (args.Length == 1 && args[0] == "--ci-one-shot-offer-smoke")
                return OperatorSelfTest.RunCiOneShotOffer();
            if (args.Length == 1 && args[0] == "--installed-path-selftest")
            {
                // This mode cannot create a credential or approve a Claim,
                // but proves the same exact hardened binary-path assertion
                // that every INTERACTIVE Hello operation must pass.
                ProtectedOperatorService.RequireProtectedInteractiveExecutable();
                return OperatorSelfTest.RunServiceOffer();
            }

            if (args.Length == 1 && args[0] == "--installed-native-enrollment-selftest")
            {
                // Same protected installed-path check as the interactive UI,
                // then read only a service-signed enrollment challenge in CI.
                // No physical MakeCredential, no credential store or Claim.
                ProtectedOperatorService.RequireProtectedInteractiveExecutable();
                return OperatorSelfTest.RunNativeEnrollmentOffer();
            }

            // No real human-originating Hello gesture from an executable
            // in Git, Downloads or any other unsealed same-account path.
            ProtectedOperatorService.RequireProtectedInteractiveExecutable();
            ApplicationConfiguration.Initialize();
            Application.Run(new OperatorReviewWindow());
            return 0;
        }
        catch (Exception error)
        {
            Debug.WriteLine("Operator UI failed closed: " + error.GetType().Name);
            return 2;
        }
    }
}

/// <summary>
/// Explicit, locally elevated, human-controlled native window. The signed
/// original fact is not HTML or model supplied. Only a physical click can
/// invoke Windows native WebAuthn. No UI action sends a Claim approval.
/// </summary>
internal sealed class OperatorReviewWindow : Form
{
    private readonly TextBox _project = new()
    {
        Text = "", Width = 420, PlaceholderText = "github.com/owner/repo",
    };
    private readonly TextBox _branch = new()
    {
        Text = "main", Width = 135,
    };
    private readonly TextBox _reference = new()
    {
        Width = 135, PlaceholderText = "E~0123456789",
    };
    private readonly TextBox _fact = new()
    {
        ReadOnly = true, Multiline = true, ScrollBars = ScrollBars.Vertical,
        Dock = DockStyle.Fill, BorderStyle = BorderStyle.FixedSingle,
        BackColor = Color.FromArgb(25, 29, 35),
        ForeColor = Color.FromArgb(235, 239, 243),
        Font = new Font("Segoe UI", 13, FontStyle.Regular),
        TabStop = false,
    };
    private readonly Label _meaning = new()
    {
        AutoSize = false, Dock = DockStyle.Fill,
        ForeColor = Color.FromArgb(217, 225, 233),
        Font = new Font("Consolas", 9),
    };
    private readonly Label _status = new()
    {
        Dock = DockStyle.Fill, ForeColor = Color.FromArgb(176, 196, 206),
        Font = new Font("Segoe UI", 10),
        Text = "Kein signierter Vorschlag geladen. Keine Genehmigung.",
    };
    private readonly CheckBox _acknowledge = new()
    {
        Text = "Ich habe diesen exakten Fakt und die angezeigte Entscheidung gelesen."
            + " Nur Windows-Hello-Nachweis prüfen, KEINEN Claim genehmigen.",
        AutoSize = true, Enabled = false,
    };
    private readonly Button _load = new()
    {
        Text = "Signierten Vorschlag laden",
        AutoSize = true, Height = 38,
    };
    private readonly Button _enrollPrepare = new()
    {
        Text = "Neue Windows-Hello-Einschreibung vorbereiten",
        AutoSize = true, Height = 38,
    };
    private readonly Button _verify = new()
    {
        Text = "Mit Windows Hello prüfen (keine Freigabe)",
        AutoSize = true, Height = 38, Enabled = false,
    };
    private readonly Button _reaffirmPrepare = new()
    {
        Text = "Eigene Aussage vorbereiten", AutoSize = true, Height = 38,
    };
    private readonly CheckBox _reaffirmAcknowledge = new()
    {
        Text = "Ich bestätige den angezeigten Fakt JETZT als eigene Aussage. "
            + "Historische Evidence bleibt UNVERIFIZIERT. KEIN Claim.",
        Dock = DockStyle.Fill, Enabled = false,
    };
    private readonly Button _reaffirmConfirm = new()
    {
        Text = "Diese neue Aussage mit Windows Hello bestätigen (kein Claim)",
        AutoSize = true, Height = 38, Enabled = false,
    };
    private readonly Button _publishPrepare = new()
    {
        Text = "Memory-Claim (No-Write-Preview: gesperrt)",
        AutoSize = true, Height = 38, Enabled = false,
    };
    private readonly CheckBox _publishAcknowledge = new()
    {
        Text = "Ich will diesen exakt angezeigten NEU bestätigten Fakt jetzt "
            + "im geschützten Claim-Speicher aufnehmen. Historische Evidence "
            + "bleibt unverifiziert. NICHT in Codex abrufbar.",
        Dock = DockStyle.Fill, Enabled = false,
    };
    private readonly Button _publishCommit = new()
    {
        Text = "Jetzt mit Windows Hello als geschützten Claim speichern",
        AutoSize = true, Height = 38, Enabled = false,
    };
    private readonly Button _readPrepare = new()
    {
        Text = "Geschützten Claim zur Read-Prüfung laden",
        AutoSize = true, Height = 38,
    };
    private readonly CheckBox _readAcknowledge = new()
    {
        Text = "Ich habe den konkreten Claim, das Projekt und den Empfänger gelesen. "
            + "Nur separate Windows-Hello-Absicht, KEIN Codex-Recall.",
        Dock = DockStyle.Fill, Enabled = false,
    };
    private readonly Button _readConfirm = new()
    {
        Text = "Read-Zustimmung mit Windows Hello prüfen (KEINE Freigabe)",
        AutoSize = true, Height = 38, Enabled = false,
    };
    private readonly Button _ciReadPrepare = new()
    {
        Text = "CI: Wartenden Test-Empfänger prüfen",
        AutoSize = true, Height = 38,
    };
    private readonly CheckBox _ciReadAcknowledge = new()
    {
        Text = "CI-NUR: Ich habe den echten Claim und die Kernel-PID des "
            + "wartenden Testempfängers gelesen. Diese PID attestiert KEINE "
            + "sichere Codex-Sitzung. Einmalige Test-Übertragung erlauben.",
        Dock = DockStyle.Fill, Enabled = false,
    };
    private readonly Button _ciReadConfirm = new()
    {
        Text = "CI: Einmalige Test-Übertragung mit Windows Hello erlauben",
        AutoSize = true, Height = 38, Enabled = false,
    };
    private CiOneShotOffer? _ciReadOffer;
    private OperatorObservedRecipient? _ciObserved;
    private static bool CiOnly => Environment.GetEnvironmentVariable(
        "GITHUB_ACTIONS") == "true"
        && Environment.GetEnvironmentVariable("RUNNER_OS") == "Windows";
    private ReadDisclosureOffer? _readOffer;
    private ServiceOffer? _publication;
    private ServiceOffer? _offer;
    private ServiceOffer? _reaffirmation;
    private RegistrationOffer? _enrollment;
    private bool _busy;

    internal OperatorReviewWindow()
    {
        Text = "AgentHub Memory | Geschützter E~ Review | NO-GO";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(860, 920);
        Size = new Size(1100, 1010);
        BackColor = Color.FromArgb(16, 19, 24);
        ForeColor = Color.FromArgb(243, 245, 246);
        Font = new Font("Segoe UI", 10);

        var outer = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(28),
            AutoScroll = true,
            ColumnCount = 1, RowCount = 16,
        };
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 80));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 80));
        outer.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 125));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 65));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 65));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
        var header = new Label
        {
            Dock = DockStyle.Fill,
            Text = "AGENTHUB  /  MEMORY REVIEW\n"
                + "TEMPORÄRES NATIVE-HELLO-LAB    ·    KEIN CODEX-RECALL",
            Font = new Font("Segoe UI Semibold", 14),
            ForeColor = Color.White,
        };
        outer.Controls.Add(header, 0, 0);

        var scope = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, WrapContents = false,
            FlowDirection = FlowDirection.LeftToRight, AutoScroll = true,
        };
        scope.Controls.Add(Captioned("PROJEKT", _project));
        scope.Controls.Add(Captioned("BRANCH", _branch));
        scope.Controls.Add(Captioned("E~ REFERENZ", _reference));
        outer.Controls.Add(scope, 0, 1);
        var loadActions = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, WrapContents = true, AutoScroll = true,
            FlowDirection = FlowDirection.LeftToRight,
        };
        loadActions.Controls.Add(_load);
        loadActions.Controls.Add(_enrollPrepare);
        loadActions.Controls.Add(_reaffirmPrepare);
        loadActions.Controls.Add(_publishPrepare);
        loadActions.Controls.Add(_readPrepare);
        _ciReadPrepare.Visible = CiOnly;
        loadActions.Controls.Add(_ciReadPrepare);
        outer.Controls.Add(loadActions, 0, 2);
        outer.Controls.Add(_fact, 0, 3);
        outer.Controls.Add(_meaning, 0, 4);
        outer.Controls.Add(_acknowledge, 0, 5);
        outer.Controls.Add(_verify, 0, 6);
        outer.Controls.Add(_reaffirmAcknowledge, 0, 7);
        outer.Controls.Add(_reaffirmConfirm, 0, 8);
        outer.Controls.Add(_publishAcknowledge, 0, 9);
        outer.Controls.Add(_publishCommit, 0, 10);
        outer.Controls.Add(_readAcknowledge, 0, 11);
        outer.Controls.Add(_readConfirm, 0, 12);
        _ciReadAcknowledge.Visible = CiOnly;
        _ciReadConfirm.Visible = CiOnly;
        outer.Controls.Add(_ciReadAcknowledge, 0, 13);
        outer.Controls.Add(_ciReadConfirm, 0, 14);
        outer.Controls.Add(_status, 0, 15);
        Controls.Add(outer);

        _load.Click += async (_, _) => await LoadOfferAsync();
        _enrollPrepare.Click += async (_, _) => await LoadEnrollmentAsync();
        _reaffirmPrepare.Click += async (_, _) => await LoadReaffirmationAsync();
        _reaffirmConfirm.Click += (_, _) => PerformReaffirmation();
        _reaffirmAcknowledge.CheckedChanged += (_, _) => UpdateVerifyEnabled();
        _publishPrepare.Click += async (_, _) => await LoadPublishAsync();
        _readPrepare.Click += async (_, _) => await LoadReadDisclosureAsync();
        _readConfirm.Click += (_, _) => PerformReadDisclosure();
        _readAcknowledge.CheckedChanged += (_, _) => UpdateVerifyEnabled();
        _ciReadPrepare.Click += async (_, _) => await LoadCiOneShotAsync();
        _ciReadAcknowledge.CheckedChanged += (_, _) => UpdateVerifyEnabled();
        _ciReadConfirm.Click += (_, _) => PerformCiOneShot();
        _publishCommit.Click += (_, _) => PerformPublish();
        _publishAcknowledge.CheckedChanged += (_, _) => UpdateVerifyEnabled();
        _verify.Click += (_, _) =>
        {
            if (_enrollment is not null) PerformNativeEnrollment();
            else PerformWindowsHelloProof();
        };
        _acknowledge.CheckedChanged += (_, _) => UpdateVerifyEnabled();
        _project.TextChanged += (_, _) => InvalidateOffer();
        _branch.TextChanged += (_, _) => InvalidateOffer();
        _reference.TextChanged += (_, _) => InvalidateOffer();
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _ciObserved?.Dispose();
        _ciObserved = null;
        base.OnFormClosed(e);
    }

    private static Control Captioned(string name, TextBox input)
    {
        var panel = new FlowLayoutPanel
        {
            Width = input.Width + 12, Height = 68,
            FlowDirection = FlowDirection.TopDown, WrapContents = false,
        };
        panel.Controls.Add(new Label
        {
            Text = name, Width = input.Width,
            Height = 22, ForeColor = Color.Silver,
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
        });
        input.ForeColor = Color.Black;
        input.BackColor = Color.White;
        panel.Controls.Add(input);
        return panel;
    }

    private void InvalidateOffer()
    {
        _offer = null;
        _enrollment = null;
        _reaffirmation = null;
        _publication = null;
        _readOffer = null;
        _ciReadOffer = null;
        _ciObserved?.Dispose();
        _ciObserved = null;
        _ciReadAcknowledge.Checked = false;
        _ciReadAcknowledge.Enabled = false;
        _readAcknowledge.Checked = false;
        _readAcknowledge.Enabled = false;
        _publishAcknowledge.Checked = false;
        _publishAcknowledge.Enabled = false;
        _reaffirmAcknowledge.Checked = false;
        _reaffirmAcknowledge.Enabled = false;
        _verify.Text = "Mit Windows Hello prüfen (keine Freigabe)";
        _fact.Clear();
        _meaning.Text = "";
        _acknowledge.Checked = false;
        _acknowledge.Enabled = false;
        UpdateVerifyEnabled();
        _status.Text = "Kontext geändert. Vor einer Prüfung neuen Dienst-Vorschlag laden.";
    }

    private void UpdateVerifyEnabled()
    {
        _verify.Enabled = !_busy && _acknowledge.Checked
            && ((_offer is { } o && o.ExpiresUtc > DateTimeOffset.UtcNow)
                || (_enrollment is { } e
                    && e.ExpiresUtc > DateTimeOffset.UtcNow));
        _reaffirmConfirm.Enabled = !_busy && _reaffirmAcknowledge.Checked
            && _reaffirmation is { } r && r.ExpiresUtc > DateTimeOffset.UtcNow;
        _publishCommit.Enabled = !_busy && _publishAcknowledge.Checked
            && _publication is { } p && p.ExpiresUtc > DateTimeOffset.UtcNow;
        _readConfirm.Enabled = !_busy && _readAcknowledge.Checked
            && _readOffer is { } read && read.ExpiresUtc > DateTimeOffset.UtcNow;
        _ciReadConfirm.Enabled = CiOnly && !_busy && _ciReadAcknowledge.Checked
            && _ciReadOffer is { } ci && ci.ExpiresUtc > DateTimeOffset.UtcNow
            && _ciObserved is { } observed && observed.Matches()
            && observed.KernelPid == ci.KernelRecipientPid;
    }

    private async Task LoadOfferAsync()
    {
        if (_busy) return;
        InvalidateOffer();
        _busy = true;
        _load.Enabled = false;
        _enrollPrepare.Enabled = false;
        _status.Text = "Frage den geschützten Windows-Dienst ab …";
        try
        {
            var project = _project.Text.Trim();
            var branch = _branch.Text.Trim();
            var proposalRef = _reference.Text.Trim();
            var offer = await Task.Run(() =>
                ProtectedOperatorService.Begin(project, branch, proposalRef));
            // The user can change selection while the named-pipe call is
            // pending. Never show or sign a stale service offer under a
            // different selection typed after the request began.
            if (_project.Text.Trim() != project
                || _branch.Text.Trim() != branch
                || _reference.Text.Trim() != proposalRef)
                throw new InvalidOperationException("Auswahl während des Ladens geändert");
            if (offer.ExpiresUtc <= DateTimeOffset.UtcNow)
                throw new InvalidOperationException("Service-Challenge bereits abgelaufen");
            _offer = offer;
            _fact.Text = offer.CanonicalFact;
            _meaning.Text = $"AKTION: {offer.Decision}    |    TYP: {offer.Kind}\n"
                + $"QUELLE: {offer.SourceOrigin}\n"
                + $"PROJEKT: {offer.ProjectId}    |    BRANCH: {offer.Branch}\n"
                + $"COMMIT: {offer.RevisionSha}\n"
                + $"E~: {offer.ProposalRef}    |    SNAPSHOT: {offer.ReviewSnapshotSha256}\n"
                + $"FAKT-SHA256: {offer.CanonicalFactSha256}\n"
                + $"EVIDENCE-SHA256: {offer.SourceEvidenceSha256}";
            _acknowledge.Enabled = true;
            _status.Text = "Dienstsignatur und exakter Fakt geprüft. "
                + "Challenge gültig bis "
                + offer.ExpiresUtc.ToLocalTime().ToString("HH:mm:ss")
                + ". Das ist keine Freigabe.";
        }
        catch (Exception error)
        {
            _status.Text = "Fehlgeschlagen: " + error.Message
                + ". Keine Signatur akzeptiert, kein Claim.";
        }
        finally
        {
            _busy = false;
            _load.Enabled = true;
            _enrollPrepare.Enabled = true;
            UpdateVerifyEnabled();
        }
    }

    /// <summary>First physical step: show a signed E~ fact and separate action.</summary>
    private async Task LoadEnrollmentAsync()
    {
        if (_busy) return;
        InvalidateOffer();
        _busy = true;
        _load.Enabled = false;
        _enrollPrepare.Enabled = false;
        _status.Text = "Frage den Dienst nach einer neuen Einschreib-Challenge …";
        try
        {
            var project = _project.Text.Trim();
            var branch = _branch.Text.Trim();
            var proposalRef = _reference.Text.Trim();
            var offer = await Task.Run(() =>
                ProtectedOperatorService.BeginNativeEnrollment(
                    project, branch, proposalRef));
            if (_project.Text.Trim() != project
                || _branch.Text.Trim() != branch
                || _reference.Text.Trim() != proposalRef
                || offer.ExpiresUtc <= DateTimeOffset.UtcNow)
                throw new InvalidOperationException(
                    "Auswahl geändert oder Dienst-Challenge abgelaufen");
            _enrollment = offer;
            _fact.Text = offer.CanonicalFact;
            _meaning.Text =
                $"AKTION: {offer.Decision}    |    TYP: {offer.Kind}\n"
                + $"QUELLE: {offer.SourceOrigin}\n"
                + $"PROJEKT: {offer.ProjectId}    |    BRANCH: {offer.Branch}\n"
                + $"COMMIT: {offer.RevisionSha}\n"
                + $"E~: {offer.ProposalRef}    |    SNAPSHOT: {offer.SnapshotSha256}\n"
                + $"FAKT-SHA256: {offer.FactSha256}\n"
                + $"EVIDENCE-SHA256: {offer.EvidenceSha256}";
            _verify.Text = "Windows Hello einschreiben und Besitz prüfen (kein Claim)";
            _acknowledge.Enabled = true;
            _status.Text = "Signierter Originalfakt geladen. Einschreibung ist "
                + "KEINE Genehmigung. Challenge bis "
                + offer.ExpiresUtc.ToLocalTime().ToString("HH:mm:ss");
        }
        catch (Exception error)
        {
            _status.Text = "Einschreibung nicht vorbereitet: " + error.Message
                + ". Kein Credential oder Claim geschrieben.";
        }
        finally
        {
            _busy = false;
            _load.Enabled = true;
            _enrollPrepare.Enabled = true;
            UpdateVerifyEnabled();
        }
    }

    /// <summary>
    /// Separate, deliberate gesture. This records only an operator INTENT,
    /// never an approved Claim or verified historical source.
    /// </summary>
    private async Task LoadReaffirmationAsync()
    {
        if (_busy) return;
        InvalidateOffer();
        _busy = true;
        _load.Enabled = false;
        _enrollPrepare.Enabled = false;
        _reaffirmPrepare.Enabled = false;
        _status.Text = "Lade die separate, dienstsignierte Bestätigungs-Challenge …";
        try
        {
            var project = _project.Text.Trim();
            var branch = _branch.Text.Trim();
            var proposal = _reference.Text.Trim();
            var offer = await Task.Run(() =>
                ProtectedOperatorService.BeginReaffirmation(project, branch, proposal));
            if (_project.Text.Trim() != project
                || _branch.Text.Trim() != branch
                || _reference.Text.Trim() != proposal
                || offer.ExpiresUtc <= DateTimeOffset.UtcNow
                || offer.Kind is not ("knowledge" or "preference")
                || offer.Decision != "confirm")
                throw new InvalidOperationException(
                    "Bestätigungs-Kontext geändert oder nicht unterstützt");
            _reaffirmation = offer;
            _fact.Text = offer.CanonicalFact;
            _meaning.Text = $"NEUE PERSÖNLICHE AUSSAGE: confirm    |    TYP: {offer.Kind}\n"
                + $"ORIGINALQUELLE: {offer.SourceOrigin} (NICHT VERIFIZIERT)\n"
                + $"PROJEKT: {offer.ProjectId}    |    BRANCH: {offer.Branch}\n"
                + $"COMMIT: {offer.RevisionSha}\n"
                + $"E~: {offer.ProposalRef}    |    SNAPSHOT: {offer.ReviewSnapshotSha256}\n"
                + $"FAKT-SHA256: {offer.CanonicalFactSha256}\n"
                + $"HISTORISCHE EVIDENCE-SHA256: {offer.SourceEvidenceSha256}";
            _reaffirmAcknowledge.Enabled = true;
            _status.Text = "Bitte den gesamten Fakt lesen. Diese Aktion bestätigt "
                + "NUR Ihre neue Aussage, NICHT den historischen Beleg. "
                + "KEIN Claim oder Codex-Memory-Write.";
        }
        catch (Exception error)
        {
            _status.Text = "Keine persönliche Bestätigung vorbereitet: "
                + error.Message + ". Kein Intent und kein Claim.";
        }
        finally
        {
            _busy = false;
            _load.Enabled = true;
            _enrollPrepare.Enabled = true;
            _reaffirmPrepare.Enabled = true;
            UpdateVerifyEnabled();
        }
    }

    private void PerformReaffirmation()
    {
        if (_busy || !_reaffirmAcknowledge.Checked
            || _reaffirmation is not { } offer) return;
        if (offer.ExpiresUtc <= DateTimeOffset.UtcNow
            || _ciObserved is not { } observed
            || observed.KernelPid!=offer.KernelRecipientPid
            || !observed.Matches())
        {
            InvalidateOffer();
            _status.Text = "Bestätigungs-Challenge abgelaufen. Erneut vorbereiten.";
            return;
        }
        _busy = true;
        _load.Enabled = false;
        _enrollPrepare.Enabled = false;
        _reaffirmPrepare.Enabled = false;
        _verify.Enabled = false;
        _reaffirmConfirm.Enabled = false;
        _project.Enabled = false;
        _branch.Enabled = false;
        _reference.Enabled = false;
        _status.Text = "Windows Hello bestätigt nur diese NEUE Aussage. "
            + "Die historische Evidence bleibt unverifiziert. Kein Claim.";
        try
        {
            var assertion = NativeWindowsWebAuthn.GetAssertion(Handle, offer);
            var receipt = ProtectedOperatorService.CompleteReaffirmation(
                offer.TicketId, assertion);
            if (!receipt.Verified
                || receipt.Status != "operator_reaffirmation_intent_recorded_no_claim")
                throw new InvalidOperationException(
                    "Der geschützte Dienst hat die Bestätigung nicht gespeichert: "
                    + receipt.Status);
            _status.Text = "Persönliche Bestätigungsabsicht geschützt gespeichert. "
                + "Historische Evidence NICHT verifiziert. "
                + "KEIN Claim erstellt und KEINE Erinnerung freigegeben.";
        }
        catch (Exception error)
        {
            _status.Text = "Bestätigung verweigert oder abgebrochen: "
                + error.Message + ". Kein Claim erstellt.";
        }
        finally
        {
            _reaffirmation = null;
            _reaffirmAcknowledge.Enabled = false;
            _reaffirmAcknowledge.Checked = false;
            _load.Enabled = true;
            _enrollPrepare.Enabled = true;
            _reaffirmPrepare.Enabled = true;
            _project.Enabled = true;
            _branch.Enabled = true;
            _reference.Enabled = true;
            _busy = false;
            UpdateVerifyEnabled();
        }
    }

    private async Task LoadPublishAsync()
    {
        if (_busy) return;
        InvalidateOffer();
        _busy = true;
        _load.Enabled = false;
        _enrollPrepare.Enabled = false;
        _reaffirmPrepare.Enabled = false;
        _publishPrepare.Enabled = false;
        _status.Text = "Lade gesonderten Dienstbeleg zum geschützten Claim-Commit …";
        try
        {
            var project = _project.Text.Trim();
            var branch = _branch.Text.Trim();
            var proposal = _reference.Text.Trim();
            var offer = await Task.Run(() =>
                ProtectedOperatorService.BeginPublish(project, branch, proposal));
            if (_project.Text.Trim() != project
                || _branch.Text.Trim() != branch
                || _reference.Text.Trim() != proposal
                || offer.ExpiresUtc <= DateTimeOffset.UtcNow
                || offer.Decision != "confirm"
                || offer.Kind is not ("knowledge" or "preference"))
                throw new InvalidOperationException(
                    "Publikations-Kontext geändert oder nicht zulässig");
            _publication = offer;
            _fact.Text = offer.CanonicalFact;
            _meaning.Text = $"CLAIM-PUBLIKATION: EIGENE NEUE AUSSAGE    |    TYP: {offer.Kind}\n"
                + $"HISTORISCHER URSPRUNG: {offer.SourceOrigin} (UNVERIFIZIERT)\n"
                + $"PROJEKT: {offer.ProjectId}    |    BRANCH: {offer.Branch}\n"
                + $"COMMIT: {offer.RevisionSha}\n"
                + $"E~: {offer.ProposalRef}    |    SNAPSHOT: {offer.ReviewSnapshotSha256}\n"
                + $"FAKT-SHA256: {offer.CanonicalFactSha256}\n"
                + $"HISTORISCHE EVIDENCE-SHA256: {offer.SourceEvidenceSha256}";
            _publishAcknowledge.Enabled = true;
            _status.Text = "Nur nach vorheriger persönlicher Bestätigung zulässig. "
                + "Diese ZWEITE, unabhängige Aktion schreibt einen geschützten Claim. "
                + "Er ist NICHT für Codex freigegeben.";
        }
        catch (Exception error)
        {
            _status.Text = "Claim-Publikation nicht vorbereitet: "
                + error.Message + ". Kein Claim geschrieben.";
        }
        finally
        {
            _busy = false;
            _load.Enabled = true;
            _enrollPrepare.Enabled = true;
            _reaffirmPrepare.Enabled = true;
            _publishPrepare.Enabled = true;
            UpdateVerifyEnabled();
        }
    }



    private async Task LoadCiOneShotAsync()
    {
        if (!CiOnly || _busy) return;
        InvalidateOffer();
        _busy = true;
        _ciReadPrepare.Enabled = false;
        _status.Text = "CI: Wartenden Kernel-gebundenen Empfänger und "
            + "geschützten Claim prüfen ...";
        try
        {
            var project = _project.Text.Trim();
            var branch = _branch.Text.Trim();
            var proposal = _reference.Text.Trim();
            var offer = await Task.Run(() =>
                ProtectedOperatorService.BeginCiOneShotRead(
                    project,branch,proposal));
            if (project != _project.Text.Trim()
                || branch != _branch.Text.Trim()
                || proposal != _reference.Text.Trim()
                || offer.ExpiresUtc <= DateTimeOffset.UtcNow)
                throw new InvalidOperationException(
                    "CI: Claim oder Sitzungs-Kontext nach Laden verändert");
            // The protected elevated GUI measures the actual OS process
            // independently. The service-signed PID is kernel-derived but
            // only a *recipient hint*, not a Codex identity credential.
            _ciObserved = await Task.Run(() =>
                OperatorObservedRecipient.Observe(offer.KernelRecipientPid));
            if (!_ciObserved.Matches()
                || _ciObserved.KernelPid!=offer.KernelRecipientPid)
                throw new InvalidOperationException(
                    "CI-Empfängerprozess seit Angebot verändert");
            _ciReadOffer = offer;
            _fact.Text = offer.Value;
            _meaning.Text =
                $"CI-TEST-EINMAL-ÜBERTRAGUNG (NICHT PRODUKTIV)\n"
                + $"PROJEKT: {offer.ProjectId} | BRANCH: {offer.Branch}\n"
                + $"COMMIT: {offer.RevisionSha}\n"
                + $"CLAIM: {offer.ClaimId} | E~: {offer.ProposalRef}\n"
                + $"QUERY: {offer.Query}\n"
                + $"EMPFÄNGER: {offer.Recipient}\n"
                + $"KERNEL-PID: {offer.KernelRecipientPid}\n"
                + $"GEMESSENES PROZESSABBILD (NATIVE UI, KEINE ATTESTIERUNG): {_ciObserved.ImagePath}\n"
                + $"PROZESS-ERSTELLZEIT (NATIVE FILETIME): {_ciObserved.CreatedFileTime}\n"
                + $"ORIGINAL-CODEX-IDENTITÄT BEWIESEN: NEIN\n"
                + $"KONTO-SID: {offer.PrincipalSid}\n"
                + $"SITZUNGS-FINGERABDRUCK: {offer.RecipientSessionSha256}\n"
                + $"CLAIM-SHA256: {offer.FactSha256}\n"
                + $"SNAPSHOT-SHA256: {offer.SnapshotSha256}\n"
                + $"ERGEBNIS-SHA256: {offer.ResultSetSha256}\n"
                + $"PROVENIENZ: {offer.Provenance}\n"
                + "ACHTUNG: Gleiche Windows-SID/PID beweist keine "
                + "unveränderte Original-Codex-Sitzung.";
            _ciReadAcknowledge.Enabled = true;
            _status.Text = "CI: Exakter Original-Claim und wartender Empfänger "
                + "angezeigt. Kein Inhalt vor ausdrücklicher separater Zustimmung.";
        }
        catch (Exception error)
        {
            _ciReadOffer = null;
            _ciObserved?.Dispose();
            _ciObserved = null;
            _status.Text = "CI-Einmal-Read-Angebot verweigert: "
                + error.Message;
        }
        finally
        {
            _busy = false;
            _ciReadPrepare.Enabled = true;
            UpdateVerifyEnabled();
        }
    }

    private void PerformCiOneShot()
    {
        if (!CiOnly || _busy || !_ciReadAcknowledge.Checked
            || _ciReadOffer is not { } offer) return;
        if (offer.ExpiresUtc <= DateTimeOffset.UtcNow)
        {
            InvalidateOffer();
            _status.Text = "CI: Empfänger-Sitzung oder Read-Challenge abgelaufen";
            return;
        }
        _busy = true;
        _ciReadConfirm.Enabled = false;
        _ciReadPrepare.Enabled = false;
        _project.Enabled = false;
        _branch.Enabled = false;
        _reference.Enabled = false;
        _status.Text = "CI-NUR: Reale native Windows-Hello-Interaktion "
            + "für genau einen Test-Claim an die angezeigte Kernel-PID ...";
        try
        {
            var assertion = NativeWindowsWebAuthn.GetAssertion(
                Handle,offer.Challenge,offer.CredentialId,
                offer.ExpectedOrigin,offer.ExpiresUtc);
            // Hello can take time: recheck the SAME held kernel process
            // immediately before the request that may release any bytes.
            if (!observed.Matches() || offer.ExpiresUtc<=DateTimeOffset.UtcNow)
                throw new InvalidOperationException(
                    "CI-Empfänger ist nach Windows Hello nicht mehr derselbe Prozess");
            var receipt = ProtectedOperatorService.CompleteCiOneShotRead(
                offer.TicketId,assertion);
            if (!receipt.Verified)
                throw new InvalidOperationException(
                    "Einmal-Read vom geschützten Dienst nicht bestätigt");
            _status.Text = "CI: Geschützter Dienst hat genau eine signierte "
                + "Testübertragung bestätigt. Keine produktive Freigabe.";
        }
        catch (Exception error)
        {
            _status.Text = "CI-Einmal-Read abgelehnt oder nicht bestätigt: "
                + error.Message;
        }
        finally
        {
            _ciReadOffer = null;
            _ciObserved?.Dispose();
            _ciObserved = null;
            _ciReadAcknowledge.Enabled = false;
            _ciReadAcknowledge.Checked = false;
            _ciReadPrepare.Enabled = true;
            _project.Enabled = true;
            _branch.Enabled = true;
            _reference.Enabled = true;
            _busy = false;
            UpdateVerifyEnabled();
        }
    }

    private async Task LoadReadDisclosureAsync()
    {
        if (_busy) return;
        InvalidateOffer();
        _busy = true;
        _readPrepare.Enabled = false;
        _load.Enabled = false;
        _status.Text = "Lade signierte geschützte Claim-Vorschau aus dem LocalService ...";
        try
        {
            var project = _project.Text.Trim();
            var branch = _branch.Text.Trim();
            var proposal = _reference.Text.Trim();
            var read = await Task.Run(() =>
                ProtectedOperatorService.BeginReadDisclosure(
                    project, branch, proposal));
            if (project != _project.Text.Trim()
                || branch != _branch.Text.Trim()
                || proposal != _reference.Text.Trim()
                || read.ExpiresUtc <= DateTimeOffset.UtcNow)
                throw new InvalidOperationException("Read-Scope während des Ladens geändert");
            _readOffer = read;
            _fact.Text = read.Value;
            _meaning.Text =
                $"READ-VORSCHAU (NICHT AN CODEX) | {read.Kind}\n"
                + $"PROJEKT: {read.ProjectId} | BRANCH: {read.Branch}\n"
                + $"COMMIT: {read.RevisionSha}\n"
                + $"CLAIM: {read.ClaimId} | E~: {read.ProposalRef}\n"
                + $"QUERY: {read.Query}\n"
                + $"EMPFÄNGER: {read.Recipient}\n"
                + $"PRINCIPAL-SID: {read.PrincipalSid}\n"
                + $"SNAPSHOT: {read.SnapshotSha256}\n"
                + $"CLAIM-SHA256: {read.FactSha256}\n"
                + $"ERGEBNIS-SHA256: {read.ResultSetSha256}\n"
                + $"PROVENIENZ: {read.Provenance}";
            _readAcknowledge.Enabled = true;
            _status.Text = "Genau einen dienstsignierten Claim geprüft. "
                + "Diese Operation prüft NUR den separaten Read-Zustimmungszweck. "
                + "Die Antwort geht NICHT an Codex.";
        }
        catch (Exception error)
        {
            _readOffer = null;
            _status.Text = "Geschützter Read-Vorschlag abgelehnt: "
                + error.Message + ". KEINE private Freigabe.";
        }
        finally
        {
            _busy = false;
            _readPrepare.Enabled = true;
            _load.Enabled = true;
            UpdateVerifyEnabled();
        }
    }

    private void PerformReadDisclosure()
    {
        if (_busy || !_readAcknowledge.Checked
            || _readOffer is not { } offer) return;
        if (offer.ExpiresUtc <= DateTimeOffset.UtcNow)
        {
            InvalidateOffer();
            _status.Text = "Read-Zustimmungs-Challenge abgelaufen";
            return;
        }
        _busy = true;
        _readConfirm.Enabled = false;
        _readPrepare.Enabled = false;
        _project.Enabled = false;
        _branch.Enabled = false;
        _reference.Enabled = false;
        _status.Text = "Native Windows Hello: Zustimmung nur zur angezeigten "
            + "Read-Vorschau, kein Claim-Release.";
        try
        {
            var assertion = NativeWindowsWebAuthn.GetAssertion(
                Handle,offer.Challenge,offer.CredentialId,
                offer.ExpectedOrigin,offer.ExpiresUtc);
            var receipt = ProtectedOperatorService.CompleteReadDisclosure(
                offer.TicketId,assertion);
            if (!receipt.Verified
                || receipt.Status != "verified_read_disclosure_intent_only")
                throw new InvalidOperationException(
                    "Read-Zustimmungsnachweis verweigert: "+receipt.Status);
            _status.Text = "Separate Windows-Hello-Read-Absicht geprüft. "
                + "NICHT freigegeben, NICHT an Codex gesendet.";
        }
        catch (Exception error)
        {
            _status.Text = "Read-Zustimmung abgebrochen/verweigert: "
                + error.Message + ". Kein Codex-Recall.";
        }
        finally
        {
            _readOffer = null;
            _readAcknowledge.Enabled = false;
            _readAcknowledge.Checked = false;
            _readPrepare.Enabled = true;
            _project.Enabled = true;
            _branch.Enabled = true;
            _reference.Enabled = true;
            _busy = false;
            UpdateVerifyEnabled();
        }
    }

    private void PerformPublish()
    {
        if (_busy || !_publishAcknowledge.Checked
            || _publication is not { } offer) return;
        if (offer.ExpiresUtc <= DateTimeOffset.UtcNow)
        {
            InvalidateOffer();
            _status.Text = "Claim-Commit-Challenge abgelaufen. Erneut vorbereiten.";
            return;
        }
        _busy = true;
        _load.Enabled = false;
        _enrollPrepare.Enabled = false;
        _reaffirmPrepare.Enabled = false;
        _publishPrepare.Enabled = false;
        _verify.Enabled = false;
        _reaffirmConfirm.Enabled = false;
        _publishCommit.Enabled = false;
        _project.Enabled = false;
        _branch.Enabled = false;
        _reference.Enabled = false;
        _status.Text = "Separate Windows-Hello-Prüfung zur Veröffentlichung "
            + "als geschützter Claim. Kein Codex-Recall.";
        try
        {
            var assertion = NativeWindowsWebAuthn.GetAssertion(Handle, offer);
            var receipt = ProtectedOperatorService.CompletePublish(
                offer.TicketId, assertion);
            if (!receipt.Verified || receipt.ClaimId is null
                || receipt.Status !=
                    "protected_user_direct_claim_committed_not_published_to_codex")
                throw new InvalidOperationException(
                    "Dienst hat Claim-Publikation verweigert: " + receipt.Status);
            _status.Text = "Geschützter persönlicher Claim gespeichert: "
                + receipt.ClaimId + ". Alte Evidence UNVERIFIZIERT. "
                + "NICHT in Codex abrufbar, kein produktiver Memory-Write.";
        }
        catch (Exception error)
        {
            _status.Text = "Claim-Veröffentlichung verweigert oder abgebrochen: "
                + error.Message;
        }
        finally
        {
            _publication = null;
            _publishAcknowledge.Enabled = false;
            _publishAcknowledge.Checked = false;
            _load.Enabled = true;
            _enrollPrepare.Enabled = true;
            _reaffirmPrepare.Enabled = true;
            _publishPrepare.Enabled = true;
            _project.Enabled = true;
            _branch.Enabled = true;
            _reference.Enabled = true;
            _busy = false;
            UpdateVerifyEnabled();
        }
    }

    private void PerformNativeEnrollment()
    {
        if (_busy || !_acknowledge.Checked
            || _enrollment is not { } original) return;
        if (original.ExpiresUtc <= DateTimeOffset.UtcNow)
        {
            InvalidateOffer();
            _status.Text = "Einschreib-Challenge abgelaufen. Neu vorbereiten.";
            return;
        }
        _busy = true;
        _load.Enabled = false;
        _enrollPrepare.Enabled = false;
        _reaffirmPrepare.Enabled = false;
        _verify.Enabled = false;
        _project.Enabled = false;
        _branch.Enabled = false;
        _reference.Enabled = false;
        _status.Text = "Windows WebAuthn erstellt eine neue lokale Credential. "
            + "Danach folgt eine ZWEITE Windows-Hello-Besitzprüfung.";
        try
        {
            var attestation = NativeWindowsWebAuthnRegistration.MakeCredential(
                Handle, original);
            _status.Text = "Windows-Hello-Credential erstellt. Prüfe signierte Dienst-Challenge …";
            var proofOffer = ProtectedOperatorService.VerifyNativeEnrollmentKey(
                original, attestation);
            _status.Text = "Credential geprüft. Starte zweite Windows-Hello-Besitzprüfung …";
            var assertion = NativeWindowsWebAuthn.GetAssertion(
                Handle, proofOffer);
            _status.Text = "Zweiter Besitznachweis erhalten. Prüfe Dienstabschluss …";
            var receipt = ProtectedOperatorService.CompleteNativeEnrollment(
                proofOffer.TicketId, assertion);
            if (!receipt.Verified
                || receipt.Status != "operator_native_uv_enrolled_unapproved")
                throw new InvalidOperationException(
                    "Dienst verweigerte die Einschreibung: " + receipt.Status);
            _status.Text = "Windows-Hello-Credential mit zweitem UV-Nachweis "
                + "geschützt eingeschrieben. KEIN Claim und KEINE "
                + "Freigabe einer Erinnerung erteilt.";
        }
        catch (Exception error)
        {
            _status.Text = "Einschreibung abgebrochen oder verweigert: "
                + error.Message + ". Kein Claim geschrieben.";
        }
        finally
        {
            _enrollment = null;
            _offer = null;
            _acknowledge.Enabled = false;
            _acknowledge.Checked = false;
            _load.Enabled = true;
            _enrollPrepare.Enabled = true;
            _reaffirmPrepare.Enabled = true;
            _project.Enabled = true;
            _branch.Enabled = true;
            _reference.Enabled = true;
            _busy = false;
            UpdateVerifyEnabled();
        }
    }

    private void PerformWindowsHelloProof()
    {
        if (_busy || !_acknowledge.Checked || _offer is not { } offer)
            return;
        // A proof must NEVER be obtained before the exact service-signed
        // fact is visibly displayed and the human explicitly acknowledges it.
        if (offer.ExpiresUtc <= DateTimeOffset.UtcNow)
        {
            InvalidateOffer();
            _status.Text = "Challenge abgelaufen. Bitte den Vorschlag neu laden.";
            return;
        }
        _busy = true;
        _load.Enabled = false;
        _verify.Enabled = false;
        _project.Enabled = false;
        _branch.Enabled = false;
        _reference.Enabled = false;
        _status.Text = "Windows Hello / FIDO2 öffnet. Kein Claim-Write möglich.";
        try
        {
            var assertion = NativeWindowsWebAuthn.GetAssertion(Handle, offer);
            var receipt = ProtectedOperatorService.Complete(offer.TicketId, assertion);
            if (!receipt.Verified
                || receipt.Status != "operator_webauthn_uv_verified_not_approved")
                throw new InvalidOperationException("Windows Hello Nachweis verweigert: "
                    + receipt.Status);
            _status.Text = "WebAuthn-Signatur vom Windows-Dienst bestätigt. "
                + "KEIN Claim geschrieben, KEINE Benutzerfreigabe erteilt.";
        }
        catch (Exception error)
        {
            _status.Text = "Nachweis fehlgeschlagen oder abgebrochen: "
                + error.Message + ". Kein Claim geschrieben.";
        }
        finally
        {
            _offer = null;
            _acknowledge.Enabled = false;
            _acknowledge.Checked = false;
            _load.Enabled = true;
            _project.Enabled = true;
            _branch.Enabled = true;
            _reference.Enabled = true;
            _busy = false;
            UpdateVerifyEnabled();
        }
    }
}
