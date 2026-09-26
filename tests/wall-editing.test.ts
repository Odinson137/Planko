import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { createDefaultWall } from '../src/core/models/Wall';
import { createDefaultProject } from '../src/core/models/Project';
import { createDefaultOpening } from '../src/core/models/Opening';
import { extendWall, resizeWallSection, changeWallCorner, straightenWallCorner, resizeWallHeight, removeWallSection } from '../src/core/geometry/WallEditing';
import { buildWallPath, resolvePathBends, snapWallHeading } from '../src/core/geometry/WallPath';
import { useProjectStore } from '../src/application/stores/useProjectStore';
import { useWallEditorStore } from '../src/application/stores/useWallEditorStore';
import { materializeWall, wallPlanBends } from '../src/application/services/WallEditing';
import { LocalSQLiteRepository } from '../src/infrastructure/repositories/LocalSQLiteRepository';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { PdfExportService } from '../src/application/services/PdfExportService';
import { close, sheet, panel } from './helpers/business';

const path = (wall: ReturnType<typeof createDefaultWall>) => buildWallPath(wall, resolvePathBends(wall));
const originalProject = useProjectStore.getState(), originalEditor = useWallEditorStore.getState();
beforeEach(() => {
  useWallEditorStore.setState({ ...originalEditor, target: null });
  useProjectStore.setState({ ...originalProject, project: createDefaultProject(), isDirty: false });
});
afterEach(() => { useWallEditorStore.setState(originalEditor); useProjectStore.setState(originalProject); });

test('append creates a connected L, keeps manufactured panels intact and adds only empty area', () => {
  const wall = createDefaultWall('wall');
  wall.panels![0] = { ...wall.panels![0], isVoid: false, materialId: sheet.id, partLabel: '1.1' };
  wall.zone.materialId = sheet.id;
  const before = structuredClone(wall);
  const next = extendWall(wall, 'end', 2000, -Math.PI/2), geometry = path(next);
  assert.equal(next.width, 5600);
  assert.deepEqual(next.panels![0], before.panels![0]);
  assert.equal(next.panels![1].isVoid, true);
  assert.equal(next.bends![0].x, 3600);
  assert.equal(next.bends![0].type, 'INNER_CORNER');
  close(geometry.endPoint.x, 3600); close(geometry.endPoint.z, 2000);
  assert.deepEqual(wall, before);
  const layout = LayoutEngine.calculateWallLayout(next, sheet, [sheet]);
  close(layout.summary.coveredAreaSqM, 3.6*2.75);
});

test('prepend preserves world position, openings, joints, angles and texture anchors of old surfaces', () => {
  const wall = extendWall(createDefaultWall('wall'), 'end', 2000, -Math.PI/2);
  wall.openings = [{ ...createDefaultOpening('WINDOW',wall.width,wall.height), x: 200 }];
  wall.joints = [{ id: 'j', p1: {x: 300,y:0}, p2: {x:300,y:2750}, width:8, isLED:false }];
  wall.panels![0].textureMapping = { angleDeg: 20, offsetX: 10, offsetY: 20, anchor: {x:0,y:0,width:3600,height:2750} };
  const next = extendWall(wall,'start',1000,Math.PI/2), oldPath = path(wall), nextPath = path(next);
  assert.equal(next.openings[0].x, 1200);
  assert.equal(next.joints![0].p1.x, 1300);
  assert.equal(next.panels![0].textureMapping!.anchor!.x, 1000);
  assert.equal(next.bends!.find(b=>b.id===wall.bends![0].id)!.x, 4600);
  for (const s of [0,100,3500,4000,wall.width]) {
    const a=oldPath.getPointAtS(s), b=nextPath.getPointAtS(s+1000);
    close(a.x,b.x); close(a.z,b.z);
  }
});

test('straight continuation extends the section without inventing a ninety degree bend', () => {
  const next = extendWall(createDefaultWall('w'), 'end', 800, 0);
  assert.equal(next.bends!.length,0);
  assert.equal(path(next).pathSections.length,1);
  close(path(next).endPoint.x,4400);
});

