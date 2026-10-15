import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GatewayError } from '../errors.js';
import { isProcessAlive } from '../platform/windows/process.js';
export interface DiscoveryOptions { dataDir?: string; env?: NodeJS.ProcessEnv; alive?: (pid: number) => boolean }
export interface Endpoint { pid: number; url: string; token: string; recordPath: string }
export interface DiscoveryIssue { record: string; code: 'INVALID_RECORD' | 'STALE_RECORD' | 'MCP_DISABLED' }
export interface DiscoveryResult { dataDir: string; endpoints: Endpoint[]; issues: DiscoveryIssue[] }
export async function resolveDataDir(options: DiscoveryOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const selected = options.dataDir ?? env.MAGDA_DATA_DIR;
  if (selected) return path.resolve(selected);
  const defaultDir = path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'MAGDA');
  const configFile = env.MAGDA_CONFIG_FILE ?? path.join(defaultDir, 'config.json');
  try {
    const contents = await readFile(configFile, 'utf8');
    const config: unknown = JSON.parse(contents.replace(/^\uFEFF/, ''));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('object expected');
    const configured = (config as Record<string, unknown>).dataDir;
    if (typeof configured === 'string' && configured.trim()) return path.resolve(configured);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new GatewayError('INVALID_CONFIG', 'MAGDA configuration is unreadable or malformed. Set --data-dir to the correct data directory.');
  }
  return defaultDir;
}
export function parseEndpoint(value: unknown, filename: string, directory: string): Endpoint | null {
  const match = /^remote-api-([1-9]\d*)\.json$/.exec(filename);
  if (!match || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid record');
  const record = value as Record<string, unknown>;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid) || record.pid !== pid) throw new Error('Invalid PID');
  if (record.mcpUrl === undefined && record.mcpPort === undefined) return null;
  if (typeof record.mcpUrl !== 'string' || typeof record.mcpPort !== 'number' || !Number.isSafeInteger(record.mcpPort) || record.mcpPort < 1 || record.mcpPort > 65535) throw new Error('Invalid MCP listener');
  const target = new URL(record.mcpUrl);
  if (target.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(target.hostname) || target.username || target.password || target.pathname !== '/mcp' || target.search || target.hash || Number(target.port || 80) !== record.mcpPort) throw new Error('Invalid MCP URL');
  const token = record.mcpToken ?? record.token;
  if (typeof token !== 'string' || !token || token.length > 8192 || /[\r\n]/.test(token)) throw new Error('Invalid token');
  return { pid, url: target.href, token, recordPath: path.join(directory, filename) };
}
export async function discover(options: DiscoveryOptions = {}): Promise<DiscoveryResult> {
  const dataDir = await resolveDataDir(options);
  const result: DiscoveryResult = { dataDir, endpoints: [], issues: [] };
  let names: string[];
  try { names = await readdir(dataDir); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw new GatewayError('INVALID_CONFIG', 'Cannot read the MAGDA data directory.');
  }
  for (const name of names.filter(n => /^remote-api-.*\.json$/.test(n)).sort()) {
    try {
      const file = path.join(dataDir, name);
      const info = await stat(file);
      if (!info.isFile() || info.size > 65536) throw new Error('Invalid record size');
      const value: unknown = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
      const endpoint = parseEndpoint(value, name, dataDir);
      if (!endpoint) { result.issues.push({ record: name, code: 'MCP_DISABLED' }); continue; }
      if (!(options.alive ?? isProcessAlive)(endpoint.pid)) { result.issues.push({ record: name, code: 'STALE_RECORD' }); continue; }
      result.endpoints.push(endpoint);
    } catch { result.issues.push({ record: name, code: 'INVALID_RECORD' }); }
  }
  return result;
}
export function selectEndpoint(result: DiscoveryResult, pid?: number): Endpoint {
  if (pid !== undefined) {
    const selected = result.endpoints.find(e => e.pid === pid);
    if (!selected) throw new GatewayError('NO_INSTANCE', 'The selected MAGDA process has no available MCP endpoint.');
    return selected;
  }
  if (!result.endpoints.length) throw new GatewayError('NO_INSTANCE', 'No MAGDA MCP instance is available. Start MAGDA and enable Settings → Connections → MCP.');
  if (result.endpoints.length > 1) throw new GatewayError('AMBIGUOUS_INSTANCE', 'Several MAGDA instances are available. Choose a PID with --pid or magda_mcp.reconnect.');
  return result.endpoints[0]!;
}
