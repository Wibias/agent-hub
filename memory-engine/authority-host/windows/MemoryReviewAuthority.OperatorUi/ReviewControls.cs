using System.Drawing;
using System.Windows.Forms;
using System.Windows.Forms.VisualStyles;

namespace MemoryReviewAuthority.OperatorUi;

internal static class ReviewPalette
{
    internal static bool HighContrast => SystemInformation.HighContrast;
    internal static Color Background => HighContrast ? SystemColors.Control : Color.FromArgb(23, 26, 32);
    internal static Color Field => HighContrast ? SystemColors.Window : Color.FromArgb(31, 38, 48);
    internal static Color Text => HighContrast ? SystemColors.ControlText : Color.FromArgb(241, 244, 247);
    internal static Color FieldText => HighContrast ? SystemColors.WindowText : Text;
    internal static Color Muted => HighContrast ? SystemColors.GrayText : Color.FromArgb(166, 179, 193);
    internal static Color Border => HighContrast ? SystemColors.ControlDark : Color.FromArgb(87, 103, 121);
    internal static Color Disabled => HighContrast ? SystemColors.Control : Color.FromArgb(35, 42, 52);
    internal static Color Action => Color.FromArgb(39, 48, 60);
    internal static Color Accent => Color.FromArgb(35, 83, 135);
}

internal sealed class ReviewButton : Button
{
    internal void ApplyPalette(bool primary)
    {
        if (ReviewPalette.HighContrast)
        {
            FlatStyle = FlatStyle.Standard;
            UseVisualStyleBackColor = true;
            return;
        }
        FlatStyle = FlatStyle.Flat;
        UseVisualStyleBackColor = false;
        BackColor = primary ? ReviewPalette.Accent : ReviewPalette.Action;
        ForeColor = ReviewPalette.Text;
        FlatAppearance.BorderColor = primary ? Color.FromArgb(113, 161, 217) : ReviewPalette.Border;
        FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(43, 101, 161) : Color.FromArgb(53, 65, 80);
        FlatAppearance.MouseDownBackColor = primary ? Color.FromArgb(28, 66, 108) : Color.FromArgb(32, 40, 50);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        if (Enabled || ReviewPalette.HighContrast)
        {
            base.OnPaint(e);
            return;
        }

        // Only change disabled presentation. Native Enabled/TabStop,
        // accessibility, event handling and focus semantics remain intact.
        e.Graphics.Clear(ReviewPalette.Disabled);
        using var pen = new Pen(ReviewPalette.Border);
        e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
        var inset = Math.Max(8, (int)Math.Ceiling(10 * DeviceDpi / 96.0));
        TextRenderer.DrawText(e.Graphics, Text, Font,
            Rectangle.Inflate(ClientRectangle, -inset, -2), ReviewPalette.Muted,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter |
            TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
    }
}

internal sealed class ReviewCheckBox : CheckBox
{
    protected override void OnPaint(PaintEventArgs e)
    {
        if (Enabled || ReviewPalette.HighContrast)
        {
            base.OnPaint(e);
            return;
        }

        e.Graphics.Clear(BackColor);
        var state = Checked ? CheckBoxState.CheckedDisabled : CheckBoxState.UncheckedDisabled;
        var size = CheckBoxRenderer.GetGlyphSize(e.Graphics, state);
        var y = Math.Max(0, (Height - size.Height) / 2);
        CheckBoxRenderer.DrawCheckBox(e.Graphics, new Point(0, y), state);
        var inset = size.Width + Math.Max(6, (int)Math.Ceiling(8 * DeviceDpi / 96.0));
        TextRenderer.DrawText(e.Graphics, Text, Font,
            new Rectangle(inset, 0, Math.Max(1, Width - inset), Height),
            ReviewPalette.Muted, TextFormatFlags.Left | TextFormatFlags.VerticalCenter |
            TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
    }
}