test('middle segment resizing translates following sections and their openings without scaling', () => {
  let wall = extendWall(createDefaultWall('w'),'end',2000,-Math.PI/2);
  wall = extendWall(wall,'end',1000,0);
  wall.openings = [{ ...createDefaultOpening('DOOR',wall.width,wall.height), x: 5700, width: 700 }];
  const id=path(wall).pathSections[1].id;
  const next=resizeWallSection(wall,id,1500), sections=path(next).pathSections;
  assert.deepEqual(sections.map(s=>s.sEnd-s.sStart),[3600,1500,1000]);
  assert.equal(next.openings[0].x,5200);
  close(sections[1].endPoint.x,sections[2].startPoint.x);
  close(sections[1].endPoint.z,sections[2].startPoint.z);
});

test('shortening rejects occupied strips without deleting or distorting anything', () => {
  const wall=createDefaultWall('w');
  wall.openings=[{...createDefaultOpening('WINDOW',wall.width,wall.height),x:2500,width:800}];
  const snapshot=structuredClone(wall);
  assert.throws(()=>resizeWallSection(wall,'start',2800),/проём/);
  assert.deepEqual(wall,snapshot);
  wall.openings=[];
  wall.panels![0].isVoid=false; wall.panels![0].materialId=sheet.id;
  assert.throws(()=>resizeWallSection(wall,'start',2800),/деталь/);
  assert.throws(()=>resizeWallHeight(wall,2000),/деталь/);
});

test('radius edit inserts arc length and retains straight lengths and continuous endpoints', () => {
  const wall=extendWall(createDefaultWall('w'),'end',2000,-Math.PI/2);
  const next=changeWallCorner(wall,wall.bends![0].id,{type:'INNER_CORNER',angleDeg:90,radius:300});
  assert.equal(next.width,6071);
  const sections=path(next).pathSections;
  assert.deepEqual(sections.map(s=>s.sEnd-s.sStart),[3600,471,2000]);
  for(let i=1;i<sections.length;i++) {
    close(sections[i-1].endPoint.x,sections[i].startPoint.x);
    close(sections[i-1].endPoint.z,sections[i].startPoint.z);
  }
  close(sections[1].endPoint.x,3900); close(sections[1].endPoint.z,300);
  const restored=changeWallCorner(next,next.bends![0].id,{type:'INNER_CORNER',angleDeg:90,radius:0});
  assert.equal(restored.width,5600);
});

test('turn edits rotate the tail, height growth adds empty surface and invalid inputs are rejected', () => {
  const wall=extendWall(createDefaultWall('w'),'end',2000,-Math.PI/2);
  const next=changeWallCorner(wall,wall.bends![0].id,{type:'OUTER_CORNER',angleDeg:45,radius:0});
  close(path(next).endPoint.x,3600+Math.sqrt(2)*1000);
  close(path(next).endPoint.z,-Math.sqrt(2)*1000);
  const higher=resizeWallHeight(next,3000);
  assert.deepEqual(higher.panels!.slice(0,-1),next.panels);
  assert.equal(higher.panels!.at(-1)!.isVoid,true);
  assert.throws(()=>extendWall(wall,'end',0,0),/100/);
  assert.throws(()=>resizeWallSection(wall,'start',NaN));
  assert.throws(()=>changeWallCorner(wall,wall.bends![0].id,{type:'INNER_CORNER',angleDeg:180,radius:0}));
});

