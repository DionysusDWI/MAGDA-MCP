import { removeOwnedTemp } from '../fixtures/temp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover, parseEndpoint, resolveDataDir, selectEndpoint } from '../../src/discovery/index.js';
const directories: string[] = [];
async function temporary() { const dir = await mkdtemp(join(tmpdir(), 'magda-discovery-')); directories.push(dir); return dir; }
afterEach(async () => { for (const dir of directories.splice(0)) await removeOwnedTemp(dir, 'magda-discovery-'); });
describe('MAGDA discovery', () => {
  it('respects explicit, environment, configured and OS directory precedence', async () => {
    const dir = await temporary(); const app = join(dir, 'MAGDA'); await mkdir(app);
    await writeFile(join(app, 'config.json'), JSON.stringify({ dataDir: join(dir, 'configured') }));
    const env = { APPDATA: dir, MAGDA_DATA_DIR: join(dir,'environment') };
    expect(await resolveDataDir({ dataDir: join(dir,'explicit'), env })).toBe(join(dir,'explicit'));
    expect(await resolveDataDir({ env })).toBe(env.MAGDA_DATA_DIR);
    expect(await resolveDataDir({ env: { APPDATA: dir } })).toBe(join(dir,'configured'));
    await writeFile(join(app, 'config.json'), '{}');
    expect(await resolveDataDir({ env: { APPDATA: dir } })).toBe(app);
  });
  it('accepts only literal loopback MCP endpoints, matching PID and port', () => {
    const good = { pid: 42, mcpUrl: 'http://127.0.0.1:1234/mcp', mcpPort: 1234, mcpToken: 'synthetic-token' };
    expect(parseEndpoint(good, 'remote-api-42.json', '.')).toMatchObject({ pid: 42 });
    for (const mcpUrl of ['http://evil.example:1234/mcp', 'http://localhost:1234/mcp', 'http://127.0.0.1:1234/elsewhere', 'http://user:secret@127.0.0.1:1234/mcp', 'http://127.0.0.1:1234/mcp?token=x', 'http://127.0.0.1:9999/mcp']) expect(() => parseEndpoint({ ...good, mcpUrl }, 'remote-api-42.json', '.')).toThrow();
    expect(() => parseEndpoint({ ...good, pid: 43 }, 'remote-api-42.json', '.')).toThrow();
    expect(parseEndpoint({ ...good, mcpToken: undefined, token: 'legacy-token' }, 'remote-api-42.json', '.')).toMatchObject({ token: 'legacy-token' });
  });
  it('reports malformed, stale and disabled records without leaking tokens', async () => {
    const dir = await temporary();
    await writeFile(join(dir, 'remote-api-12.json'), '{broken');
    await writeFile(join(dir, 'remote-api-13.json'), JSON.stringify({ pid: 13, mcpUrl: 'http://127.0.0.1:1000/mcp', mcpPort: 1000, mcpToken: 'PRIVATE_SYNTHETIC' }));
    await writeFile(join(dir, 'remote-api-14.json'), JSON.stringify({ pid: 14, url: 'ws://127.0.0.1:1001/rpc' }));
    const result = await discover({ dataDir: dir, alive: () => false });
    expect(result.endpoints).toEqual([]);
    expect(result.issues.map(x => x.code)).toEqual(['INVALID_RECORD', 'STALE_RECORD', 'MCP_DISABLED']);
    expect(JSON.stringify(result.issues)).not.toContain('PRIVATE_SYNTHETIC');
    expect(() => selectEndpoint(result)).toThrowError(/No MAGDA/);
  });
  it('requires explicit selection when multiple valid records exist', async () => {
    const dir = await temporary();
    for (const pid of [12,13]) await writeFile(join(dir,'remote-api-' + pid + '.json'), JSON.stringify({ pid, mcpUrl: 'http://127.0.0.1:1000/mcp', mcpPort: 1000, mcpToken: 'SYNTHETIC' }));
    const result = await discover({ dataDir: dir, alive: () => true });
    expect(() => selectEndpoint(result)).toThrowError(/Several/);
    expect(selectEndpoint(result,13).pid).toBe(13);
  });
  it('does not silently ignore malformed MAGDA configuration', async () => {
    const dir = await temporary(); await mkdir(join(dir,'MAGDA')); await writeFile(join(dir,'MAGDA','config.json'), '{');
    await expect(resolveDataDir({ env: { APPDATA: dir } })).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});
