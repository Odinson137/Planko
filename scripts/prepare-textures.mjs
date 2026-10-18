import sharp from 'sharp';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const directory = fileURLToPath(new URL('../public/textures/warehouse/', import.meta.url));
const output = join(directory, 'ready');
const sources = JSON.parse(await readFile(join(directory, 'sources.json'), 'utf8'));
await mkdir(output, { recursive: true });

// Match the former runtime resize and measured sheet crops. Originals stay untouched.
let originalBytes = 0;
let preparedBytes = 0;
for (const article of Object.keys(sources)) {
  for (const sheet of [false, true]) {
    const name = `${article}${sheet ? '-sheet' : ''}`;
    const input = join(directory, `${name}.jpg`);
    const destination = join(output, `${name}.webp`);
    let image = sharp(input);
    if (sheet) {
      const [left, top, right, bottom] = article === '8812-15'
        ? [1315, 827, 3587, 6045] : [1320, 839, 3594, 6041];
      image = image.extract({ left, top, width: right - left, height: bottom - top })
        .resize(Math.round((right - left) / (bottom - top) * 2048), 2048);
    } else {
      image = image.resize(2048, 2048, { fit: 'inside', withoutEnlargement: true });
    }
    await image.webp({ quality: 92, effort: 6 }).toFile(destination);
    originalBytes += (await stat(input)).size;
    preparedBytes += (await stat(destination)).size;
    console.log(`Prepared ${name}.webp`);
  }
}
console.log(`Textures: ${(originalBytes / 1e6).toFixed(2)} MB → ${(preparedBytes / 1e6).toFixed(2)} MB`);