test('straightening a rounded corner keeps all unfolded contents and prevents legacy bends from returning', () => {
  let wall = extendWall(createDefaultWall('w'), 'end', 2000, -Math.PI/2);
  const bend = wall.bends![0];
  wall = changeWallCorner(wall, bend.id, { type: bend.type, angleDeg: 90, radius: 300 });
  wall.openings = [{ ...createDefaultOpening('WINDOW', wall.width, wall.height), x: 4200, width: 600 }];
  wall.joints = [{ id: 'joint', p1: { x: 4500, y: 0 }, p2: { x: 4500, y: 2750 }, width: 8, isLED: false }];
  wall.panels![0].radiusConfig = { type: bend.type, radius: 300, angleDeg: 90 };
  const before = structuredClone(wall), next = straightenWallCorner(wall, bend.id);
  assert.equal(next.width, wall.width);
  assert.deepEqual(next.openings, wall.openings);
  assert.deepEqual(next.joints, wall.joints);
  assert.deepEqual(next.panels!.map(p => p.points), wall.panels!.map(p => p.points));
  assert.equal(path(next).corners.length, 0);
  close(path(next).endPoint.x, wall.width); close(path(next).endPoint.z, 0);
  assert.deepEqual(wall, before);
  assert.throws(() => straightenWallCorner(wall, 'missing'), /Выберите угол/);
});

test('wall inspector angle edits, straightening and details share undo and redo history', () => {
  const editor = useWallEditorStore.getState(), project = useProjectStore.getState().project;
  editor.syncTarget(project.id, project.walls[0].id); editor.begin('end'); editor.extend(1200, -Math.PI/2); editor.finish();
  const before = structuredClone(useProjectStore.getState().project.walls[0]), bend = before.bends![0];
  editor.corner(bend.id, { type: 'OUTER_CORNER', radius: 200, angleDeg: 60 });
  const angled = structuredClone(useProjectStore.getState().project.walls[0]);
  assert.equal(angled.bends![0].angleDeg, 60);
  assert.deepEqual(path(angled).pathSections.filter(s => !s.isBend).map(s => s.sEnd-s.sStart), [3600, 1200]);
  editor.undo(); assert.deepEqual(useProjectStore.getState().project.walls[0], before);
  editor.redo(); assert.deepEqual(useProjectStore.getState().project.walls[0], angled);
  editor.straighten(bend.id);
  assert.equal(path(useProjectStore.getState().project.walls[0]).corners.length, 0);
  editor.undo(); assert.deepEqual(useProjectStore.getState().project.walls[0], angled);
  editor.details('Стена у окна', 'Кухня');
  const named = useProjectStore.getState().project.walls[0];
  assert.equal(named.name, 'Стена у окна'); assert.equal(named.roomName, 'Кухня');
  editor.undo(); assert.deepEqual(useProjectStore.getState().project.walls[0], angled);
  editor.redo(); assert.deepEqual(useProjectStore.getState().project.walls[0], named);
});

test('reverse walls, crossings and closed loops cannot be committed', () => {
  let wall=createDefaultWall('w');
  assert.throws(()=>extendWall(wall,'end',1000,Math.PI),/обратно/);
  wall=extendWall(wall,'end',2000,-Math.PI/2);
  wall=extendWall(wall,'end',3600,Math.PI);
  assert.throws(()=>extendWall(wall,'end',2000,Math.PI/2),/замыкаются/);
  wall=extendWall(createDefaultWall('w'),'end',2000,-Math.PI/2);
  wall=extendWall(wall,'end',1800,Math.PI);
  assert.throws(()=>extendWall(wall,'end',3000,Math.PI/2),/пересекаются/);
});

test('snapping uses the selected endpoint heading and supports an explicit bypass', () => {
  close(snapWallHeading(Math.PI/2+0.02,0),Math.PI/2);
  close(snapWallHeading(0.02,Math.PI),0);
  close(snapWallHeading(0.02,0,false),0.02);
});

test('undo and redo restore exact walls including absent pose; preview does not dirty the project', () => {
  const editor=useWallEditorStore.getState(), project=useProjectStore.getState().project, before=structuredClone(project.walls[0]);
  editor.syncTarget(project.id,before.id); editor.begin('start');
  assert.equal(useProjectStore.getState().isDirty,false);
  assert.equal(editor.extend(1000,Math.PI/2),true);
  const after=structuredClone(useProjectStore.getState().project.walls[0]);
  editor.undo(); assert.deepEqual(useProjectStore.getState().project.walls[0],before);
  editor.redo(); assert.deepEqual(useProjectStore.getState().project.walls[0],after);
  editor.undo(); editor.begin('end'); editor.extend(1000,0);
  assert.equal(useProjectStore.getState().history.future.length,0);
});

