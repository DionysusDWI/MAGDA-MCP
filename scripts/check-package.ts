import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { discover } from '../src/discovery/index.js';
import { removeOwnedTemp } from '../tests/fixtures/temp.js';
const exec = promisify(execFile);
const workspace = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { 'live-data-dir': { type: 'string' } } });
const npmCli = process.env.npm_execpath;
assert.ok(npmCli && isAbsolute(npmCli), 'Run this script with npm run check:package.');
const runNpm = async (args: string[], cwd = workspace) => exec(process.execPath, [npmCli, ...args], { cwd, windowsHide: true, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
const releaseDir = join(workspace, 'artifacts', 'release'); await mkdir(releaseDir, { recursive: true });
await runNpm(['run', 'build']);
const packed = await runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', releaseDir]);
const pack = (JSON.parse(packed.stdout) as { filename: string; files: { path: string }[] }[])[0]!;
const allowed = /^(dist\/|contracts\/magda\/0\.20\.2\/|docs\/usage\/|docs\/releases\/|package\.json$|README\.md$|THIRD_PARTY_NOTICES\.md$|LICENSE$|CHANGELOG\.md$)/;
for (const entry of pack.files) {
  assert.match(entry.path, allowed, 'Unexpected packed file: ' + entry.path);
  assert.ok(!entry.path.includes('..') && !/remote-api-\d+\.json/i.test(entry.path));
}
const tarball = join(releaseDir, pack.filename);
const compressed = await readFile(tarball); const archive = gunzipSync(compressed, { maxOutputLength: 20 * 1024 * 1024 });
const tokens = values['live-data-dir'] ? (await discover({ dataDir: values['live-data-dir'] })).endpoints.map(e => e.token) : [];
let entries = 0;
for (let offset = 0; offset + 512 <= archive.length;) {
  const header = archive.subarray(offset, offset + 512); if (header.every(b => b === 0)) break;
  const name = header.subarray(0, 100).toString().split('\0')[0]!;
  const size = parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8);
  assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= archive.length);
  if (header[156] === 48 || header[156] === 0) {
    assert.ok(name.startsWith('package/')); const text = archive.subarray(offset + 512, offset + 512 + size).toString('utf8');
    assert.ok(!text.toLowerCase().includes(workspace.toLowerCase()), 'Workspace path in ' + name);
    assert.ok(!text.includes('P:\\Literature_Lab') && !text.includes('P:/Literature_Lab'), 'Local research path in package');
    for (const token of tokens) assert.ok(!text.includes(token), 'Credential found in package');
    entries++;
  }
  offset += 512 + Math.ceil(size / 512) * 512;
}
assert.equal(entries, pack.files.length);
const directory = await mkdtemp(join(tmpdir(), 'magda-mcp-package-'));
const checks: Record<string, unknown>[] = [];
async function smoke(entry: string, dataDir: string, live: boolean) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry, 'serve', '--data-dir', dataDir], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += String(chunk); });
  const client = new Client({ name: 'package-acceptance', version: '0.1.0' });
  try {
    await client.connect(transport); assert.equal((await client.listTools()).tools.length, 156);
    const status = (await client.callTool({ name: 'magda_mcp.status', arguments: {} })).structuredContent as Record<string, unknown>;
    assert.equal(status.state, live ? 'connected' : 'offline');
    const native = await client.callTool({ name: 'tracks.list', arguments: {} }); assert.equal(native.isError, !live);
    if (live) assert.ok((await client.readResource({ uri: 'magda://tracks' })).contents.length);
    for (const token of tokens) assert.ok(!JSON.stringify(status).includes(token));
    assert.equal(stderr, ''); checks.push({ name: live ? 'installed-live-stdio' : 'installed-offline-stdio', passed: true, tools: 156, state: status.state });
  } finally { await client.close(); }
}
try {
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'magda-mcp-package-acceptance', private: true }));
  await runNpm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], directory);
  const entry = join(directory, 'node_modules', '@dionysusdwi', 'magda-mcp', 'dist', 'cli', 'index.js');
  const offline = join(directory, 'offline'); await mkdir(offline);
  await smoke(entry, offline, false);
  const configuration = JSON.parse((await exec(process.execPath, [entry, 'config'])).stdout) as { command: string; args: string[] };
  assert.equal(configuration.command, process.execPath); assert.equal(configuration.args[0], entry);
  checks.push({ name: 'installed-config-absolute-paths', passed: true });
  try { await exec(process.execPath, [entry, 'doctor', '--data-dir', offline, '--json']); assert.fail('Offline doctor must exit 1'); }
  catch (error) { assert.equal((error as { code: number }).code, 1); }
  try { await exec(process.execPath, [entry, 'serve', '--pid', 'no']); assert.fail('Invalid PID must exit 2'); }
  catch (error) { assert.equal((error as { code: number }).code, 2); }
  checks.push({ name: 'installed-cli-exit-codes', passed: true });
  if (values['live-data-dir']) await smoke(entry, resolve(values['live-data-dir']), true);
  const checksum = createHash('sha256').update(compressed).digest('hex');
  await writeFile(join(releaseDir, 'SHA256SUMS'), checksum + '  ' + pack.filename + '\n');
  const report = { version: '0.1.0', passed: true, completedAt: new Date().toISOString(), platform: process.platform + '-' + process.arch, node: process.version, tarball: pack.filename, sha256: checksum, files: entries, cleanInstallOutsideRepository: true, checks };
  await writeFile(join(releaseDir, 'package-acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await removeOwnedTemp(directory, 'magda-mcp-package-'); }
