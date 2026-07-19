import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const nextDirectory = path.resolve('.next');
const standaloneDirectory = path.join(nextDirectory, 'standalone');

await mkdir(path.join(standaloneDirectory, '.next'), { recursive: true });
await cp(path.join(nextDirectory, 'static'), path.join(standaloneDirectory, '.next', 'static'), { recursive: true });

try {
  if ((await stat('public')).isDirectory()) {
    await cp('public', path.join(standaloneDirectory, 'public'), { recursive: true });
  }
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