test('geometry and external edits share chronological undo history', () => {
  const editor=useWallEditorStore.getState(), project=useProjectStore.getState().project;
  editor.syncTarget(project.id,project.walls[0].id); editor.begin('end'); editor.extend(1000,Math.PI/2);
  useProjectStore.getState().updateWall(project.walls[0].id,{name:'Changed outside'});
  editor.undo();
  assert.equal(useProjectStore.getState().project.walls[0].name,project.walls[0].name);
  assert.equal(useProjectStore.getState().project.walls[0].width,4600);
  assert.equal(useProjectStore.getState().history.past.length,1);
  editor.undo();
  assert.deepEqual(useProjectStore.getState().project.walls[0], project.walls[0]);
});

test('legacy procedural layouts and bend columns materialize with the same geometry', () => {
  const project=createDefaultProject(), wall=project.walls[0];
  delete wall.panels;
  wall.zone.materialId=sheet.id; project.materials=[sheet];
  wall.customPanels={0:{columnIndex:0, customWidth:471, radiusConfig:{type:'OUTER_CORNER',radius:300,angleDeg:90}}};
  const before=buildWallPath(wall,wallPlanBends(project,wall));
  const next=materializeWall(project,wall);
  assert.ok(next.panels!.length);
  assert.ok(next.bends!.length);
  close(path(next).endPoint.x,before.endPoint.x); close(path(next).endPoint.z,before.endPoint.z);
});

test('project save/load and JSON round trip retain the plan pose and corner geometry', async () => {
  const memory=new Map<string,string>(), oldStorage=globalThis.localStorage;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value)}});
  try {
    const project=createDefaultProject();
    project.walls[0]=extendWall(project.walls[0],'start',1700,Math.PI/4);
    const repository=new LocalSQLiteRepository(); await repository.saveProject(project);
    const saved=await repository.getProject(project.id);
    assert.deepEqual(saved!.walls,JSON.parse(JSON.stringify(project.walls)));
    const imported=await repository.importProjectFromJson(JSON.stringify(project));
    assert.deepEqual(imported.walls,JSON.parse(JSON.stringify(project.walls)));
  } finally { Object.defineProperty(globalThis,'localStorage',{configurable:true,value:oldStorage}); }
});

test('editing an existing named corner preserves its metadata', () => {
  const project=createDefaultProject();
  let wall=extendWall(project.walls[0],'end',1000,-Math.PI/2);
  wall.bends![0].name='Угол у окна';
  wall=materializeWall(project,wall);
  const next=resizeWallSection(wall,'start',3800);
  assert.equal(next.bends![0].name,'Угол у окна');
});

test('3D PDF renders a translated chain with both rounded and sharp corners without mutating its data', () => {
  const project=createDefaultProject();
  let wall=extendWall(project.walls[0],'end',2000,-Math.PI/2);
  wall=changeWallCorner(wall,wall.bends![0].id,{type:'INNER_CORNER',radius:300,angleDeg:75});
  wall=extendWall(wall,'start',1000,Math.PI/2);
  project.walls=[wall];
  const snapshot=structuredClone(project), texts:string[]=[];
  let points=0;
  const ctx=new Proxy({} as CanvasRenderingContext2D, {
    get: (_target,key) => key==='measureText' ? (text:string)=>({width:text.length*12})
      : key==='fillText' ? (text:string)=>texts.push(text)
      : (...args:unknown[]) => {
        for(const arg of args) if(typeof arg==='number') assert.ok(Number.isFinite(arg),`${String(key)} received ${arg}`);
        if(key==='moveTo' || key==='lineTo') points++;
      },
    set:()=>true,
  });
  (PdfExportService as unknown as { renderAxonometric3DPage: (ctx:CanvasRenderingContext2D,w:number,h:number,p:typeof project,wallArg:typeof wall,page:number,total:number)=>void })
    .renderAxonometric3DPage(ctx,2970,2100,project,wall,1,1);
  assert.ok(points>100);
  assert.ok(texts.some(text=>text.includes(wall.name)));
  assert.deepEqual(project,snapshot);
});

