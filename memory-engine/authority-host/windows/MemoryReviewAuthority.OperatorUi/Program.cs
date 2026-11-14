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

            if (args.Length != 0
                || !new WindowsPrincipal(WindowsIdentity.GetCurrent())
                    .IsInRole(WindowsBuiltInRole.Administrator))
            {
                MessageBox.Show(
                    "Diese lokale Prüfoberfläche muss bewusst als Administrator"
                    + " gestartet werden. Sie ist kein produktiver Memory-Writer.",
                    "AgentHub Memory", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 2;
            }

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
    private readonly Button _verify = new()
    {
        Text = "Mit Windows Hello prüfen (keine Freigabe)",
        AutoSize = true, Height = 38, Enabled = false,
    };
    private ServiceOffer? _offer;
    private bool _busy;

    internal OperatorReviewWindow()
    {
        Text = "AgentHub Memory | Geschützter E~ Review | NO-GO";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(860, 700);
        Size = new Size(1030, 790);
        BackColor = Color.FromArgb(16, 19, 24);
        ForeColor = Color.FromArgb(243, 245, 246);
        Font = new Font("Segoe UI", 10);

        var outer = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(28),
            ColumnCount = 1, RowCount = 8,
        };
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 80));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        outer.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 125));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        outer.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
        var header = new Label
        {
            Dock = DockStyle.Fill,
            Text = "AGENTHUB  /  MEMORY REVIEW\n"
                + "NATIVE WINDOWS HELLO PRÜFUNG    ·    KEINE CLAIMERSTELLUNG",
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
        outer.Controls.Add(_load, 0, 2);
        outer.Controls.Add(_fact, 0, 3);
        outer.Controls.Add(_meaning, 0, 4);
        outer.Controls.Add(_acknowledge, 0, 5);
        outer.Controls.Add(_verify, 0, 6);
        outer.Controls.Add(_status, 0, 7);
        Controls.Add(outer);

        _load.Click += async (_, _) => await LoadOfferAsync();
        _verify.Click += (_, _) => PerformWindowsHelloProof();
        _acknowledge.CheckedChanged += (_, _) => UpdateVerifyEnabled();
        _project.TextChanged += (_, _) => InvalidateOffer();
        _branch.TextChanged += (_, _) => InvalidateOffer();
        _reference.TextChanged += (_, _) => InvalidateOffer();
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
            && _offer is { } o && o.ExpiresUtc > DateTimeOffset.UtcNow;
    }

    private async Task LoadOfferAsync()
    {
        if (_busy) return;
        InvalidateOffer();
        _busy = true;
        _load.Enabled = false;
        _status.Text = "Frage den geschützten Windows-Dienst ab …";
        try
        {
            var project = _project.Text.Trim();
            var branch = _branch.Text.Trim();
            var proposalRef = _reference.Text.Trim();
            var offer = await Task.Run(() =>
                ProtectedOperatorService.Begin(project, branch, proposalRef));
            if (offer.ExpiresUtc <= DateTimeOffset.UtcNow)
                throw new InvalidOperationException("Service-Challenge bereits abgelaufen");
            _offer = offer;
            _fact.Text = offer.CanonicalFact;
            _meaning.Text = $"AKTION: {offer.Decision}    |    QUELLE: {offer.SourceOrigin}\n"
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
            _busy = false;
            UpdateVerifyEnabled();
        }
    }
}
