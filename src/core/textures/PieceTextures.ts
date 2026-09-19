import { getPiecePhotoTexture, renderPieceTexture } from './PhotoTextures';
import { TextureRegistry } from './TextureRegistry';
import { TexturedPiece } from './TextureMapping';

/** A schematic surface for materials whose sheet has not been photographed. */
export function getSchematicSheet(piece: TexturedPiece): HTMLCanvasElement {
  return TextureRegistry.getPatternCanvas(piece.textureCategory ?? 'SOLID', piece.materialColor ?? '#b8b8b8', 'FLAT');
}

export function getPieceTexture(piece: TexturedPiece): HTMLCanvasElement | undefined {
  const photo = getPiecePhotoTexture(piece);
  if (photo || !piece.textureMapping) return photo;
  return renderPieceTexture(piece, getSchematicSheet(piece), `schematic:${piece.materialColor ?? '#b8b8b8'}`);
}
