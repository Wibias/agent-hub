using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using AgentHub.C9.G5;
using Microsoft.Win32.SafeHandles;

if (!OperatingSystem.IsWindows() ||
    Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
    Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
    Environment.GetEnvironmentVariable("AGENTHUB_G5_REVIEW_ONLY") != "ISOLATED_GITHUB_RUNNER")
    throw new InvalidOperationException("G5_RUNNER_SCOPE_DENIED");


static ApprovedFilePin PinFromIndependentTestSetup(string path)
{
    using SafeFileHandle handle = File.OpenHandle(path, FileMode.Open, FileAccess.Read, FileShare.Read);
    IntPtr block=Marshal.AllocHGlobal(24);
    try
    {
        if (!TestNative.QueryId(handle, 18,block,24))throw new InvalidOperationException("G5_TEST_SETUP_FILEID_INFO_FAILED");
        ulong serial=unchecked((ulong)Marshal.ReadInt64(block));
        byte[] id=new byte[16];Marshal.Copy(IntPtr.Add(block,8),id,0,16);
        string hash=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
        return new ApprovedFilePin(serial.ToString("x16",CultureInfo.InvariantCulture),
            Convert.ToHexString(id).ToLowerInvariant(), hash);
    }
    finally {Marshal.FreeHGlobal(block);}
}

int pass=0;
void Check(string name,bool condition)
{
    if(!condition)throw new Exception("G5_TEST_FAIL "+name);
    pass++;Console.WriteLine("PASS "+name);
}
void Deny(string name,string root,string path,ApprovedFilePin expected)
{
    G5OpenResult result=HandleIdentity.OpenApprovedReadOnly(root,path,expected);
    result.File?.Dispose();
    Check(name,!result.Verdict.IdentityAndPreimageMatched &&
        !result.Verdict.CanExecuteCommit && result.File is null);
}

