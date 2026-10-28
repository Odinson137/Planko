import sharp from 'sharp';
import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('Build the macOS application on a Mac (iconutil is required).');
}

const source = fileURLToPath(new URL('../public/planko.svg', import.meta.url));
const directory = fileURLToPath(new URL('../build/Planko.iconset/', import.meta.url));
const output = fileURLToPath(new URL('../build/Planko.icns', import.meta.url));
await mkdir(directory, { recursive: true });
try {
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      await sharp(source, { density: 1536 })
        .resize(size * scale, size * scale)
        .png()
        .toFile(`${directory}${name}`);
    }
  }
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', directory, '-o', output]);
  console.log(`macOS icon: ${output}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
