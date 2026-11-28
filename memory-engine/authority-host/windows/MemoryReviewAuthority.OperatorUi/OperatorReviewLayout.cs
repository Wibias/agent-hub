using System.Drawing;
using System.Windows.Forms;

namespace MemoryReviewAuthority.OperatorUi;

// A task-first layout with native keyboard, focus and consent behavior.
internal sealed partial class OperatorReviewWindow
{

    private readonly Label _decisionSummary = new()
    {
        Name = "DecisionSummary", AccessibleName = "Vorgeschlagene Entscheidung",
        Text = "Kein aktiver Entscheidungsvorschlag geladen.",
        AutoSize = true, Dock = DockStyle.Fill,
        Font = new Font("Segoe UI Semibold", 13),
        ForeColor = ReviewPalette.Text, Margin = new Padding(0, 0, 0, 3),
    };

    private readonly Label _ceremonySummary = new()
    {
        Name = "CeremonySummary", AccessibleName = "Aktueller Pr\u00fcfschritt",
        Text = "Keine aktive Pr\u00fcfung. Oben einen Pr\u00fcfpfad ausw\u00e4hlen.",
        AutoSize = true, Dock = DockStyle.Fill,
        ForeColor = ReviewPalette.Text, Margin = new Padding(0, 0, 0, 8),
    };

    private void RefreshDecisionSummary()
    {
        var now = DateTimeOffset.UtcNow;
        string? decision = null;
        string? ceremony = null;
        if (_comparisonOffer is { } comparison)
        {
            decision = comparison.Decision;
            ceremony = comparison.ConflictIntentStatus switch
            {
                "recorded_exact_snapshot" => "Intent f\u00fcr diesen Snapshot bereits gespeichert; kein Claim.",
                "recorded_different_snapshot" => "Fr\u00fcherer Intent f\u00fcr anderen Snapshot; neue Entscheidung gesperrt.",
                _ => comparison.ConflictIntentAvailable
                    ? "Konflikt-Intent pr\u00fcfen; kein Claim."
                    : "Nur Vergleich lesen; keine Konfliktaktion verf\u00fcgbar.",
            };
        }
        else if (_enrollment is { } enrollment && enrollment.ExpiresUtc > now)
        {
            decision = enrollment.Decision;
            ceremony = "Windows-Hello-Einschreibung und Besitznachweis; kein Claim.";
        }
        else if (_offer is { } offer && offer.ExpiresUtc > now)
        {
            decision = offer.Decision;
            ceremony = "Windows-Hello-Besitznachweis; kein Claim.";
        }
        else if (_reaffirmation is { } reaffirmation && reaffirmation.ExpiresUtc > now)
        {
            decision = reaffirmation.Decision;
            ceremony = "Neue pers\u00f6nliche Aussage; historische Evidence unverifiziert; kein Claim.";
        }
        else if (_publication is { } publication && publication.ExpiresUtc > now)
        {
            decision = publication.Decision;
            ceremony = "Separater gesch\u00fctzter Claim-Commit; kein Codex-Recall.";
        }
        else if (_readOffer is { } read && read.ExpiresUtc > now)
        {
            ceremony = "Read-Zustimmungspr\u00fcfung; keine Freigabe an Codex.";
        }
        else if (_ciReadOffer is { } ci && ci.ExpiresUtc > now)
        {
            ceremony = "CI-Test\u00fcbertragung; keine produktive Freigabe.";
        }

        _decisionSummary.Text = decision switch
        {
            "confirm" => "Vorgeschlagene Entscheidung: Best\u00e4tigen (confirm)",
            "reject" => "Vorgeschlagene Entscheidung: Ablehnen (reject)",
            _ => "Kein aktiver Entscheidungsvorschlag geladen.",
        };
        _ceremonySummary.Text = ceremony is null
            ? "Keine aktive Pr\u00fcfung. Oben einen Pr\u00fcfpfad ausw\u00e4hlen."
            : "Pr\u00fcfschritt: " + ceremony;
    }