string directory=Path.Combine(Path.GetTempPath(),"agenthub-g5-"+Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(directory);
try
{
    string file=Path.Combine(directory,"target.bin");
    File.WriteAllBytes(file,[0x11,0x22,0x33,0x44,0x55,0x66]);
    ApprovedFilePin pin=PinFromIndependentTestSetup(file);
    using(G5OpenResultHolder positive=new(HandleIdentity.OpenApprovedReadOnly(directory,"target.bin",pin)))
    {
        Check("native FileIdInfo matches independently supplied test pin",positive.Result.Verdict.IdentityAndPreimageMatched &&
            positive.Result.File is not null && !positive.Result.Verdict.CanExecuteCommit);
        Check("proof is 64-bit volume and 128-bit file id",positive.Result.File is {OriginalProof:var proof} &&
            proof.VolumeId==pin.VolumeId && proof.FileId==pin.FileId && proof.PreimageSha256==pin.PreimageSha256);
        Check("retained handle recheck remains non executable",positive.Result.File?.RecheckPinned() is
            {IdentityAndPreimageMatched:true,CanExecuteCommit:false});
        bool blocked=false;
        try {File.Move(file,Path.Combine(directory,"renamed-during-lease.bin"));}
        catch(IOException){blocked=true;}
        Check("leaf rename denied while pinned read-only handle remains open",blocked);
    }
    Deny("wrong target volume denied",directory,"target.bin",pin with {VolumeId=new string('1',16)});
    Deny("wrong target file ID denied",directory,"target.bin",pin with {FileId=new string('2',32)});
    Deny("wrong preimage SHA denied",directory,"target.bin",pin with {PreimageSha256=new string('3',64)});
    Deny("missing file denied",directory,"missing.bin",pin);
    Deny("relative traversal rejected",directory,"..\\target.bin",pin);
    Deny("alternate data stream rejected",directory,"target.bin:alternate",pin);
    Deny("absolute path rejected",directory,file,pin);
    Deny("UNC root rejected","\\\\example\\share","target.bin",pin);
    Deny("invalid pin encoding rejected",directory,"target.bin",pin with {FileId="bad"});

    using(FileStream writer=new(file,FileMode.Open,FileAccess.Write,FileShare.ReadWrite|FileShare.Delete))
        Deny("preexisting writer prevents safe handle acquisition",directory,"target.bin",pin);
    using(FileStream blocker=new(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete))
    {
        File.WriteAllBytes(Path.Combine(directory,"standin.bin"),[0,1,2,3]);
        // A shared read handle alone must not grant write authority.
        Check("observer does not expose a commit capability",!HandleIdentity.OpenApprovedReadOnly(directory,
            "standin.bin",pin).Verdict.CanExecuteCommit);
    }

    string newLeaf=Path.Combine(directory,"new-leaf.bin");
    File.Move(file,Path.Combine(directory,"original-kept.bin"));
    File.WriteAllBytes(newLeaf,[0x11,0x22,0x33,0x44,0x55,0x66]);
    File.Move(newLeaf,file);
    Deny("same bytes but swapped file identity denied",directory,"target.bin",pin);
    ApprovedFilePin current=PinFromIndependentTestSetup(file);
    Check("replacement gets a distinct FileId",pin.FileId!=current.FileId);

    string link=Path.Combine(directory,"alias.bin");
    File.CreateSymbolicLink(link,file);
    Deny("leaf symbolic link denied",directory,"alias.bin",current);

    string external=Path.Combine(directory,"other-directory");
    Directory.CreateDirectory(external);
    File.WriteAllBytes(Path.Combine(external,"nested.bin"),[1,2,3]);
    ApprovedFilePin nested=PinFromIndependentTestSetup(Path.Combine(external,"nested.bin"));
    Directory.CreateSymbolicLink(Path.Combine(directory,"directory-link"),external);
    Deny("parent directory reparse denied",directory,"directory-link\\nested.bin",nested);
    string aliasRoot=Path.Combine(Path.GetDirectoryName(directory)!,"g5-alias-"+Guid.NewGuid().ToString("N"));
    try
    {
        Directory.CreateSymbolicLink(aliasRoot,directory);
        Deny("trusted root reparse denied",aliasRoot,"target.bin",current);
    }
    finally { if(Directory.Exists(aliasRoot))Directory.Delete(aliasRoot); }

    string hard=Path.Combine(directory,"hardlink.bin");
    if(!TestNative.CreateHardLink(hard,file,IntPtr.Zero))throw new InvalidOperationException("G5_HARDLINK_TEST_SETUP_FAILED");
    Deny("multiple hard links deny target",directory,"target.bin",current);
    File.Delete(hard);
    using(G5OpenResultHolder restored=new(HandleIdentity.OpenApprovedReadOnly(directory,"target.bin",current)))
        Check("single-link target accepted after link removal",restored.Result.File is not null &&
            restored.Result.Verdict.IdentityAndPreimageMatched);

    string child=Path.Combine(directory,"dir");Directory.CreateDirectory(child);
    File.WriteAllBytes(Path.Combine(child,"nested.bin"),[5,4,3,2]);
    ApprovedFilePin subpin=PinFromIndependentTestSetup(Path.Combine(child,"nested.bin"));
    using(G5OpenResultHolder parentPinned=new(HandleIdentity.OpenApprovedReadOnly(directory,"dir\\nested.bin",subpin)))
    {
        Check("nested target verified by retained parent and leaf handles",parentPinned.Result.File is not null &&
            parentPinned.Result.Verdict.IdentityAndPreimageMatched);
        bool blocked=false;
        try{Directory.Move(child,Path.Combine(directory,"dir-moved"));}
        catch(IOException){blocked=true;}
        Check("parent directory rename denied while its handle is pinned",blocked);
    }

    Console.WriteLine($"C9_G5_NATIVE_HANDLE_TESTS_PASS count={pass} NO_WRITE_HANDLE NO_COMMIT G5_HOLD PRODUCTION_NO_GO");
}
finally
{
    Directory.Delete(directory,recursive:true);
    Console.WriteLine("C9_G5_NATIVE_LAB_CLEANUP_PASS");
}

sealed class G5OpenResultHolder(G5OpenResult result):IDisposable
{
    public G5OpenResult Result {get;}=result;
    public void Dispose()=>Result.File?.Dispose();
}

internal static class TestNative
{
    [DllImport("kernel32.dll", EntryPoint="GetFileInformationByHandleEx", SetLastError=true, ExactSpelling=true)]
    internal static extern bool QueryId(SafeFileHandle file, int infoClass, IntPtr destination, uint length);
    [DllImport("kernel32.dll", EntryPoint="CreateHardLinkW", CharSet=CharSet.Unicode, SetLastError=true, ExactSpelling=true)]
    internal static extern bool CreateHardLink(string newName, string existingName, IntPtr security);
}
