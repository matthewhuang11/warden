import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'warden-package-'));

try {
  const packDirectory = path.join(temporaryRoot, 'pack');
  const installDirectory = path.join(temporaryRoot, 'install');
  await Promise.all([mkdir(packDirectory), mkdir(installDirectory)]);
  const { stdout: packOutput } = await execFileAsync(
    npm,
    ['pack', '--json', '--silent', '--pack-destination', packDirectory],
    { cwd: root, env: process.env },
  );
  const [manifest] = JSON.parse(packOutput);
  if (!manifest?.filename || !Array.isArray(manifest.files)) throw new Error('npm pack did not return a file manifest');

  const paths = manifest.files.map((file) => file.path);
  const requiredPaths = [
    'dist/cli.js',
    'dist/index.js',
    'dist/obfuscate/obfuscateCode.js',
    'dist/rehydrate/rehydrateText.js',
    'grammars/tree-sitter.wasm',
    'grammars/tree-sitter-typescript.wasm',
    'grammars/tree-sitter-tsx.wasm',
  ];
  for (const requiredPath of requiredPaths) {
    if (!paths.includes(requiredPath)) throw new Error(`Package is missing ${requiredPath}`);
  }

  const unexpectedPaths = paths.filter(
    (filePath) =>
      !['LICENSE', 'README.md', 'package.json'].includes(filePath) &&
      !/^dist\/.+\.js(?:\.map)?$/.test(filePath) &&
      !/^grammars\/tree-sitter(?:-typescript|-tsx)?\.wasm$/.test(filePath),
  );
  if (unexpectedPaths.length > 0) throw new Error(`Package contains unexpected files: ${unexpectedPaths.join(', ')}`);

  const tarballPath = path.join(packDirectory, manifest.filename);
  await execFileAsync(
    npm,
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarballPath],
    { cwd: installDirectory, env: process.env },
  );

  const binDirectory = path.join(installDirectory, 'node_modules', '.bin');
  const executableSuffix = process.platform === 'win32' ? '.cmd' : '';
  for (const binName of ['warden', 'warden-proxy']) {
    const { stdout } = await execFileAsync(path.join(binDirectory, `${binName}${executableSuffix}`), ['--help'], {
      cwd: installDirectory,
      env: process.env,
    });
    if (!stdout.includes('local proxy')) throw new Error(`${binName} --help did not execute the packaged CLI`);
  }

  const { stdout: statsOutput } = await execFileAsync(path.join(binDirectory, `warden${executableSuffix}`), ['stats'], {
    cwd: installDirectory,
    env: process.env,
  });
  if (!statsOutput.includes('Identifiers: 0')) throw new Error('Packaged stats command did not read an empty local audit log');

  const packageRoot = path.join(installDirectory, 'node_modules', 'warden-proxy');
  const smokeScript = `
    const { obfuscateCode } = await import(${JSON.stringify(pathToFileURL(path.join(packageRoot, 'dist/obfuscate/obfuscateCode.js')).href)});
    const { RenameMap } = await import(${JSON.stringify(pathToFileURL(path.join(packageRoot, 'dist/obfuscate/renameMap.js')).href)});
    const { rehydrateText } = await import(${JSON.stringify(pathToFileURL(path.join(packageRoot, 'dist/rehydrate/rehydrateText.js')).href)});
    const source = 'export function calculateConfidentialReserve(merchantBalance) { return merchantBalance * 0.2; }';
    const map = new RenameMap(100, 60_000, 'stealth', 0);
    const result = await obfuscateCode(source, map);
    if (!result.renamed || result.output.includes('calculateConfidentialReserve')) throw new Error('identifier was not protected');
    if (rehydrateText(result.output, map) !== source) throw new Error('response did not rehydrate exactly');
  `;
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', smokeScript], {
    cwd: installDirectory,
    env: process.env,
  });

  const installedPackage = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  console.log(`Verified ${installedPackage.name}@${installedPackage.version}: ${paths.length} files, both bins, stats, and obfuscation round-trip.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
