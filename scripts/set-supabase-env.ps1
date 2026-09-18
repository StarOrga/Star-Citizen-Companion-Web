# set-supabase-env.ps1 — copy the Supabase CLI personal access token from the
# Windows Credential Manager (target "Supabase CLI:supabase", written by
# `supabase login`) into the USER environment variable SUPABASE_ACCESS_TOKEN,
# which .mcp.json sends as the Supabase MCP bearer and scripts/routine-gate.mjs
# uses for the Management API. Prints only length + prefix — never the token.
# Restart the Claude Desktop app afterwards (env vars are read at process start).
#
#   powershell -ExecutionPolicy Bypass -File scripts/set-supabase-env.ps1
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class CredMan {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string target, uint type, uint flags, out IntPtr cred);
}
"@
$p = [IntPtr]::Zero
if (-not [CredMan]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$p)) { Write-Output "credential not found — run 'supabase login' first"; exit 3 }
$c = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][CredMan+CREDENTIAL])
$b = New-Object byte[] $c.CredentialBlobSize
[Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $b, 0, $c.CredentialBlobSize)
$t = [Text.Encoding]::UTF8.GetString($b).Trim()
if ($t.Length -lt 40 -or -not $t.StartsWith('sbp_')) { Write-Output ("unexpected token shape: len=" + $t.Length); exit 4 }
[Environment]::SetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', $t, 'User')
$check = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
Write-Output ("user env var set: len=" + $check.Length + " prefix=" + $check.Substring(0, 4))
