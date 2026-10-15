import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Tool, Resource, ResourceTemplateType } from '@modelcontextprotocol/server';
export interface Catalog { tools: Tool[]; resources: Resource[]; resourceTemplates: ResourceTemplateType[] }
export interface Baseline { catalog: Catalog; apiVersion: string; verified: boolean; fingerprint: string }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function fingerprint(catalog: Catalog): string {
  const sorted = {
    tools: [...catalog.tools].sort((a,b) => a.name.localeCompare(b.name, 'en')),
    resources: [...catalog.resources].sort((a,b) => a.uri.localeCompare(b.uri, 'en')),
    resourceTemplates: [...catalog.resourceTemplates].sort((a,b) => a.uriTemplate.localeCompare(b.uriTemplate, 'en')),
  };
  return createHash('sha256').update(canonical(sorted)).digest('hex');
}
export async function loadBaseline(): Promise<Baseline> {
  const dir = new URL('../contracts/magda/0.20.2/', import.meta.url);
  const bytes = await readFile(new URL('catalog.json', dir), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8')) as { apiVersion: string; verified: boolean; catalogSha256: string };
  if (createHash('sha256').update(bytes).digest('hex') !== manifest.catalogSha256 || !manifest.verified) throw new Error('The packaged MAGDA contract is missing or damaged. Reinstall MAGDA-MCP.');
  const catalog = JSON.parse(bytes) as Catalog;
  return { catalog, apiVersion: manifest.apiVersion, verified: manifest.verified, fingerprint: fingerprint(catalog) };
}
