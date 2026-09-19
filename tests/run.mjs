import { build } from 'esbuild';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'planko-tests-'));
try {
  const files = (await readdir('tests')).filter(name => name.endsWith('.test.ts')).sort();
  const outputs = [];
  for (const file of files) {
    const outfile = join(directory, file.replace(/\.ts$/, '.cjs'));
    await build({ entryPoints: [`tests/${file}`], outfile, bundle: true, platform: 'node', format: 'cjs', sourcemap: 'inline' });
    outputs.push(outfile);
  }
  const result = spawnSync(process.execPath, ['--enable-source-maps', '--test', ...process.argv.slice(2), ...outputs], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
