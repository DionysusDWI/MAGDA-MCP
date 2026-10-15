import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fingerprint, loadBaseline } from '../../src/contract.js';
import { businessMeta } from '../../src/proxy/server.js';
it('binds the live catalog to the survey and preserves discriminated JSON Schemas', async () => {
  const { catalog, verified } = await loadBaseline();
  const registry = await readFile(new URL('../../docs/research/magda-tool-registry.tsv', import.meta.url), 'utf8');
  const surveyed = registry.trim().split(/\r?\n/).slice(1).map(row => row.split('\t')[0]).sort();
  expect(verified).toBe(true);
  expect(catalog.tools.map(t => t.name).sort()).toEqual(surveyed);
  expect([catalog.tools.length,catalog.resources.length,catalog.resourceTemplates.length]).toEqual([154,8,4]);
  expect(catalog.tools.find(t => t.name === 'session.deleteScene')?.inputSchema.oneOf).toBeDefined();
  expect(catalog.tools.some(t => t.name.startsWith('subscriptions.'))).toBe(false);
  expect(fingerprint(catalog)).toBe(fingerprint({ ...catalog, tools: [...catalog.tools].reverse() }));
});
it('rebuilds protocol envelopes without losing vendor metadata', () => {
  expect(businessMeta({ 'io.modelcontextprotocol/protocolVersion': '2025-06-18', 'io.modelcontextprotocol/clientInfo': { name:'other' }, progressToken:123, 'com.conceptualmachines.magda/expectedRevision': 4, 'com.conceptualmachines.magda/requestId':'a', 'example/custom':false })).toEqual({ 'com.conceptualmachines.magda/expectedRevision':4, 'com.conceptualmachines.magda/requestId':'a', 'example/custom':false });
});
