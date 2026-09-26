import { zipSync } from 'fflate';
import type { Material } from '../../core/models/Material';
import type { Wall } from '../../core/models/Wall';
import { savedWallViews, type WallCamera } from '../../core/models/WallView';
import { preloadPhotoTextures } from '../../core/textures/PhotoTextures';
import { prepareWall3DScene, renderWall3DScene, type Wall3DScene } from './Wall3DScene';

export function safeExportName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'Ракурс';
}

export function wallViewPngNames(wall: Wall): string[] {
  return savedWallViews(wall).map((view, index) =>
    `${String(index + 1).padStart(2, '0')}_${safeExportName(wall.name)}_${safeExportName(view.name)}.png`);
}

export function renderWallViewPng(scene: Wall3DScene, camera: WallCamera): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 2400; canvas.height = 1800;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Не удалось создать изображение ракурса.'));
  renderWall3DScene(ctx, scene, camera);
  return new Promise((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(new Error('Не удалось сохранить PNG.')), 'image/png'));
}

export async function createWallViewsZip(wall: Wall, materials: Material[], wallNumber = 1): Promise<Uint8Array> {
  const views = savedWallViews(wall);
  if (!views.length) throw new Error('Сначала сохраните хотя бы один ракурс.');
  await preloadPhotoTextures();
  const scene = prepareWall3DScene(wall, materials, wallNumber);
  const names = wallViewPngNames(wall);
  const files: Record<string, Uint8Array> = Object.create(null);
  for (let i = 0; i < views.length; i++) {
    const blob = await renderWallViewPng(scene, views[i]);
    files[names[i]] = new Uint8Array(await blob.arrayBuffer());
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  // PNG is already compressed; storing it avoids recompressing every image on the UI thread.
  return zipSync(files, { level: 0 });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
