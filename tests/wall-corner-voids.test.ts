import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultWall, type WallPanelPiece } from '../src/core/models/Wall';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultOpening } from '../src/core/models/Opening';
import { MATERIAL_NONE_ID } from '../src/core/models/Material';
import { changeWallCorner, extendWall } from '../src/core/geometry/WallEditing';
import { bendLength, buildWallPath, resolvePathBends } from '../src/core/geometry/WallPath';
import { PolygonSlicingEngine } from '../src/core/geometry/PolygonSlicingEngine';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { useWallEditorStore } from '../src/application/stores/useWallEditorStore';
import { close, rectangle, sheet } from './helpers/business';

const bounds = (p: WallPanelPiece) => ({ min: Math.min(...p.points.map(v => v.x)), max: Math.max(...p.points.map(v => v.x)) });
const blank = (x: number, width: number): WallPanelPiece => ({
  id: `wall-void-${crypto.randomUUID()}`, points: rectangle(x, 0, width, 2750),
  materialId: MATERIAL_NONE_ID, isVoid: true, partLabel: 'ПУСТО',
});
function fragmentedCorner() {
  let wall = extendWall(createDefaultWall('corner-regression'), 'end', 2000, -Math.PI/2);
  wall = changeWallCorner(wall, wall.bends![0].id, { type: 'INNER_CORNER', radius: 475, angleDeg: 90 });
  // The previous implementation inserted one independent strip for each edit.
  let x=3600;
  wall.panels = [...wall.panels!.slice(0,2), ...[67,67,78,534].map(width => {
    const p=blank(x,width); x+=width; return p;
  })];
  assert.equal(x, 3600+bendLength(wall.bends![0]));
  return wall;
}

test('repeated radius and angle edits keep one arc filler and preserve the straight sections', () => {
  let wall = extendWall(createDefaultWall('radius'), 'end', 2000, -Math.PI/2);
  const id = wall.bends![0].id, straightIds=wall.panels!.map(p=>p.id);
  let arcId: string | undefined;
  for (const [radius, angleDeg] of [[300,90],[350,90],[400,90],[475,90],[475,120],[475,60],[100,60],[500,90]]) {
    const before=structuredClone(wall);
    const next=changeWallCorner(wall,id,{type:'INNER_CORNER',radius,angleDeg});
    assert.deepEqual(wall,before);
    wall=next;
    assert.equal(wall.panels!.length,3);
    const arc=wall.panels!.find(p=>!straightIds.includes(p.id))!;
    if (arcId) assert.equal(arc.id,arcId);
    arcId=arc.id;
    close(bounds(arc).min,3600); close(bounds(arc).max,3600+bendLength(wall.bends![0]));
    close(wall.panels!.reduce((sum,p)=>sum+PolygonSlicingEngine.calculatePolygonArea(p.points),0), wall.width*wall.height);
    assert.deepEqual(buildWallPath(wall,resolvePathBends(wall)).pathSections.filter(s=>!s.isBend).map(s=>s.sEnd-s.sStart),[3600,2000]);
    const layout=LayoutEngine.calculateWallLayout(wall,sheet,[sheet,...createDefaultProject().materials]);
    assert.equal(layout.panels.length,3, 'the unfolded canvas must also receive only three pieces');
  }
  wall=changeWallCorner(wall,id,{type:'INNER_CORNER',radius:0,angleDeg:90});
  assert.deepEqual(wall.panels!.map(p=>p.id),straightIds);
  wall=changeWallCorner(wall,id,{type:'INNER_CORNER',radius:300,angleDeg:90});
  assert.equal(wall.panels!.length,3);
});

test('reapplying an unchanged corner repairs old strips with exact undo, redo and JSON persistence', () => {
  const previousProject=useProjectStore.getState(), previousEditor=useWallEditorStore.getState();
  try {
    const project=createDefaultProject(), wall=fragmentedCorner(), before=structuredClone(wall);
    useWallEditorStore.setState({target:null});
    useProjectStore.setState({project:{...project,walls:[wall],selectedWallId:wall.id},isDirty:false});
    const editor=useWallEditorStore.getState();
    editor.syncTarget(project.id,wall.id); editor.corner(wall.bends![0].id,wall.bends![0]);
    const repaired=useProjectStore.getState().project.walls[0];
    assert.equal(repaired.panels!.length,3);
    assert.equal(repaired.width,before.width);
    assert.deepEqual(repaired.bends,before.bends);
    assert.deepEqual(repaired.panels!.slice(0,2),before.panels!.slice(0,2));
    assert.equal(useProjectStore.getState().isDirty,true);
    editor.undo(); assert.deepEqual(useProjectStore.getState().project.walls[0],before);
    editor.redo(); assert.deepEqual(useProjectStore.getState().project.walls[0],repaired);
    const loaded=JSON.parse(JSON.stringify(repaired));
    assert.deepEqual(changeWallCorner(loaded,loaded.bends[0].id,loaded.bends[0]),loaded);
    assert.deepEqual(wall,before);
  } finally {
    useProjectStore.setState(previousProject); useWallEditorStore.setState(previousEditor);
  }
});

