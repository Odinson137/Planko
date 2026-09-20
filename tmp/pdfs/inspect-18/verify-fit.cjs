const {buildSync}=require('esbuild');
const {createCanvas}=require('C:/Users/buryy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const source=`
import fs from 'node:fs';
import { NestingEngine } from './src/core/layout/NestingEngine';
import { PdfExportService } from './src/application/services/PdfExportService';
const project=JSON.parse(fs.readFileSync('tmp/pdfs/inspect-18/current-project.json','utf8'));
const original=NestingEngine.optimizeProjectNesting.bind(NestingEngine);
let nesting;
const stop=new Error('captured');
NestingEngine.optimizeProjectNesting=(...args)=>{nesting=original(...args);throw stop;};
(async()=>{
try {await PdfExportService.exportPanelsLayoutPdf(project);} catch(error){if(error!==stop)throw error;}
NestingEngine.optimizeProjectNesting=original;
console.log(JSON.stringify({updatedAt:project.updatedAt,jointWidths:project.walls[0].joints.map(j=>j.width),sheets:nesting.totalSheetsCount,parts:nesting.totalPartsCount},null,2));
for(const sheet of nesting.allSheets)for(const placed of sheet.placedParts){
const p=placed.part;
console.log(JSON.stringify({label:p.partLabel,width:p.width,widthPrecise:p.width.toPrecision(18),height:p.height,stock:[sheet.sheetWidth,sheet.sheetHeight],fits:NestingEngine.fitsStock(p.width,p.height,sheet.sheetWidth,sheet.sheetHeight,p.materialType),points:p.partLabel==='1.6'?p.polygonPoints:undefined}));
}
fs.writeFileSync('tmp/pdfs/inspect-18/nesting.json',JSON.stringify(nesting,null,2));
const canvas=createCanvas(2970,2100);
(PdfExportService as any).renderPanelLayoutPage(canvas.getContext('2d'),2970,2100,project,project.walls[0],nesting,1,1);
fs.writeFileSync('tmp/pdfs/inspect-18/current-render.png',canvas.toBuffer('image/png'));
})();`;
const result=buildSync({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'cjs',packages:'external',write:false});
new Function('require','createCanvas',result.outputFiles[0].text)(require,createCanvas);
