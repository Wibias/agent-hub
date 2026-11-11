using System;

namespace AgentHub.LaneB;

// Source RC0.1.0: no write-capable dispatch code exists in this build.
internal static class BrokerRequestRouter
{
    internal static bool IsLegacyApplyDenied(ReadOnlySpan<byte> data) =>
        data.SequenceEqual("AHB1|APPLY"u8);

    // Explicit negative contract for the historical laboratory opcode.
    internal static bool IsLabCommitCommand(ReadOnlySpan<byte> data) => false;

    // Invoked only after client token validation and successful RevertToSelf.
    internal static byte[] Evaluate(ReadOnlySpan<byte> data) =>
        ReadOnlyPolicy.Evaluate(data);
}
