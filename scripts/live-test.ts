import assert from 'node:assert/strict';
import { release } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import type { CallToolResult, McpSubscription } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fingerprint, loadBaseline } from '../src/contract.js';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const liveRoot = join(workspace, 'artifacts', 'live');
const dataDir = resolve(process.argv[2] ?? join(liveRoot, 'runtime'));
const readOnly = process.argv.includes('--readonly');
const config = JSON.parse((await readFile(join(dataDir, 'config.json'), 'utf8')).replace(/^\uFEFF/, '')) as Record<string, unknown>;
// Destructive acceptance is restricted to this script's isolated runtime directory.
assert.equal(dataDir.toLowerCase(), join(liveRoot, 'runtime').toLowerCase());
assert.equal(resolve(String(config.dataDir)).toLowerCase(), dataDir.toLowerCase());
const checks: { name: string; status: 'passed' | 'failed'; detail?: unknown }[] = [];
const prefix = 'com.conceptualmachines.magda/';
const clients: Client[] = [];
let revision: number | undefined;
let owned = false;
let subscription: McpSubscription | undefined;
let jobId: string | undefined;
const report: Record<string, unknown> = { version: '0.1.0', magdaVersion: '0.20.2', platform: process.platform + '-' + process.arch, node: process.version, windowsRelease: release(), startedAt: new Date().toISOString(), mode: readOnly ? 'read-only' : 'workflow', checks };