test('deleting the first section removes its rounded corner and keeps the remaining wall in world space', () => {
  let wall=extendWall(createDefaultWall('w'),'end',2000,-Math.PI/2);
  wall=changeWallCorner(wall,wall.bends![0].id,{type:'INNER_CORNER',radius:300,angleDeg:90});
  wall=extendWall(wall,'end',1200,0);
  const before=structuredClone(wall), geometry=path(wall), removed=4071;
  const next=removeWallSection(wall,'start')!;
  assert.equal(next.width,3200);
  assert.equal(next.bends!.length,1);
  assert.equal(next.bends![0].x,2000);
  for(const s of [0,100,1999,2400,3200]) {
    const a=geometry.getPointAtS(s+removed), b=path(next).getPointAtS(s);
    close(a.x,b.x); close(a.z,b.z);
  }
  assert.deepEqual(wall,before);
});

test('deleting the last section removes the incoming rounded corner without shifting the earlier wall', () => {
  let wall=extendWall(createDefaultWall('w'),'end',2000,-Math.PI/2);
  wall=changeWallCorner(wall,wall.bends![0].id,{type:'INNER_CORNER',radius:300,angleDeg:90});
  const next=removeWallSection(wall,path(wall).pathSections.at(-1)!.id)!;
  assert.equal(next.width,3600);
  assert.deepEqual(next.bends,[]);
  close(path(next).endPoint.x,3600); close(path(next).endPoint.z,0);
});

test('deleting a middle section joins the tail at the existing incoming corner and preserves all remaining lengths', () => {
  let wall=extendWall(createDefaultWall('w'),'end',2000,-Math.PI/2);
  wall=extendWall(wall,'end',1400,Math.PI);
  wall=changeWallCorner(wall,wall.bends![1].id,{type:'INNER_CORNER',radius:200,angleDeg:90});
  const next=removeWallSection(wall,path(wall).pathSections[1].id)!;
  assert.equal(next.width,5000);
  assert.equal(next.bends!.length,1);
  assert.equal(next.bends![0].id,wall.bends![0].id);
  assert.deepEqual(path(next).pathSections.map(s=>s.sEnd-s.sStart),[3600,1400]);
  close(path(next).endPoint.x,3600); close(path(next).endPoint.z,1400);
});

test('deleting a section removes only contained objects and translates surviving details, texture anchors and profiles', () => {
  let wall=extendWall(createDefaultWall('w'),'end',2000,-Math.PI/2);
  wall=extendWall(wall,'end',1400,0);
  wall.panels=[panel('left',0,0,3600,2750),panel('removed',3600,0,2000,2750),panel('right',5600,0,1400,2750)];
  wall.panels[2].textureMapping={offsetX:50,offsetY:10,angleDeg:0,anchor:{x:5600,y:0,width:1400,height:2750}};
  const opening=createDefaultOpening('WINDOW',wall.width,wall.height);
  wall.openings=[{...opening,id:'removed',x:4000,width:600},{...opening,id:'kept',x:5800,width:600}];
  wall.joints=[{id:'continuous',p1:{x:0,y:100},p2:{x:7000,y:800},width:8,isLED:true},
    {id:'local',p1:{x:4000,y:0},p2:{x:4000,y:2000},width:5,isLED:false}];
  wall.customJoints={continuous:{id:'continuous',width:8,isLED:true,orientation:'DIAGONAL',profileArticle:'DL-13'},
    local:{id:'local',width:5,isLED:false,orientation:'VERTICAL'}};
  const next=removeWallSection(wall,path(wall).pathSections[1].id)!;
  assert.deepEqual(next.panels!.map(p=>p.id),['left','right']);
  assert.deepEqual(next.panels![0],wall.panels[0]);
  assert.equal(next.panels![1].points[0].x,3600);
  assert.equal(next.panels![1].textureMapping!.anchor!.x,3600);
  assert.deepEqual(next.openings.map(op=>[op.id,op.x]),[['kept',3800]]);
  assert.equal(next.joints!.length,2);
  assert.equal(next.joints![0].p2.x,3600);
  assert.equal(next.joints![1].p1.x,3600);
  assert.equal(next.joints![1].p2.x,5000);
  assert.equal(next.customJoints[next.joints![1].id].profileArticle,'DL-13');
  assert.equal(next.customJoints.local,undefined);
});