test('manual zero-gap cuts inside a generated arc remain separate after corner edits', () => {
  const wall=fragmentedCorner(), original=wall.panels![2];
  const split=PolygonSlicingEngine.splitWallPanel(original,{x:3630,y:0},{x:3630,y:2750},0)!;
  wall.panels!.splice(2,1,...split.newPanels);
  const next=changeWallCorner(wall,wall.bends![0].id,{...wall.bends![0],radius:500});
  for (const piece of split.newPanels) assert.deepEqual(next.panels!.find(p=>p.id===piece.id),piece);
  assert.equal(next.panels!.filter(p=>bounds(p).min < 3667 && bounds(p).max > 3600).length,2);
});

test('configured profiles and zero-width joints protect the boundary between automatic strips', () => {
  for (const width of [0,8]) {
    const wall=fragmentedCorner();
    wall.joints=[{id:'seam',p1:{x:3734,y:0},p2:{x:3734,y:2750},width,isLED:false}];
    wall.customJoints={seam:{id:'seam',orientation:'VERTICAL',width,isLED:true,profileArticle:'DL-13'}};
    const next=changeWallCorner(wall,wall.bends![0].id,wall.bends![0]);
    assert.equal(next.panels!.length,4);
    assert.ok(next.panels!.some(p=>bounds(p).max===3734));
    assert.ok(next.panels!.some(p=>bounds(p).min===3734));
    assert.deepEqual(next.joints,wall.joints); assert.deepEqual(next.customJoints,wall.customJoints);
  }
});

test('arc cleanup preserves materials, custom notes, edge settings, shapes and intentional gaps', () => {
  const changes: Partial<WallPanelPiece>[] = [
    {materialId:sheet.id,isVoid:false}, {note:'Оставить под зеркало'}, {partLabel:'Ниша'},
    {edges:{right:{width:8,isLED:true,profileArticle:'DL-13'}}},
    {points:[{x:3600,y:0},{x:3667,y:0},{x:3640,y:2750},{x:3600,y:2750}]},
    {points:rectangle(3600,0,66,2750)},
  ];
  for (const change of changes) {
    const wall=fragmentedCorner();
    wall.panels![2]={...wall.panels![2],...change};
    const protectedPiece=structuredClone(wall.panels![2]);
    const next=changeWallCorner(wall,wall.bends![0].id,wall.bends![0]);
    assert.deepEqual(next.panels!.find(p=>p.id===protectedPiece.id),protectedPiece);
  }
});

test('arc cleanup keeps cladding and openings at their correct positions without merging adjacent wall areas', () => {
  const wall=fragmentedCorner();
  wall.panels![0]={...wall.panels![0],materialId:sheet.id,isVoid:false,textureMapping:{angleDeg:30,offsetX:10,offsetY:20}};
  wall.panels![1]={...wall.panels![1],materialId:sheet.id,isVoid:false,textureMapping:{angleDeg:0,offsetX:5,offsetY:2,anchor:{x:4346,y:0,width:2000,height:2750}}};
  wall.openings=[{...createDefaultOpening('WINDOW',wall.width,wall.height),x:4500,width:600}];
  wall.joints=[{id:'top',p1:{x:3600,y:2750},p2:{x:4346,y:2750},width:5,isLED:false}];
  const next=changeWallCorner(wall,wall.bends![0].id,{...wall.bends![0],radius:500});
  const delta=bendLength(next.bends![0])-bendLength(wall.bends![0]);
  assert.equal(next.panels!.length,3);
  assert.deepEqual(next.panels![0],wall.panels![0]);
  close(bounds(next.panels![1]).min,4346+delta);
  close(bounds(next.panels![1]).max-bounds(next.panels![1]).min,2000);
  assert.equal(next.panels![1].textureMapping!.anchor!.x,4346+delta);
  assert.equal(next.openings[0].x,4500+delta);
  assert.deepEqual(next.joints,wall.joints);
});
