namespace AgentHub.LaneB;

internal static class BrokerIdentity
{
    // Frozen names from EG45.31 / Lane A. Not the legacy scratch broker identity.
    internal const string BrokerServiceName = "AgentHubEG4528JournalBroker";
    internal const string ScratchServiceName = "AgentHubD121417ScratchSvc";
    internal const string BrokerServiceSid = "S-1-5-80-1871353128-2073126224-3623205792-890782069-2664301559";
    internal const string ScratchServiceSid = "S-1-5-80-206086128-3447947495-1842352659-2836494350-1013679070";
    internal const string LocalServiceSid = "S-1-5-19";
    internal const string PipePath = @"\\.\pipe\AgentHub-EG45-LaneB-ReadOnly";
    // The allowed scratch client may read/write data, read attributes, and synchronize.
    // This never includes FILE_CREATE_PIPE_INSTANCE (0x00000004).
    internal const uint ClientAccess = 0x00100083;
}
