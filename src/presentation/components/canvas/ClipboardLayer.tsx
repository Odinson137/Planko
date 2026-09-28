import React from 'react';
import { Layer, Rect, Line, Text } from 'react-konva';
import { useClipboardStore } from '../../../application/stores/useClipboardStore';

export const ClipboardLayer: React.FC<{ width: number; height: number; wallHeight: number; zoom: number; panX: number; panY: number }> = props => {
  const { width, height, wallHeight, zoom, panX, panY } = props;
  const clipboard = useClipboardStore();
  const preview = clipboard.preview;
  if (!preview) return null;
  const color = clipboard.error ? '#fa5252' : '#228be6';
  return <Layer>
    <Rect x={-panX / zoom} y={-panY / zoom} width={width / zoom} height={height / zoom} fill="rgba(0,0,0,0)"
      onMouseMove={event => {
        const point = event.target.getStage()?.getPointerPosition();
        if (point) clipboard.move({ x: (point.x - panX) / zoom, y: wallHeight - (point.y - panY) / zoom - preview.bounds.height }, event.evt.altKey);
      }}
      onClick={event => { event.cancelBubble = true; if (event.evt.button === 0) clipboard.place(); }} />
    {preview.kind === 'openings' ? preview.openings.map(op => <Rect key={op.id} x={op.x} y={wallHeight - op.y - op.height}
      width={op.width} height={op.height} stroke={color} strokeWidth={2 / zoom} fill={clipboard.error ? 'rgba(250,82,82,0.18)' : 'rgba(34,139,230,0.2)'}
      dash={[8 / zoom, 4 / zoom]} listening={false} />) : preview.panels.map(p => <Line key={p.id}
      points={p.points.flatMap(point => [point.x, wallHeight - point.y])} closed stroke={color} strokeWidth={2 / zoom}
      fill={p.color ?? 'rgba(34,139,230,0.2)'} opacity={0.6} listening={false} />)}
    <Text x={preview.bounds.x} y={wallHeight - preview.bounds.y - preview.bounds.height - 23 / zoom}
      text={`${Math.round(preview.bounds.width)} × ${Math.round(preview.bounds.height)} мм`} fill={color} fontSize={13 / zoom} listening={false} />
  </Layer>;
};
