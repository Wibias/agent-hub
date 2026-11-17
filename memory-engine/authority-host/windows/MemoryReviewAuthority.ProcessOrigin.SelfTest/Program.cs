using System.Diagnostics;
using System.Globalization;
using System.IO.Pipes;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using MemoryReviewAuthority.LabService;

internal static class Program
{
    private static int Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindows()
                || Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true"
                || Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows")
                throw new InvalidOperationException("windows_ci_only");
            if (args.Length == 3 && args[0] == "--relay-approved")
                return RelayApproved(args[1],args[2]);
            if (args.Length == 2 && args[0] == "--relay-sibling")
                return RelaySibling(args[1]);
            if (args.Length == 4 && args[0] == "--child")
                return Client(args[1],args[2],args[3]);
            if (args.Length != 0)
                throw new ArgumentException("unexpected_arguments");
            return VerifyTwoRealProcessesSameAccount();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("MEMORY_PROCESS_ORIGIN FAIL "
                + error.GetType().Name + ": " + error.Message);
            return 1;
        }
    }

    private static int VerifyTwoRealProcessesSameAccount()
    {
        var exe = Path.Combine(AppContext.BaseDirectory,
            "MemoryReviewAuthority.ProcessOrigin.SelfTest.exe");
        Check(File.Exists(exe),"compiled_windows_apphost_missing");
        var pipeName = "AgentHubProcessOriginCi-" + Guid.NewGuid().ToString("N");
        var expectedSid = WindowsIdentity.GetCurrent().User?.Value;
        Check(!string.IsNullOrEmpty(expectedSid),"original_sid_missing");

        using var approved = StartChild(exe,pipeName,"approved","0");
        using var pin = ClientProcessObservationPin.CaptureTrustedLaunch(approved);
        using var sibling = StartChild(exe,pipeName,"sibling",
            approved.Id.ToString(CultureInfo.InvariantCulture));
        Check(approved.Id != sibling.Id,"clients_not_distinct_processes");
        var allowedCount = 0;
        var deniedCount = 0;
        for (int i = 0; i < 2; i++)
        {
            using var pipe = new NamedPipeServerStream(pipeName,
                PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous);
            using var connectDeadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            pipe.WaitForConnectionAsync(connectDeadline.Token).GetAwaiter().GetResult();
            using var reader = new StreamReader(pipe,Encoding.UTF8,
                detectEncodingFromByteOrderMarks:false,leaveOpen:true);
            var line = reader.ReadLine();
            Check(line is { Length: > 0 and < 2048 },"missing_process_claim");
            using var document = JsonDocument.Parse(line!);
            var request = document.RootElement;
            var role = request.GetProperty("role").GetString();
            var claimedPid = request.GetProperty("claimed_pid").GetInt32();
            // The sibling deliberately forges the same self-reported PID
            // as the approved process. It must STILL be denied.
            Check(claimedPid == approved.Id,"did_not_test_forged_pid");
            Check(role is "approved" or "sibling","unexpected_role");
            string? actualSid = null;
            pipe.RunAsClient(() =>
            {
                using var identity = WindowsIdentity.GetCurrent(ifImpersonating:true);
                actualSid = identity?.User?.Value;
            });
            Check(actualSid == expectedSid,"two_clients_not_same_windows_sid");
            var matched = pin.MatchesConnectedClient(pipe);
            if (role == "approved")
            {
                Check(matched,"trusted_process_did_not_match");
                allowedCount++;
            }
            else
            {
                Check(!matched,"forged_same_sid_process_was_accepted");
                deniedCount++;
            }
            using var writer = new StreamWriter(pipe,new UTF8Encoding(false),
                1024,leaveOpen:true) {AutoFlush=true};
            writer.WriteLine(matched ? "allowed" : "denied");
        }
        Check(approved.WaitForExit(10000),"approved_client_hung");
        Check(sibling.WaitForExit(10000),"sibling_client_hung");
        var aOut=approved.StandardOutput.ReadToEnd();
        var bOut=sibling.StandardOutput.ReadToEnd();
        var aError=approved.StandardError.ReadToEnd();
        var bError=sibling.StandardError.ReadToEnd();
        Check(approved.ExitCode == 0 && sibling.ExitCode == 0,
            "child_verdict_failed: " + aError + " " + bError);
        Check(aOut.Contains("PASS approved",StringComparison.Ordinal)
            && bOut.Contains("PASS sibling",StringComparison.Ordinal),
            "child_verdict_missing");
        Check(allowedCount==1 && deniedCount==1,"unexpected_client_counts");
        Check(!pin.PinnedProcessStillLive(),"exited_pid_still_authorized");
        Console.WriteLine(
            "PASS: same Windows SID, kernel-derived connected pipe PID matches only trusted child, sibling PID spoof denied");
        Console.WriteLine(
            "PASS: pinned process handle becomes unusable after exit; no project, Claim or memory read");
        VerifySameAccountRelayedIntent(exe,expectedSid!);
        Console.WriteLine("MEMORY_PROCESS_ORIGIN PASS 3/3; PID_OR_SIGNED_IMAGE_NOT_SESSION_ATTESTATION");
        return 0;
    }

    private static void VerifySameAccountRelayedIntent(
        string exe,string expectedSid)
    {
        // Two distinct processes execute the EXACT SAME native executable.
        // A non-approved sibling passes an instruction to the host-pinned
        // process. The pinned process then legitimately connects and relays
        // the sibling's text. Kernel PID and image still match, exposing
        // why process provenance is NOT user intent or injection defense.
        var origin="AgentHubOriginRelayCi-"+Guid.NewGuid().ToString("N");
        var control="AgentHubSiblingControlCi-"+Guid.NewGuid().ToString("N");
        using var approved=StartRole(exe,"--relay-approved",origin,control);
        using var pin=ClientProcessObservationPin.CaptureTrustedLaunch(approved);
        using var sibling=StartRole(exe,"--relay-sibling",control);
        Check(approved.Id!=sibling.Id,"relay_sibling_pid_not_distinct");
        Check(approved.StartInfo.FileName==sibling.StartInfo.FileName,
            "relay_clients_not_identical_executable");
        using var pipe=new NamedPipeServerStream(origin,PipeDirection.InOut,
            1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous);
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(15));
        pipe.WaitForConnectionAsync(deadline.Token).GetAwaiter().GetResult();
        using var reader=new StreamReader(pipe,Encoding.UTF8,
            detectEncodingFromByteOrderMarks:false,leaveOpen:true);
        var text=reader.ReadLine();
        Check(text=="sibling-request-for-private-data",
            "relay_test_did_not_forward_sibling_payload");
        string? sid=null;
        pipe.RunAsClient(()=>
        {
            using var identity=WindowsIdentity.GetCurrent(ifImpersonating:true);
            sid=identity?.User?.Value;
        });
        Check(sid==expectedSid,"relay_process_wrong_same_account_sid");
        // The pinned OS connection is legitimate, but the instruction
        // originated from the attacker-controlled same-SID sibling.
        Check(pin.MatchesConnectedClient(pipe),
            "relay_expected_pin_match_missing");
        using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),
            1024,leaveOpen:true){AutoFlush=true})
            writer.WriteLine("origin_matched_but_intent_untrusted");
        Check(approved.WaitForExit(10000),"relay_approved_hung");
        Check(sibling.WaitForExit(10000),"relay_sibling_hung");
        var aOut=approved.StandardOutput.ReadToEnd();
        var bOut=sibling.StandardOutput.ReadToEnd();
        var aErr=approved.StandardError.ReadToEnd();
        var bErr=sibling.StandardError.ReadToEnd();
        Check(approved.ExitCode==0 && sibling.ExitCode==0,
            "relay_child_fail: "+aErr+" "+bErr);
        Check(aOut.Contains("PASS relayed",StringComparison.Ordinal)
            && bOut.Contains("PASS sibling_instruction",StringComparison.Ordinal),
            "relay_child_verdict_missing");
        Console.WriteLine(
            "PASS: identical-image same-SID sibling caused a host-pinned process to relay attacker text; kernel PID still matched");
        Console.WriteLine(
            "PASS: provenance is NOT operator intent, original Codex attestation, or protection against process automation/injection");
    }

    private static Process StartRole(string exe,params string[] args)
    {
        var start=new ProcessStartInfo(exe)
        {
            UseShellExecute=false,RedirectStandardOutput=true,
            RedirectStandardError=true,CreateNoWindow=true,
        };
        foreach(var arg in args)start.ArgumentList.Add(arg);
        return Process.Start(start)
            ?? throw new InvalidOperationException("relay_process_start_failed");
    }

    private static int RelayApproved(string origin,string control)
    {
        using var server=new NamedPipeServerStream(control,PipeDirection.InOut,
            1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous);
        using var ct=new CancellationTokenSource(TimeSpan.FromSeconds(15));
        server.WaitForConnectionAsync(ct.Token).GetAwaiter().GetResult();
        using var reader=new StreamReader(server,Encoding.UTF8,
            detectEncodingFromByteOrderMarks:false,leaveOpen:true);
        var text=reader.ReadLine();
        Check(text=="sibling-request-for-private-data",
            "approved_caller_did_not_receive_sibling_message");
        using var pipe=new NamedPipeClientStream(".",origin,
            PipeDirection.InOut,PipeOptions.None,
            TokenImpersonationLevel.Impersonation);
        pipe.Connect(15000);
        using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),
            1024,leaveOpen:true){AutoFlush=true})
            writer.WriteLine(text);
        using var result=new StreamReader(pipe,Encoding.UTF8,
            detectEncodingFromByteOrderMarks:false,leaveOpen:true);
        Check(result.ReadLine()=="origin_matched_but_intent_untrusted",
            "relayed_request_origin_verdict_wrong");
        Console.WriteLine("PASS relayed");
        return 0;
    }

    private static int RelaySibling(string control)
    {
        using var client=new NamedPipeClientStream(".",control,
            PipeDirection.InOut,PipeOptions.None,
            TokenImpersonationLevel.Impersonation);
        client.Connect(15000);
        using var writer=new StreamWriter(client,new UTF8Encoding(false),
            1024,leaveOpen:true){AutoFlush=true};
        writer.WriteLine("sibling-request-for-private-data");
        Console.WriteLine("PASS sibling_instruction");
        return 0;
    }

    private static Process StartChild(string exe,string pipe,string role,string claimedPid)
    {
        var start = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add("--child");
        start.ArgumentList.Add(pipe);
        start.ArgumentList.Add(role);
        start.ArgumentList.Add(claimedPid);
        var process = Process.Start(start);
        return process ?? throw new InvalidOperationException("child_launch_failed");
    }

    private static int Client(string pipeName,string role,string claimedPid)
    {
        if (role is not ("approved" or "sibling"))
            throw new ArgumentException("bad_child_role");
        var pid = role == "approved" ? Environment.ProcessId
            : int.Parse(claimedPid,CultureInfo.InvariantCulture);
        using var pipe = new NamedPipeClientStream(".",pipeName,
            PipeDirection.InOut,PipeOptions.None,TokenImpersonationLevel.Impersonation);
        pipe.Connect(15000);
        using var writer = new StreamWriter(pipe,new UTF8Encoding(false),
            1024,leaveOpen:true){AutoFlush=true};
        writer.WriteLine(JsonSerializer.Serialize(new
        {
            role, claimed_pid=pid,
        }));
        using var reader = new StreamReader(pipe,Encoding.UTF8,
            detectEncodingFromByteOrderMarks:false,leaveOpen:true);
        var verdict = reader.ReadLine();
        Check(verdict==(role=="approved"?"allowed":"denied"),
            "unexpected_kernel_process_verdict");
        Console.WriteLine("PASS "+role);
        return 0;
    }

    private static void Check(bool ok,string reason)
    {
        if (!ok) throw new InvalidOperationException(reason);
    }
}
