#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { discover } from '../discovery/index.js';
import { Gateway } from '../connection/gateway.js';
import { loadBaseline } from '../contract.js';
import { startStdio } from '../proxy/stdio.js';
import { asGatewayError } from '../errors.js';
import { VERSION } from '../constants.js';
export async function main(argv = process.argv.slice(2)): Promise<void> {
  let parsed;
  try { parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, options: { pid: { type: 'string' }, 'data-dir': { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } } }); }
  catch { process.stderr.write('Invalid arguments. Run magda-mcp-server --help.\n'); process.exitCode = 2; return; }
  const { values, positionals } = parsed;
  if (values.version) { console.log(VERSION); return; }
  if (values.help) {
    console.log('MAGDA-MCP ' + VERSION + '\n\nUsage: magda-mcp-server [serve|instances|doctor|config] [--pid N] [--data-dir PATH] [--json]\n\nRequires Windows x64, Node.js 24+, MAGDA 0.20.2. Enable MCP in MAGDA Connections.\nserve is the default; stdout is reserved for MCP. doctor exits 0 when ready, 1 when not ready, 2 for invalid arguments.'); return;
  }
  const command = positionals[0] ?? 'serve';
  const pid = values.pid === undefined ? undefined : Number(values.pid);
  if (positionals.length > 1 || !['serve', 'instances', 'doctor', 'config'].includes(command) || (values.pid !== undefined && (!/^\d+$/.test(values.pid) || !Number.isSafeInteger(pid) || pid! <= 0))) {
    process.stderr.write('Invalid command or PID. Run magda-mcp-server --help.\n'); process.exitCode = 2; return;
  }
  const options = { ...(values['data-dir'] ? { dataDir: values['data-dir'] } : {}), ...(pid !== undefined ? { pid } : {}) };
  if (command === 'config') {
    console.log(JSON.stringify({ command: process.execPath, args: [fileURLToPath(import.meta.url), 'serve', ...(options.dataDir ? ['--data-dir', options.dataDir] : []), ...(pid !== undefined ? ['--pid', String(pid)] : [])] }, null, 2)); return;
  }
  if (command === 'instances') {
    try { const result = await discover(options); console.log(JSON.stringify({ dataDir: result.dataDir, instances: result.endpoints.map(e => ({ pid: e.pid, url: e.url })), issues: result.issues }, null, 2)); }
    catch (error) { console.log(JSON.stringify({ error: asGatewayError(error).toJSON() })); process.exitCode = 1; } return;
  }
  if (process.platform !== 'win32' || process.arch !== 'x64') { process.stderr.write('MAGDA-MCP 0.1.0 supports Windows x64.\n'); process.exitCode = 1; return; }
  const baseline = await loadBaseline();
  if (command === 'doctor') {
    const gateway = new Gateway({ ...options, baseline }); gateway.setHostName('doctor');
    try { const status = await gateway.status(); console.log(JSON.stringify(status, null, 2)); process.exitCode = status.state === 'connected' ? 0 : 1; }
    finally { await gateway.close(); } return;
  }
  const handle = startStdio({ ...options, baseline });
  let closing = false;
  const close = () => { if (closing) return; closing = true; void handle.close().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch(() => { process.stderr.write('[MAGDA-MCP] Startup failed. Reinstall the package or run doctor.\n'); process.exitCode = 1; });
}
