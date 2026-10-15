import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export interface ProcessInfo { pid: number; executable: string; version: string | null; startedAt: string | null }
export type InspectProcess = (pid: number) => Promise<ProcessInfo | null>;
export const inspectWindowsProcess: InspectProcess = async (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0 || process.platform !== 'win32') return null;
  // A numeric argument is carried through the child environment, never shell interpolation.
  const command = "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; try { $p=Get-Process -Id ([int]$env:MAGDA_MCP_INSPECT_PID); $f=Get-Item -LiteralPath $p.Path; @{pid=$p.Id;executable=$p.Path;version=$f.VersionInfo.ProductVersion;startedAt=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress } catch { Write-Output 'null' }";
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, timeout: 5000, maxBuffer: 16384, encoding: 'utf8',
      env: { ...process.env, MAGDA_MCP_INSPECT_PID: String(pid) },
    });
    const data = JSON.parse(stdout.trim()) as ProcessInfo | null;
    if (!data || data.pid !== pid || typeof data.executable !== 'string') return null;
    if (!/(?:^|[\\/])MAGDA\.exe$/i.test(data.executable)) return null;
    return { ...data, version: typeof data.version === 'string' ? data.version.trim() : null };
  } catch { return null; }
};
export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