test('a shared manufactured panel or opening prevents deletion instead of losing data on its neighbour', () => {
  const wall=extendWall(createDefaultWall('w'),'end',2000,-Math.PI/2);
  const id=path(wall).pathSections[1].id;
  wall.panels=[panel('shared',3000,0,1800,2750)];
  const snapshot=structuredClone(wall);
  assert.throws(()=>removeWallSection(wall,id),/деталь/);
  assert.deepEqual(wall,snapshot);
  wall.panels=[];
  wall.openings=[{...createDefaultOpening('WINDOW',wall.width,wall.height),x:3200,width:800}];
  assert.throws(()=>removeWallSection(wall,id),/проём/);
  assert.throws(()=>removeWallSection(wall,'missing'),/Выберите/);
});

test('deleting a section is one undoable transaction with dirty state and cleared selection', () => {
  const editor=useWallEditorStore.getState(), project=useProjectStore.getState().project;
  editor.syncTarget(project.id,project.walls[0].id); editor.begin('end'); editor.extend(1000,-Math.PI/2);
  const before=structuredClone(useProjectStore.getState().project.walls[0]);
  const id=path(before).pathSections[1].id;
  editor.select({kind:'segment',id}); editor.remove(id);
  assert.equal(useWallEditorStore.getState().selection,null);
  // Adding and then removing the section returns to the saved geometry.
  assert.equal(useProjectStore.getState().isDirty,false);
  assert.equal(useProjectStore.getState().project.walls[0].width,3600);
  editor.undo(); assert.deepEqual(useProjectStore.getState().project.walls[0],before);
  assert.equal(useProjectStore.getState().isDirty,true);
  editor.redo(); assert.equal(useProjectStore.getState().project.walls[0].width,3600);
});

test('deleting the sole section removes the chain and undo restores its position between other walls', async () => {
  const editor=useWallEditorStore.getState(), project=useProjectStore.getState().project;
  const walls=[createDefaultWall('left'),project.walls[0],createDefaultWall('right')];
  useProjectStore.setState({project:{...project,walls}});
  editor.syncTarget(project.id,walls[1].id); editor.remove('start');
  assert.deepEqual(useProjectStore.getState().project.walls.map(w=>w.id),['left','right']);
  assert.equal(useProjectStore.getState().project.selectedWallId,null);
  // Saving the deleted state must not invalidate the pending undo.
  useProjectStore.setState({isDirty:false});
  editor.undo(); assert.deepEqual(useProjectStore.getState().project.walls,walls);
  assert.equal(useProjectStore.getState().project.selectedWallId,walls[1].id);
  editor.redo(); assert.deepEqual(useProjectStore.getState().project.walls.map(w=>w.id),['left','right']);
});

test('deleting the final chain leaves an empty project that can still be restored', () => {
  const editor=useWallEditorStore.getState(), project=useProjectStore.getState().project;
  editor.syncTarget(project.id,project.walls[0].id); editor.remove('start');
  assert.equal(useProjectStore.getState().project.walls.length,0);
  editor.undo(); assert.deepEqual(useProjectStore.getState().project.walls,project.walls);
});
