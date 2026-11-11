using System;
using System.Text;
using System.Text.Json;

namespace AgentHub.LaneB;

internal static class ReadOnlyPolicy
{
    // No request in this build can commit or mutate anything.
    internal static bool IsApprovedPing(ReadOnlySpan<byte> payload) => payload.SequenceEqual("AHB1|PING"u8);

    internal static byte[] Evaluate(ReadOnlySpan<byte> payload)
    {
        string result = IsApprovedPing(payload) ? "Broker alive (Lane B read-only)" : "Commit route disabled (C9 read-only source RC)";
        var response = new {
            State = "NOT_COMMITTED", Applied = false, Warnings = Array.Empty<string>(),
            Backup = (string?)null, Error = result
        };
        return Encoding.UTF8.GetBytes(JsonSerializer.Serialize(response) + "\n");
    }
}
