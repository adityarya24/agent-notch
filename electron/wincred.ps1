param(
  [Parameter(Mandatory = $true)]
  [string]$Target
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class NotchCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr cred);
}
"@

[IntPtr]$ptr = [IntPtr]::Zero
if (-not [NotchCred]::CredRead($Target, 1, 0, [ref]$ptr)) {
  exit 2
}
try {
  $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][NotchCred+CREDENTIAL])
  $bytes = New-Object byte[] $cred.CredentialBlobSize
  [System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)
  $text = [System.Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
  [Console]::Out.Write($text)
} finally {
  [NotchCred]::CredFree($ptr)
}
