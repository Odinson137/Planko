import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPhotoTexture, getPiecePhotoTexture, preloadPhotoTextures, TextureLoadProgress } from '../src/core/textures/PhotoTextures';

test('concurrent preload callers share work; one failed photo keeps its sheet and all other decors available', async () => {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const urls: string[] = [];
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  class FakeImage {
    src = '';
    width = 900;
    height = 2048;
    async decode() {
      urls.push(this.src);
      if (this.src.endsWith('/5007.webp')) throw new Error('A missing surface photo');
    }
  }
  const context = {
    drawImage() {}, fillRect() {}, scale() {}, translate() {}, transform() {},
  };
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: FakeImage });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  } });
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const first: TextureLoadProgress[] = [];
    const second: TextureLoadProgress[] = [];
    await Promise.all([
      preloadPhotoTextures(progress => first.push(progress)),
      preloadPhotoTextures(progress => second.push(progress)),
    ]);
    assert.equal(urls.length, 12, 'concurrent callers must not decode images twice');
    assert.equal(new Set(urls).size, 12);
    assert.equal(first[0].completed, 0);
    assert.deepEqual(first.map(progress => progress.completed), Array.from({ length: 13 }, (_, i) => i));
    assert.deepEqual(first.at(-1), { completed: 12, total: 12, failed: 1 });
    assert.deepEqual(second.at(-1), first.at(-1));
    assert.equal(warnings.length, 1);
    assert.equal(getPhotoTexture('WOOD', '5007'), undefined);
    assert.ok(getPhotoTexture('WOOD', '5189'));
    assert.ok(getPiecePhotoTexture({ width: 1220, height: 2800, textureCategory: 'WOOD', decorCode: '5007' }),
      'a failed surface preview must not prevent loading the independent sheet');

    const replay: TextureLoadProgress[] = [];
    await preloadPhotoTextures(progress => replay.push(progress));
    assert.deepEqual(replay, [{ completed: 12, total: 12, failed: 1 }]);
    assert.equal(urls.length, 12, 'exports reuse the completed preload');
  } finally {
    console.warn = originalWarn;
    if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage);
    else Reflect.deleteProperty(globalThis, 'Image');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
