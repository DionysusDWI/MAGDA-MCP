import { describe, expect, it } from 'vitest';
import { Client, ProtocolError } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve } from 'node:path';
import { mockMagda } from '../fixtures/mock-magda.js';
const versions = ['2026-07-28','2025-11-25','2025-06-18'];
for (const upstream of versions) describe('upstream ' + upstream, () => {
  for (const downstream of versions) it('proxies every native tool and resources over stdio ' + downstream, async () => {
    const fixture = await mockMagda(upstream);
    const transport = new StdioClientTransport({ command: process.execPath, args: ['--import','tsx',resolve('tests/fixtures/gateway-child.ts'),fixture.directory,upstream], stderr:'pipe' });
    let stderr = ''; transport.stderr?.on('data', chunk => { stderr += String(chunk); });
    const client = new Client({ name: 'matrix-host', version:'0.1.0' }, { supportedProtocolVersions:[downstream], versionNegotiation:{ mode: downstream >= '2026-07-28' ? { pin: downstream } : 'legacy' } });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.filter(t => !t.name.startsWith('magda_mcp.'))).toEqual(fixture.options.baseline.catalog.tools);
      expect(tools.tools).toHaveLength(156);
      for (const tool of fixture.options.baseline.catalog.tools) {
        const result = await client.request({ method:'tools/call', params:{ name:tool.name, arguments:{ opaque: ['keep',{value:0}] }, _meta:{ 'com.conceptualmachines.magda/expectedRevision':41, 'com.conceptualmachines.magda/requestId':upstream + ':' + downstream + ':' + tool.name, 'example/opaque':{ keep:true } } } });
        expect(result.isError).not.toBe(true);
        if (tool.name !== 'system.describe') {
          expect(result.structuredContent).toMatchObject({ native:tool.name, arguments:{opaque:['keep',{value:0}]} });
          expect(result._meta).toMatchObject({ 'com.conceptualmachines.magda/revision':42, 'com.example/opaque':{keep:true} });
        }
      }
      expect(fixture.calls).toHaveLength(153);
      expect(fixture.calls.every(c => (c.meta as Record<string,unknown>)['example/opaque'] !== undefined)).toBe(true);
      expect(fixture.calls.at(-1)?.meta).toMatchObject({ 'com.conceptualmachines.magda/expectedRevision':41 });
      const status = await client.callTool({name:'magda_mcp.status',arguments:{}});
      expect(status.structuredContent).toMatchObject({ state:'connected',identity:'MAGDA-MCP/matrix-host' });
      expect((await client.listResources()).resources).toHaveLength(8);
      expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(4);
      expect((await client.readResource({uri:'magda://tracks'})).contents[0]).toMatchObject({text:'[]'});
      await expect(client.callTool({name:'does.notExist',arguments:{}})).rejects.toBeInstanceOf(ProtocolError);
      let received!: () => void;
      const notification = new Promise<void>(resolve => { received = resolve; });
      client.setNotificationHandler('notifications/resources/updated', n => { if (n.params.uri === 'magda://tracks') received(); });
      const sub = downstream >= '2026-07-28' ? await client.listen({ resourceSubscriptions: ['magda://tracks'] }) : undefined;
      if (!sub) await client.subscribeResource({ uri:'magda://tracks' });
      else expect(sub.honoredFilter.resourceSubscriptions).toEqual(['magda://tracks']);
      await client.request({ method:'tools/call',params:{name:'tracks.update',arguments:{}} });
      let timer: NodeJS.Timeout | undefined;
      try { await Promise.race([notification,new Promise((_,reject)=>{ timer=setTimeout(()=>reject(new Error('Resource notification missing')),3000); })]); }
      finally { if(timer) clearTimeout(timer); }
      if (sub) await sub.close(); else await client.unsubscribeResource({uri:'magda://tracks'});
      expect(stderr).toBe('');
    } finally { await client.close(); await fixture.close(); }
  });
});
