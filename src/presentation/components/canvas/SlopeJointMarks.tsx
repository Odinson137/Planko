import { Group, Line, Circle, Text } from 'react-konva';
import { useSlopeJointStore } from '../../../application/stores/useSlopeJointStore';
import { type CalculatedSlopeJoint, slopeJointHasProfile, SLOPE_JOINTS } from '../../../core/geometry/SlopeJointGeometry';
import type { Opening } from '../../../core/models/Opening';

/** Front-view symbols show depth-directed joints; they are not facade framing lines. */
export function SlopeJointMarks({ opening, wallId, projectId, joints, zoom, selected }: {
  opening: Opening; wallId: string; projectId: string; joints: CalculatedSlopeJoint[]; zoom: number; selected: boolean;
}) {
  const editor = useSlopeJointStore();
  const same = selected && editor.target?.projectId === projectId && editor.target.wallId === wallId && editor.target.openingId === opening.id;
  const d = Math.min(opening.width / 5, opening.height / 5, 28 / zoom);
  return <Group listening={false}>{joints.filter(j => j.openingId === opening.id).map(joint => {
    const active = same && joint.corner === editor.corner;
    if (!selected && !slopeJointHasProfile(joint) && joint.width <= 0) return null;
    const left = joint.sides[1] === 'left', top = joint.sides[0] === 'top';
    const x = left ? 0 : opening.width, y = top ? 0 : opening.height;
    const endX = x + (left ? d : -d), endY = y + (top ? d : -d);
    const color = active ? '#339af0' : joint.isLED ? '#ffd43b' : joint.profileColor ?? '#adb5bd';
    return <Group key={joint.id}>
      <Line points={[x, y, endX, endY]} stroke={color} strokeWidth={(active ? 4 : 2) / zoom}
        dash={!slopeJointHasProfile(joint) ? [4 / zoom, 3 / zoom] : undefined} />
      {selected && <><Circle x={endX} y={endY} radius={9 / zoom} fill={active ? '#1971c2' : '#343a40'} stroke="#74c0fc" strokeWidth={1 / zoom} />
        <Text x={endX - 9 / zoom} y={endY - 6 / zoom} width={18 / zoom} align="center"
          text={String(SLOPE_JOINTS.findIndex(j => j.id === joint.corner) + 1)} fontSize={12 / zoom} fill="#fff" /></>}
    </Group>;
  })}</Group>;
}
