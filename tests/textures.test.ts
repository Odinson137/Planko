import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextureMapping, hasPhotoTexture, resolveTextureMapping, textureMappingError, pointOnSheet, slopeTexturePiece } from '../src/core/textures/TextureMapping';
import { NestingEngine, NestingPartInput } from '../src/core/layout/NestingEngine';
import { createDefaultWall } from '../src/core/models/Wall';
import { DEFAULT_MATERIALS } from '../src/core/models/Material';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { createDefaultOpening, ensureOpeningSlopes } from '../src/core/models/Opening';

function part(id: string, mapping: TextureMapping, width = 400, height = 800): NestingPartInput {
  return { id, wallId: 'wall', wallName: 'Стена', partLabel: id, materialId: 'wood', decorCode: '5007',
    textureCategory: 'WOOD', width, height, textureMapping: mapping };
}
const origin = { offsetX: 0, offsetY: 0, angleDeg: 0 };

test('photo lookup distinguishes category and exact article suffix', () => {
  assert.ok(hasPhotoTexture('WOOD', '5007'));
  assert.ok(!hasPhotoTexture('METAL', '5007'));
  assert.ok(!hasPhotoTexture('WOOD', '5007-1'));
});

test('fixed regions can touch but cannot overlap on a sheet', () => {
  const first = part('1', origin);
  for (const [offsetX, count] of [[0, 2], [399.9, 2], [400, 1], [400.5, 1]]) {
    const result = NestingEngine.optimizeProjectNesting([first, part('2', { ...origin, offsetX })]);
    assert.equal(result.totalSheetsCount, count);
    const second = result.allSheets.flatMap(s => s.placedParts).find(p => p.part.id === '2')!;
    assert.equal(second.x, offsetX);
    assert.equal(second.y, 2000);
  }
});

test('quarter-turn source region is not repacked with a different grain direction', () => {
  const result = NestingEngine.optimizeProjectNesting([part('1', { offsetX: 100, offsetY: 200, angleDeg: 90 }, 1800, 500)]);
  const p = result.allSheets[0].placedParts[0];
  assert.deepEqual([p.x,p.y,p.width,p.height,p.textureAngleDeg], [100,800,500,1800,90]);
  assert.deepEqual(NestingEngine.placedPoint(p, 0, 0), { x: 600, y: 800 });
});

test('out-of-sheet and mirrored source regions are rejected', () => {
  for (const p of [part('1', { ...origin, offsetX: 900 }),
    { ...part('3', origin), patternFlipX: true }, part('4', { ...origin, offsetY: NaN })]) {
    assert.throws(() => NestingEngine.optimizeProjectNesting([p]), /Деталь/);
  }
});

test('cut children keep source coordinates at quarter turns and arbitrary angles', () => {
  for (const angleDeg of [0,27.5,90,135,180,270,-30]) {
    const parent = { width: 400, height: 800, x: 100, y: 200, textureMapping: { offsetX: 10, offsetY: 20, angleDeg,
      anchor: { x: 100, y: 200, width: 400, height: 800 } } };
    const child = { ...parent, x: 200, y: 500, width: 150, height: 200 };
    const m = resolveTextureMapping(child);
    const corners = [[100,300],[250,300],[100,500],[250,500]].map(([x,y]) => pointOnSheet(x,y,400,800,angleDeg));
    assert.equal(m.offsetX, 10 + Math.min(...corners.map(p => p.x)));
    assert.equal(m.offsetY, 20 + Math.min(...corners.map(p => p.y)));
  }
});

test('non-photo decor preserves arbitrary rotation, offsets and diagonal cuts', () => {
  const input = {...part('angled', {offsetX:50,offsetY:80,angleDeg:32.5},400,800),decorCode:'5134'};
  const result = NestingEngine.optimizeProjectNesting([input]);
  const sheet = result.allSheets[0], p = sheet.placedParts[0];
  assert.equal(p.textureAngleDeg,32.5);
  assert.equal(p.x,50);
  assert.ok(Math.abs(sheet.sheetHeight-p.y-p.height-80)<1e-8);
  const corners = [[0,0],[400,0],[400,800],[0,800]].map(([x,y])=>NestingEngine.placedPoint(p,x,y));
  assert.ok(Math.abs(Math.hypot(corners[1].x-corners[0].x,corners[1].y-corners[0].y)-400)<1e-8);
  assert.equal(sheet.cutLines.filter(c=>c.orientation==='DIAGONAL').length,4);
  assert.throws(()=>NestingEngine.optimizeProjectNesting([{...input,width:1220,height:2800}]),/границы листа/);
});

