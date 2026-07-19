import { readdir } from 'node:fs/promises';
import path from 'node:path';

const staticDirectory = path.resolve('.next', 'standalone', '.next', 'static');
const files = await readdir(staticDirectory, { recursive: true });

if (!files.some((file) => file.endsWith('.css'))) {
  throw new Error('Standalone dashboard is missing generated CSS assets');
}
if (!files.some((file) => file.endsWith('.js'))) {
  throw new Error('Standalone dashboard is missing generated JavaScript assets');
}

console.log(`Verified standalone dashboard assets in ${path.relative(process.cwd(), staticDirectory)}.`);