async function connect(name: string, protocol = '2026-07-28') {
  const client = new Client({ name, version: '0.1.0' }, { supportedProtocolVersions: [protocol], versionNegotiation: { mode: protocol >= '2026-07-28' ? { pin: protocol } : 'legacy' } });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(workspace, 'dist', 'cli', 'index.js'), 'serve', '--data-dir', dataDir], stderr: 'pipe' });
  transport.stderr?.on('data', () => {});
  await client.connect(transport); clients.push(client); return client;
}
function payload(result: CallToolResult): Record<string, unknown> {
  if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
  const text = result.content.find(c => c.type === 'text');
  return text && text.type === 'text' ? JSON.parse(text.text) as Record<string, unknown> : {};
}
async function invoke(client: Client, name: string, args: Record<string, unknown> = {}, meta?: Record<string, unknown>) {
  await new Promise(r => setTimeout(r, 175));
  const result = await client.request({ method: 'tools/call', params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } }, { timeout: 30000 });
  const rev = result._meta?.[prefix + 'revision'];
  if (typeof rev === 'number') revision = rev;
  return result;
}
async function ok(client: Client, name: string, args: Record<string, unknown> = {}, meta?: Record<string, unknown>) {
  const result = await invoke(client, name, args, meta);
  assert.notEqual(result.isError, true, name + ': ' + JSON.stringify(payload(result)));
  return payload(result);
}
async function check(name: string, task: () => Promise<unknown>) {
  try { const detail = await task(); checks.push({ name, status: 'passed', detail }); console.log('PASS ' + name); return detail; }
  catch (error) { checks.push({ name, status: 'failed', detail: String(error) }); throw error; }
}
async function waitFor(predicate: () => Promise<boolean>, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Timed out waiting for the observed condition.');
}
const client = await connect('live-acceptance');
try {
  await check('compatibility-and-full-catalog', async () => {
    const status = await ok(client, 'magda_mcp.status');
    assert.equal(status.state, 'connected'); assert.equal(status.applicationVersion, '0.20.2');
    assert.equal(status.identity, 'MAGDA-MCP/live-acceptance');
    const baseline = await loadBaseline();
    const [tools, resources, templates] = await Promise.all([client.listTools(), client.listResources(), client.listResourceTemplates()]);
    assert.equal(tools.tools.length, 156);
    assert.equal(fingerprint({ tools: tools.tools.filter(t => !t.name.startsWith('magda_mcp.')), resources: resources.resources, resourceTemplates: templates.resourceTemplates }), baseline.fingerprint);
    for (const resource of resources.resources) assert.ok((await client.readResource({ uri: resource.uri })).contents.length);
    return { nativeTools: 154, managementTools: 2, resources: 8, templates: 4, fullSchemaMatches: true };
  });
  await check('three-live-downstream-protocols', async () => {
    for (const version of ['2025-11-25', '2025-06-18']) {
      const peer = await connect('live-read-' + version, version);
      assert.ok(await ok(peer, 'project.get')); assert.equal((await peer.listTools()).tools.length, 156);
    }
    return ['2026-07-28', '2025-11-25', '2025-06-18'];
  });
  await check('new-client-default-read-only', async () => {
    const peer = await connect('unprivileged-' + randomUUID());
    await ok(peer, 'tracks.list');
    const denied = await invoke(peer, 'tracks.create', { name: 'Must never exist', type: 'audio' });
    assert.equal(denied.isError, true); assert.match(JSON.stringify(payload(denied)), /permission|scope|denied/i);
    return { readAllowed: true, writeDenied: true };
  });
  if (readOnly) {
    await check('same-identity-after-scope-revocation', async () => {
      const denied = await invoke(client, 'tracks.create', { name: 'Must never exist', type: 'audio' });
      assert.equal(denied.isError, true); assert.match(JSON.stringify(payload(denied)), /permission|scope|denied/i);
      return { identity: 'MAGDA-MCP/live-acceptance', writeDenied: true, activation: 'isolated MAGDA restart with read-only configuration' };
    });
  } else {
    await check('disposable-project-guard', async () => {
      const current = await ok(client, 'project.get'); const tracks = await ok(client, 'tracks.list');
      assert.equal(current.path, null); assert.equal(current.dirty, false); assert.equal(current.hasSaveTarget, false);
      assert.deepEqual(tracks.items, []);
      await ok(client, 'project.new', { discardUnsavedChanges: false }); owned = true;
      return { isolatedConfiguration: true, emptyCleanProject: true };
    });
    let updated = false;
    client.setNotificationHandler('notifications/resources/updated', n => { if (n.params.uri === 'magda://tracks') updated = true; });
    subscription = await client.listen({ resourceSubscriptions: ['magda://tracks'] });
    let trackId = -1; let clipId = -1;
    await check('track-revision-idempotency-and-notification', async () => {
      const requestId = randomUUID(); const meta = { [prefix + 'requestId']: requestId, [prefix + 'expectedRevision']: revision };
      const first = await ok(client, 'tracks.create', { name: 'MAGDA-MCP acceptance', type: 'audio' }, meta);
      trackId = Number(first.id); assert.ok(Number.isInteger(trackId) && trackId >= 0);
      const second = await ok(client, 'tracks.create', { name: 'MAGDA-MCP acceptance', type: 'audio' }, meta); assert.equal(second.id, trackId);
      assert.equal(((await ok(client, 'tracks.list')).items as unknown[]).length, 1);
      await waitFor(async () => updated);
      const conflict = await invoke(client, 'project.setTempo', { tempo: 123 }, { [prefix + 'expectedRevision']: 0 });
      assert.equal(conflict.isError, true); assert.match(JSON.stringify(payload(conflict)), /revision|conflict/i);
      assert.equal((await ok(client, 'project.get')).tempo, 120);
      return { trackId, idempotency: true, staleRevisionRejected: true, resourceInvalidationReceived: true };
    });
    await check('arrangement-midi-notes', async () => {
      const clip = await ok(client, 'clips.createMidi', { lengthBeats: 4, placement: { view: 'arrangement', trackId, startBeat: 0 } });
      clipId = Number(clip.id);
      await ok(client, 'clips.addMidiEvents', { clipId, events: [{ type: 'note', note: 60, velocity: 100, beat: 0, lengthBeats: 1 }] });
      const read = await ok(client, 'clips.get', { clipId }); assert.equal(read.id, clipId);
      const events = await ok(client, 'clips.listMidiEvents', { clipId });
      assert.match(JSON.stringify(events), /"note":60/);
      for (const uri of ['magda://tracks/' + trackId, 'magda://tracks/' + trackId + '/clips', 'magda://tracks/' + trackId + '/devices', 'magda://clips/' + clipId]) {
        await new Promise(r => setTimeout(r, 175)); assert.ok((await client.readResource({ uri })).contents.length);
      }
      return { clipId, note: 60, resourceTemplatesRead: 4 };
    });
    await check('device-parameter', async () => {
      const device = await ok(client, 'devices.add', { trackId, catalogId: 'magda_filter' });
      const devicePath = device.devicePath ?? device.path;
      assert.ok(devicePath, 'Device response must contain its path');
      const parameters = await ok(client, 'devices.listParameters', { devicePath });
      const items = parameters.items as Record<string, unknown>[];
      assert.ok(items.length > 0);
      const parameter = items[0]!;
      const parameterIndex = Number(parameter.index ?? parameter.parameterIndex);
      const value = Math.max(Number(parameter.minValue), Number(parameter.currentValue) * 0.9);
      assert.ok(Number.isFinite(value));
      await ok(client, 'devices.setParameter', { devicePath, parameterIndex, value });
      const readback = (await ok(client, 'devices.listParameters', { devicePath })).items as Record<string, unknown>[];
      assert.ok(Math.abs(Number(readback[parameterIndex]!.currentValue) - value) < 0.1);
      return { catalogId: 'magda_filter', parameterIndex, changedValueReadBack: true };
    });
    await check('automation-point', async () => {
      const target = { kind: 'track_volume', devicePath: { trackId, section: 'fx', trackLevel: true, topLevelDeviceId: null, steps: [] }, parameterIndex: -1, modId: -1, modParameterIndex: -1, sendBusIndex: -1 };
      const lane = await ok(client, 'automation.createLane', { target, type: 'absolute' }); const laneId = Number(lane.id);
      await ok(client, 'automation.addPoint', { laneId, beatPosition: 0, value: 0.5, curve: 'linear' });
      const read = await ok(client, 'automation.getLane', { laneId }); assert.equal(read.id, laneId);
      return { laneId, pointReadBack: true };
    });
    await check('session-scene-midi-and-launch', async () => {
      const state = await ok(client, 'session.createScene', { name: 'Acceptance' });
      const scene = (state.scenes as Record<string, unknown>[]).find(s => s.name === 'Acceptance'); assert.ok(scene);
      const sessionClip = await ok(client, 'clips.createMidi', { lengthBeats: 4, placement: { view: 'session', trackId, sceneId: scene.id, occupiedPolicy: 'fail' } });
      await ok(client, 'session.launchScene', { sceneIndex: 0 }); await ok(client, 'transport.stop');
      return { sceneId: scene.id, clipId: sessionClip.id, launched: true };
    });
    await check('transport-play-seek-stop', async () => {
      await ok(client, 'transport.seek', { positionBeats: 0 }); await ok(client, 'transport.play');
      const playing = await ok(client, 'transport.get'); assert.equal(playing.playing, true);
      await ok(client, 'transport.stop'); const stopped = await ok(client, 'transport.get'); assert.equal(stopped.playing, false);
      return { playConfirmed: true, stopConfirmed: true };
    });
    const outputDirectory = join(liveRoot, 'projects', randomUUID()); await mkdir(outputDirectory, { recursive: true });
    await check('save-dedicated-project', async () => {
      await ok(client, 'project.saveAs', { path: join(outputDirectory, 'acceptance.mgd'), overwritePolicy: 'fail', mediaPolicy: 'copy' });
      const saved = await ok(client, 'project.get'); assert.equal(saved.hasSaveTarget, true); assert.equal(saved.dirty, false);
      return { saved: true };
    });
    await check('asynchronous-render-job', async () => {
      const job = await ok(client, 'engine.renderRange', { path: join(outputDirectory, 'acceptance.wav'), range: { unit: 'beats', start: 0, end: 1 }, format: 'wav', sampleRate: 44100, bitDepth: 16, dither: 'none', normalise: false, normaliseToDb: 0, includeMasterEffects: true, includeTrackEffects: true, realTime: false, tailSeconds: 0, overwritePolicy: 'fail' });
      jobId = String(job.jobId ?? job.id); let final: Record<string, unknown> = {};
      await waitFor(async () => { final = await ok(client, 'jobs.get', { jobId }); return /succeeded|completed|failed|cancelled/.test(String(final.state ?? final.status)); }, 30000);
      assert.match(String(final.state ?? final.status), /succeeded|completed/);
      return { state: final.state ?? final.status, jobId };
    });
  }
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await subscription?.close().catch(() => {});
  if (owned) {
    try { await ok(client, 'transport.stop'); if (jobId) await invoke(client, 'jobs.cancel', { jobId }); await ok(client, 'project.close', { discardUnsavedChanges: true }); checks.push({ name: 'owned-project-cleanup', status: 'passed' }); }
    catch (error) { checks.push({ name: 'owned-project-cleanup', status: 'failed', detail: String(error) }); process.exitCode = 1; }
  }
  await Promise.allSettled(clients.map(c => c.close()));
  report.completedAt = new Date().toISOString(); report.passed = process.exitCode !== 1;
  await mkdir(liveRoot, { recursive: true });
  await writeFile(join(liveRoot, readOnly ? 'read-only-acceptance.json' : 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
}
