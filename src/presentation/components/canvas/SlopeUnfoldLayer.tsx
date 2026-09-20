import { Group, Rect, Text } from 'react-konva';
import type { CalculatedSlopePiece } from '../../../core/layout/LayoutEngine';
import type { Opening } from '../../../core/models/Opening';
import { getPieceTexture } from '../../../core/textures/PieceTextures';
import { slopeTexturePiece } from '../../../core/textures/TextureMapping';

export function SlopeUnfoldLayer({ opening, faces, zoom, textures }: { opening: Opening; faces: CalculatedSlopePiece[]; zoom: number; textures: boolean }) {
  return <Group listening={false}>{faces.filter(f => f.openingId === opening.id).map(face => {
    const vertical = face.side === 'LEFT' || face.side === 'RIGHT';
    const piece = slopeTexturePiece(face);
    const texture = textures && getPieceTexture(piece);
    const x = vertical ? face.side === 'LEFT' ? -face.depth : opening.width : face.startInset ?? 0;
    const y = vertical ? face.endInset ?? 0 : face.side === 'TOP' ? -face.depth : opening.height;
    // Konva accepts canvases as pattern sources; its public typing only names images.
    const fill = texture ? { fillPriority: 'pattern' as const, fillPatternImage: texture as unknown as HTMLImageElement,
      fillPatternScale: { x: piece.width / texture.width, y: piece.height / texture.height }, fillPatternRepeat: 'no-repeat' as const } : {};
    return <Group key={face.id} x={x} y={y}>
      <Rect width={piece.width} height={piece.height} fill={face.materialColor} {...fill}
        opacity={.85} stroke="#339af0" strokeWidth={1 / zoom} dash={[6, 4]} />
      <Text x={6} y={Math.max(4, piece.height / 2 - 10)}
        text={`${face.sideLabel}\n${piece.width.toLocaleString('ru-RU')} × ${piece.height.toLocaleString('ru-RU')} мм`}
        fontSize={Math.max(10, 12 / Math.max(.5, zoom))} fill="#e9ecef" fontFamily="Inter" />
    </Group>;
  })}</Group>;
}