    private void BuildLayout()
    {
        Text = "AgentHub Memory | Gesch\u00fctzter E~ Review | NO-GO";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        MinimumSize = new Size(760, 620);
        Size = new Size(1080, 960);
        BackColor = ReviewPalette.Background;
        ForeColor = ReviewPalette.Text;
        Font = new Font("Segoe UI", 10);

        var root = new TableLayoutPanel
        {
            Name = "ReviewRoot", Dock = DockStyle.Fill, ColumnCount = 1,
            RowCount = 3, Margin = Padding.Empty, Padding = new Padding(20, 14, 20, 14),
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var header = Stack();
        AddRow(header, Heading("Memory Review", 18));
        AddRow(header, new Label
        {
            Text = "Tempor\u00e4res Native-Hello-Lab  \u00b7  Kein Codex-Recall  \u00b7  Keine Claim-Freigabe",
            AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 12),
        });
        root.Controls.Add(header, 0, 0);

        var scroll = new Panel
        {
            Name = "ReviewScroll", Dock = DockStyle.Fill, AutoScroll = true,
            Margin = Padding.Empty, Padding = new Padding(0, 0, 8, 0), TabStop = false,
        };
        var content = Stack();
        content.Name = "ReviewContent";
        content.Dock = DockStyle.Top;
        // Only the document scrolls. The fact and metadata retain their own
        // readable text areas; neither gets leftover percent-row space.
        AddRow(content, Heading("1. Vorschlag ausw\u00e4hlen"));
        var scope = new TableLayoutPanel
        {
            Name = "ReviewScope", AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 2, Margin = Padding.Empty,
        };
        scope.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 45));
        scope.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 35));
        scope.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 20));
        scope.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        scope.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        AddScopeField(scope, 0, "Projekt (github.com/owner/repo)", "Project", _project);
        AddScopeField(scope, 1, "Branch", "Branch", _branch);
        AddScopeField(scope, 2, "E~-Referenz (10 Hex)", "ProposalReference", _reference);
        AddRow(content, scope);
        AddRow(content, ActionPair(_compare, _enrollPrepare));
        ((ReviewButton)_compare).ApplyPalette(primary: true);
        AddRow(content, ActionPair(_load, _reaffirmPrepare));

        AddRow(content, Heading("2. Signierten Inhalt pr\u00fcfen"));
        AddRow(content, _decisionSummary);
        AddRow(content, _ceremonySummary);
        var reviewHint = new Label
        {
            Text = "Kein signierter Inhalt geladen. Oben einen Pr\u00fcfpfad ausw\u00e4hlen.",
            AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, 0, 0, 6),
        };
        _fact.TextChanged += (_, _) => reviewHint.Text = _fact.TextLength == 0
            ? "Kein signierter Inhalt geladen. Oben einen Pr\u00fcfpfad ausw\u00e4hlen."
            : "Erst den vollst\u00e4ndigen Fakt, die Vergleichs-Claims und die angezeigte Entscheidung lesen.";
        AddRow(content, reviewHint);
        var detail = new TableLayoutPanel
        {
            Name = "ReviewDetails", ColumnCount = 2, RowCount = 2, AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Fill, Margin = Padding.Empty,
        };
        detail.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 62));
        detail.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 38));
        detail.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        detail.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        detail.Controls.Add(Heading("Fakt und Vergleich", 11), 0, 0);
        detail.Controls.Add(Heading("Scope und Pr\u00fcfsummen", 11), 1, 0);
        ConfigureReviewText(_fact, "SignedFact", "Signierter Fakt und Claim-Vergleich", 244);
        ConfigureReviewText(_meaning, "SignedMetadata", "Scope, Revision und Pr\u00fcfsummen", 244);
        _fact.Margin = new Padding(0, 0, 8, 6);
        _meaning.Font = new Font("Consolas", 10);
        detail.Controls.Add(_fact, 0, 1);
        detail.Controls.Add(_meaning, 1, 1);
        AddRow(content, detail);

        AddRow(content, Heading("3. Nur den angezeigten Intent pr\u00fcfen"));
        AddRow(content, SingleAction(_conflict));
        AddRow(content, _acknowledge);
        AddRow(content, SingleAction(_verify));
        AddRow(content, _reaffirmAcknowledge);
        AddRow(content, SingleAction(_reaffirmConfirm));

        AddRow(content, Heading("Weitere Pr\u00fcfpfade"));
        AddRow(content, ActionPair(_publishPrepare, _readPrepare));
        AddRow(content, _publishAcknowledge);
        AddRow(content, SingleAction(_publishCommit));
        AddRow(content, _readAcknowledge);
        AddRow(content, SingleAction(_readConfirm));
        // Do not allocate empty production rows for CI-only operations.
        _ciReadPrepare.Visible = _ciReadAcknowledge.Visible = _ciReadConfirm.Visible = CiOnly;
        if (CiOnly)
        {
            AddRow(content, Heading("CI-Testpfad"));
            AddRow(content, SingleAction(_ciReadPrepare));
            AddRow(content, _ciReadAcknowledge);
            AddRow(content, SingleAction(_ciReadConfirm));
        }

        foreach (var check in new[] { _acknowledge, _reaffirmAcknowledge, _publishAcknowledge,
                     _readAcknowledge, _ciReadAcknowledge })
            ConfigureAcknowledgment(check);

        scroll.Controls.Add(content);
        root.Controls.Add(scroll, 0, 1);

        var footer = Stack();
        AddRow(footer, Heading("Status", 11));
        _status.Name = "ReviewStatus";
        _status.AccessibleName = "Aktueller Pr\u00fcfstatus";
        _status.BackColor = ReviewPalette.Field;
        _status.ForeColor = ReviewPalette.FieldText;
        _status.Dock = DockStyle.Fill;
        _status.Height = 48;
        _status.MinimumSize = new Size(0, 48);
        _status.Margin = Padding.Empty;
        AddRow(footer, _status);
        root.Controls.Add(footer, 0, 2);
        Controls.Add(root);
    }

    private static TableLayoutPanel Stack()
    {
        var panel = new TableLayoutPanel
        {
            AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 1, RowCount = 0, Dock = DockStyle.Fill,
            Margin = Padding.Empty, Padding = Padding.Empty,
        };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        return panel;
    }

    private static void AddRow(TableLayoutPanel panel, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(control, 0, row);
    }

    private static Label Heading(string text, float size = 12) => new()
    {
        Text = text, AutoSize = true, Dock = DockStyle.Fill,
        Font = new Font("Segoe UI Semibold", size),
        ForeColor = ReviewPalette.Text, Margin = new Padding(0, 10, 0, 6),
    };

    private static void AddScopeField(TableLayoutPanel table, int column, string caption,
        string name, TextBox field)
    {
        table.Controls.Add(new Label
        {
            Text = caption, AutoSize = true, Dock = DockStyle.Fill,
            Margin = new Padding(0, 0, 8, 3),
        }, column, 0);
        field.Name = name;
        field.AccessibleName = caption;
        field.Dock = DockStyle.Fill;
        field.Margin = new Padding(0, 0, column == 2 ? 0 : 8, 8);
        field.BackColor = ReviewPalette.Field;
        field.ForeColor = ReviewPalette.FieldText;
        table.Controls.Add(field, column, 1);
    }

    private static TableLayoutPanel ActionPair(Button first, Button second)
    {
        var pair = new TableLayoutPanel
        {
            ColumnCount = 2, RowCount = 1, AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Fill, Margin = Padding.Empty,
        };
        pair.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        pair.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        pair.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        ConfigureButton(first, new Padding(0, 0, 4, 6));
        ConfigureButton(second, new Padding(4, 0, 0, 6));
        pair.Controls.Add(first, 0, 0);
        pair.Controls.Add(second, 1, 0);
        return pair;
    }

    private static Button SingleAction(Button button)
    {
        ConfigureButton(button, new Padding(0, 0, 0, 8));
        return button;
    }

    private static void ConfigureButton(Button button, Padding margin)
    {
        button.AutoSize = false;
        button.Dock = DockStyle.Top;
        button.Height = 44;
        button.MinimumSize = new Size(0, 44);
        button.Margin = margin;
        ((ReviewButton)button).ApplyPalette(primary: false);
        FitWrappedText(button, 20, 18, 44);
    }

    private static void ConfigureAcknowledgment(CheckBox check)
    {
        check.AutoSize = false;
        check.Dock = DockStyle.Top;
        check.Height = 44;
        check.MinimumSize = new Size(0, 44);
        check.Margin = new Padding(0, 0, 0, 6);
        check.TextAlign = ContentAlignment.MiddleLeft;
        check.ForeColor = ReviewPalette.Text;
        check.FlatStyle = FlatStyle.Standard;
        check.UseVisualStyleBackColor = ReviewPalette.HighContrast;
        check.BackColor = ReviewPalette.Background;
        FitWrappedText(check, 30, 12, 44);
    }

    private static void FitWrappedText(Control control, int horizontalInset,
        int verticalInset, int minimum)
    {
        void Update()
        {
            if (control.Width < 100) return;
            int Scale(int value) => (int)Math.Ceiling(value * control.DeviceDpi / 96.0);
            var size = TextRenderer.MeasureText(control.Text, control.Font,
                new Size(Math.Max(1, control.Width - Scale(horizontalInset)), int.MaxValue),
                TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
            var height = Math.Max(Scale(minimum), size.Height + Scale(verticalInset));
            if (control.MinimumSize.Height != height)
            {
                control.MinimumSize = new Size(0, height);
                control.Height = height;
            }
        }
        control.SizeChanged += (_, _) => Update();
        control.TextChanged += (_, _) => Update();
        control.FontChanged += (_, _) => Update();
    }

    private static void ConfigureReviewText(RichTextBox text, string name,
        string accessibleName, int height)
    {
        text.Name = name;
        text.AccessibleName = accessibleName;
        text.Dock = DockStyle.Fill;
        text.Height = height;
        text.MinimumSize = new Size(0, height);
        text.Margin = new Padding(0, 0, 0, 6);
        text.BackColor = ReviewPalette.Field;
        text.ForeColor = ReviewPalette.FieldText;
        text.ReadOnly = true;
        text.DetectUrls = false;
        text.WordWrap = true;
        text.ScrollBars = RichTextBoxScrollBars.Vertical;
        text.TabStop = true;
    }
}
