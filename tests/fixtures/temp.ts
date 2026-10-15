import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
export async function removeOwnedTemp(directory: string, prefix: string): Promise<void> {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith(prefix)) throw new Error('Refusing to delete an unowned temporary directory');
  await rm(target, { recursive: true, force: true });
}
