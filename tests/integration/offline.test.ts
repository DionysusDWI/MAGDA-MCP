import { expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { removeOwnedTemp } from '../fixtures/temp.js';
it('the actual CLI starts offline, advertises the verified catalog and returns actionable tool errors',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'magda-offline-'));
  const transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/cli/index.js'),'serve','--data-dir',directory],stderr:'pipe'});
  let stderr='';transport.stderr?.on('data',chunk=>{stderr+=String(chunk);});
  const client=new Client({name:'offline-host',version:'1.0'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
  try{
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(156);
    expect((await client.callTool({name:'magda_mcp.status',arguments:{}})).structuredContent).toMatchObject({state:'offline',catalogSource:'baseline',boundPid:null});
    const result=await client.callTool({name:'tracks.create',arguments:{name:'test'}});
    expect(result.isError).toBe(true);expect(result.structuredContent).toBeUndefined();expect(JSON.stringify(result)).toContain('NO_INSTANCE');
    expect(stderr).toBe('');
  }finally{await client.close();await removeOwnedTemp(directory,'magda-offline-');}
});
