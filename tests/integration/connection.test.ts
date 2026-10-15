import { expect, it } from 'vitest';
import { fingerprint } from '../../src/contract.js';
import { Gateway } from '../../src/connection/gateway.js';
import { mockMagda } from '../fixtures/mock-magda.js';
async function until(predicate: () => boolean) { for (let i=0;i<100;i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve,10)); } throw new Error('Condition was never reached'); }
it('survives same-process credential rotation and never silently selects another instance', async () => {
  const fixture = await mockMagda(); const gateway = new Gateway(fixture.options); gateway.setHostName('rotation');
  try {
    expect((await gateway.status()).state).toBe('connected');
    await fixture.rotate();
    expect((await gateway.callTool('tracks.list',{})).isError).not.toBe(true);
    const safe = JSON.stringify(await gateway.status()); expect(safe).not.toContain(fixture.token());
    fixture.stopIdentity();
    await expect(gateway.callTool('tracks.list',{})).rejects.toMatchObject({code:'INSTANCE_EXITED'});
    await expect(gateway.callTool('tracks.list',{})).rejects.toMatchObject({code:'INSTANCE_EXITED'});
  } finally { await gateway.close(); await fixture.close(); }
});
it('blocks mutations with unverified versions but keeps reads and diagnosis available', async () => {
  const fixture = await mockMagda(); const gateway = new Gateway({...fixture.options,inspectProcess:async pid => ({pid,executable:'unknown',version:'0.21.0',startedAt:null})});
  try {
    expect((await gateway.status()).state).toBe('incompatible');
    await gateway.callTool('tracks.list',{});
    await expect(gateway.callTool('tracks.create',{})).rejects.toMatchObject({code:'UNSUPPORTED_VERSION'});
    expect(fixture.calls.map(c=>c.name)).toEqual(['tracks.list']);
  } finally { await gateway.close(); await fixture.close(); }
});
it('refuses reconnect during native calls and marks a timed-out mutation as unknown without replay', async () => {
  const fixture=await mockMagda(); const gateway=new Gateway({...fixture.options,requestTimeoutMs:100});
  try {
    await gateway.ensureConnected(); fixture.setBehavior('hang');
    const pending=gateway.callTool('tracks.create',{});
    const failure=expect(pending).rejects.toMatchObject({code:'OUTCOME_UNKNOWN',outcome:'unknown'});
    await until(()=>fixture.calls.length===1);
    await expect(gateway.reconnect()).rejects.toMatchObject({code:'BUSY'});
    await failure; fixture.release();
    expect(fixture.calls).toHaveLength(1);
  } finally { await gateway.close(); await fixture.close(); }
});
it('preserves tool-execution errors separately from protocol failures', async () => {
  const fixture=await mockMagda(); const gateway=new Gateway(fixture.options);
  try {
    await gateway.ensureConnected(); fixture.setBehavior('businessError');
    const result=await gateway.callTool('tracks.create',{});
    expect(result.isError).toBe(true); expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toMatchObject({text:'{"error":{"code":"permission_denied","requiredScope":"edit"}}'});
    fixture.setBehavior('protocolError');
    await expect(gateway.callTool('tracks.create',{})).rejects.toMatchObject({code:-32602,data:{nativeCode:'invalid_params'}});
    expect(fixture.calls).toHaveLength(2);
  } finally { await gateway.close(); await fixture.close(); }
});

it('blocks changes after contract drift even when the application version matches', async () => {
  const fixture=await mockMagda();
  const altered=structuredClone(fixture.options.baseline.catalog);
  altered.tools[0]!.inputSchema.additionalProperties=true;
  const gateway=new Gateway({...fixture.options,baseline:{...fixture.options.baseline,catalog:altered,fingerprint:fingerprint(altered)}});
  try{
    expect((await gateway.status()).state).toBe('incompatible');
    await gateway.callTool('tracks.list',{});
    await expect(gateway.callTool('tracks.create',{})).rejects.toMatchObject({code:'CONTRACT_MISMATCH'});
    expect(fixture.calls).toHaveLength(1);
  }finally{await gateway.close();await fixture.close();}
});

it('preserves correlated HTTP admission errors without classifying them as unknown mutations', async () => {
  const fixture = await mockMagda(); const gateway = new Gateway(fixture.options);
  try {
    await gateway.ensureConnected(); fixture.setBehavior('httpError');
    await expect(gateway.callTool('tracks.create', {})).rejects.toMatchObject({ code: -32600, message: expect.stringContaining('Rate limit'), data: { httpStatus: 429 } });
    expect(fixture.calls).toHaveLength(0);
  } finally { await gateway.close(); await fixture.close(); }
});

it('requires and accepts explicit reconnect after an exited binding', async () => {
  const fixture = await mockMagda(); const gateway = new Gateway(fixture.options);
  try {
    await gateway.ensureConnected(); fixture.stopIdentity();
    await expect(gateway.callTool('tracks.list', {})).rejects.toMatchObject({ code: 'INSTANCE_EXITED' });
    fixture.resumeIdentity();
    await expect(gateway.callTool('tracks.list', {})).rejects.toMatchObject({ code: 'INSTANCE_EXITED' });
    expect((await gateway.reconnect(fixture.pid)).state).toBe('connected');
    await gateway.callTool('tracks.list', {}); expect(fixture.calls).toHaveLength(1);
  } finally { await gateway.close(); await fixture.close(); }
});
for (const version of ['2026-07-28', '2025-06-18']) it('restores subscriptions and invalidates cached resources after token rotation on ' + version, async () => {
  const fixture = await mockMagda(version); const gateway = new Gateway(fixture.options);
  try {
    await gateway.setSubscriptions('retained', ['magda://tracks']);
    const invalidations: string[] = []; gateway.on('resourceUpdated', (n: { uri: string }) => invalidations.push(n.uri));
    await fixture.rotate(); await gateway.callTool('tracks.list', {});
    expect(invalidations).toContain('magda://tracks');
    await gateway.removeSubscriptions('retained');
  } finally { await gateway.close(); await fixture.close(); }
});
it('does not send an already cancelled mutation and never replays one cancelled after dispatch', async () => {
  const fixture = await mockMagda(); const gateway = new Gateway(fixture.options);
  try {
    const before = new AbortController(); before.abort();
    await expect(gateway.callTool('tracks.create', {}, undefined, { signal: before.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fixture.calls).toHaveLength(0);
    fixture.setBehavior('hang'); const after = new AbortController();
    const pending = gateway.callTool('tracks.create', {}, undefined, { signal: after.signal });
    const failure = expect(pending).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await until(() => fixture.calls.length === 1); after.abort(); await failure; fixture.release();
    expect(fixture.calls).toHaveLength(1);
  } finally { await gateway.close(); await fixture.close(); }
});
