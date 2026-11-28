using System.Drawing;
using System.Windows.Forms;

namespace MemoryReviewAuthority.OperatorUi;

internal sealed partial class OperatorReviewWindow
{
    // No IPC, native Hello or approval is exercised here. This is a
    // regression test of real WinForms layout and initial presentation only.
    internal static void VerifyLayoutContract()
    {
        using var form = new OperatorReviewWindow(wireActions: false);
        _ = form.Handle;
        var scale = form.DeviceDpi / 96.0;
        int Px(int value) => (int)Math.Ceiling(value * scale);
        void Require(bool condition, string reason)
        {
            if (!condition) throw new InvalidOperationException("operator_layout: " + reason);
        }
        Control Find(string name) => form.Controls.Find(name, true).Single();
        var scroll = (Panel)Find("ReviewScroll");
        var content = Find("ReviewContent");
        var detail = Find("ReviewDetails");
        var scope = Find("ReviewScope");

        foreach (var (width, height) in new[] { (1060, 940), (760, 620), (1360, 900), (1060, 940) })
        {
            form.ClientSize = new Size(Px(width), Px(height));
            form.PerformLayout();
            using var bitmap = new Bitmap(form.Width, form.Height);
            form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));

            Require(!scroll.HorizontalScroll.Visible && content.Width <= scroll.ClientSize.Width,
                "horizontal overflow");
            Require(form._fact.Height >= Px(200) && form._meaning.Height >= Px(200)
                && form._fact.Width >= Px(180) && form._meaning.Width >= Px(180),
                "collapsed signed data");
            Require(form._fact.Right <= form._meaning.Left && form._meaning.Right <= detail.Width,
                "detail overlap or clipping");
            Require(form._status.Height >= Px(40), "collapsed status");
            foreach (var input in new[] { form._project, form._branch, form._reference })
                Require(input.Width >= Px(100) && input.Right <= scope.Width
                    && !string.IsNullOrWhiteSpace(input.AccessibleName), "scope input clipping or name");
            foreach (var button in new[] { form._compare, form._enrollPrepare, form._load,
                form._reaffirmPrepare, form._conflict, form._verify, form._reaffirmConfirm,
                form._publishPrepare, form._readPrepare, form._publishCommit, form._readConfirm })
                Require(button.Parent is not null && button.Width <= button.Parent.ClientSize.Width
                    && button.Height >= Px(40), "action layout");
        }
        Require(form._fact.ReadOnly && form._meaning.ReadOnly && form._status.ReadOnly
            && !form._fact.DetectUrls && !form._meaning.DetectUrls
            && form._fact.TabStop && form._meaning.TabStop,
            "review text must remain read-only, selectable and non-navigating");
        Require(form._compare.Enabled && form._enrollPrepare.Enabled && !form._conflict.Enabled
            && !form._verify.Enabled && !form._reaffirmConfirm.Enabled && !form._publishPrepare.Enabled
            && !form._publishCommit.Enabled && !form._readConfirm.Enabled && !form._ciReadConfirm.Enabled,
            "initial guard changed");
        Require(CiOnly == (form._ciReadPrepare.Parent is not null)
            && CiOnly == (form._ciReadAcknowledge.Parent is not null)
            && CiOnly == (form._ciReadConfirm.Parent is not null), "CI-only layout rows");
        var decision = Find("DecisionSummary");
        var ceremony = Find("CeremonySummary");
        Require(decision.Text.Contains("Kein aktiver") && ceremony.Text.Contains("Keine"),
            "empty decision summary");
        var expiry = DateTimeOffset.UtcNow.AddMinutes(10);
        form._enrollment = new RegistrationOffer("request", "ticket", "challenge", "user",
            "origin", "rp", expiry, "project", "branch", "E~0123456789", "revision",
            "snapshot", "fact", "evidence", "knowledge", "origin", "confirm", "Synthetic fact");
        form.UpdateVerifyEnabled();
        Require(decision.Text.Contains("confirm") && ceremony.Text.Contains("Einschreibung")
            && ceremony.Text.Contains("kein Claim"), "enrollment decision is not clear");
        Require(!form._verify.Enabled, "summary must not enable verification");
        form._enrollment = form._enrollment with { ExpiresUtc = expiry.AddHours(-1) };
        form.UpdateVerifyEnabled();
        Require(decision.Text.Contains("Kein aktiver"), "expired decision still active");
        form.InvalidateOffer();
        form._comparisonOffer = new ComparisonOffer("project", "branch", "E~0123456789",
            "revision", "snapshot", "evidence", "comparison", "reject", "knowledge",
            "Synthetic fact", Array.Empty<ComparisonClaim>(), false, "recorded_exact_snapshot");
        form.UpdateVerifyEnabled();
        Require(decision.Text.Contains("reject") && ceremony.Text.Contains("bereits gespeichert")
            && !form._conflict.Enabled, "recorded rejection summary");
        form.InvalidateOffer();
        Require(decision.Text.Contains("Kein aktiver") && ceremony.Text.Contains("Keine"),
            "invalidated decision remains visible");

        if (!ReviewPalette.HighContrast)
        {
            static double Luminance(Color color)
            {
                static double Linear(byte channel)
                {
                    var value = channel / 255.0;
                    return value <= 0.04045 ? value / 12.92 : Math.Pow((value + 0.055) / 1.055, 2.4);
                }
                return 0.2126 * Linear(color.R) + 0.7152 * Linear(color.G) + 0.0722 * Linear(color.B);
            }
            static double Contrast(Color a, Color b)
            {
                var x = Luminance(a);
                var y = Luminance(b);
                return (Math.Max(x, y) + 0.05) / (Math.Min(x, y) + 0.05);
            }
            Require(Contrast(ReviewPalette.Muted, ReviewPalette.Disabled) >= 4.5
                && Contrast(ReviewPalette.Muted, ReviewPalette.Background) >= 4.5
                && Contrast(ReviewPalette.Text, ReviewPalette.Accent) >= 4.5
                && Contrast(ReviewPalette.FieldText, ReviewPalette.Field) >= 4.5,
                "review text contrast");
        }
    }
}
