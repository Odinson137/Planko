import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PdfExportService } from '../src/application/services/PdfExportService';
import { LayoutEngine } from '../src/core/layout/LayoutEngine';
import { createDefaultWall } from '../src/core/models/Wall';
import { DEFAULT_MATERIALS } from '../src/core/models/Material';

test('overview has architectural dimension chains for upper and split parts', () => {
  const wall=createDefaultWall('dimensions');wall.width=3600;wall.height=2750;wall.openings=[];
  const mat=DEFAULT_MATERIALS.find(m=>m.type==='SHEET')!;wall.zone.materialId=mat.id;
  wall.panels=[['1.5',2445,2062.5,1155,687.5],['1.6',2445,1375,578,687.5],['1.8',3023,1375,577,687.5]].map(([id,x,y,w,h])=>({
    id:String(id),partLabel:String(id),materialId:mat.id,points:[{x:+x,y:+y},{x:+x + +w,y:+y},{x:+x + +w,y:+y + +h},{x:+x,y:+y + +h}],
  }));
  const layout=LayoutEngine.calculateWallLayout(wall,mat,[mat]);
  const texts:string[]=[];
  const ctx=new Proxy({}, {get:(_,key)=>key==='fillText'?(text:string)=>texts.push(text):key==='measureText'?(s:string)=>({width:s.length*9}):()=>undefined,set:()=>true});
  (PdfExportService as any).drawWall2DOnCanvas(ctx,wall,layout,0,0,2830,840,true,[mat]);
  for (const value of ['1155','578','577','687.5']) assert.ok(texts.includes(value),value);
  assert.equal(texts.filter(s=>s.includes(' · ')).length,0);
});