test('unconfigured non-photo parts retain free packing next to a configured part', () => {
  const plain = {...part('plain',origin,1000,500),decorCode:'5134',textureMapping:undefined};
  const fixed = {...plain,id:'fixed',textureMapping:{...origin,offsetY:200}};
  const result = NestingEngine.optimizeProjectNesting([fixed,plain,{...plain,id:'plain2'}]);
  assert.equal(result.totalSheetsCount,2);
  assert.equal(result.allSheets.flatMap(s=>s.placedParts).filter(p=>p.textureAngleDeg!==undefined).length,1);
});

test('legacy rotation and custom stock dimensions are validated', () => {
  assert.equal(resolveTextureMapping({width:600,height:1200,patternAngleDeg:90}).angleDeg,90);
  assert.equal(textureMappingError({width:1200,height:600,textureStockWidth:1200,textureStockHeight:600}),undefined);
  assert.ok(textureMappingError({width:1200,height:600,patternAngleDeg:90,textureStockWidth:1200,textureStockHeight:600}));
});

test('panel and slope settings survive normalization and project JSON roundtrip', () => {
  const wall = createDefaultWall('texture-wall');
  const mat = { ...DEFAULT_MATERIALS.find(m => m.textureCategory === 'WOOD')!, decorCode: '5007' };
  wall.zone.materialId = mat.id;
  wall.panels = [{ id:'test-panel', materialId:mat.id, decorCode:'5007', partLabel:'1.1', points:[{x:0,y:0},{x:400,y:0},{x:400,y:800},{x:0,y:800}] }];
  const opening = createDefaultOpening('WINDOW', wall.width, wall.height);
  wall.openings = [opening];
  const previous = useProjectStore.getState();
  try {
    useProjectStore.setState({isDirty:false,project: {...previous.project, walls:[wall], materials:[mat]}});
    useProjectStore.getState().setTextureMappings(wall.id,[{id:'test-panel',mapping:{...origin,offsetX:50,offsetY:70}},
      {id:`slope-${opening.id}-left`,mapping:{...origin,offsetY:120}}]);
    assert.equal(useProjectStore.getState().isDirty,true);
    const project = JSON.parse(JSON.stringify(useProjectStore.getState().project));
    const saved = project.walls[0];
    assert.equal(ensureOpeningSlopes(saved.openings[0]).left.textureMapping?.offsetY,120);
    const layout = LayoutEngine.calculateWallLayout(saved,mat,[mat]);
    assert.equal(resolveTextureMapping(layout.panels[0]).offsetX,50);
    const slope = layout.slopes!.find(p=>p.side==='LEFT')!;
    const flat = slopeTexturePiece(slope);
    assert.equal(flat.width,slope.depth);
    assert.equal(flat.height,slope.width);
    assert.equal(flat.textureMapping?.offsetY,120);

    const beforeInvalid = useProjectStore.getState().project;
    assert.throws(() => useProjectStore.getState().setTextureMappings(wall.id, [
      {id:'test-panel',mapping:{...origin,offsetX:80}},
      {id:`slope-${opening.id}-left`,mapping:{...origin,offsetX:9999}},
    ]));
    assert.equal(useProjectStore.getState().project, beforeInvalid, 'invalid batch must not partially apply');

    useProjectStore.setState({selectedPieceIds:['test-panel'],selectedSubPieceId:'test-panel'});
    useProjectStore.getState().splitPanelHorizontally(wall.id,0,0,300);
    const cutWall = useProjectStore.getState().project.walls[0];
    const children = LayoutEngine.calculateWallLayout(cutWall,mat,[mat]).panels;
    assert.equal(children.length,2);
    for (const child of children) {
      const crop = resolveTextureMapping(child);
      assert.equal(crop.offsetX,50);
      assert.equal(crop.offsetY,70 + 800 - child.y - child.height);
    }
  } finally { useProjectStore.setState(previous); }
});
