const { buildSync } = require('esbuild');
const { createCanvas } = require('C:/Users/buryy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const source = `
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { useProjectStore } from './src/application/stores/useProjectStore';
import { LayoutEngine } from './src/core/layout/LayoutEngine';
import { PolygonSlicingEngine as G } from './src/core/geometry/PolygonSlicingEngine';
import { getResolvedPanelEdges } from './src/core/geometry/PanelJointBinding';
import { PdfExportService } from './src/application/services/PdfExportService';
const source = JSON.parse(fs.readFileSync('tmp/pdfs/inspect-14/current-project.json', 'utf8'));
useProjectStore.setState({ project: source });
const wall = () => useProjectStore.getState().project.walls[0];
const initial = wall().joints.filter(j => j.width > 0).map(j => j.id);
for (const id of initial) {
  const p = wall().panels.find(p => getResolvedPanelEdges(wall(), p).some(e => e.joint?.id === id));
  const e = getResolvedPanelEdges(wall(), p).find(e => e.joint?.id === id);
  useProjectStore.getState().setPanelEdgeWidth(wall().id, p.id, e.key, 0);
}
const project = useProjectStore.getState().project;
const mat = project.materials.find(m => m.id === wall().zone.materialId) || project.materials[0];
const layout = LayoutEngine.calculateWallLayout(wall(), mat, project.materials);
const area = wall().panels.reduce((sum, p) => sum + G.calculatePolygonArea(p.points), 0);
assert.ok(Math.abs(area - wall().width * wall().height) < 0.01);
assert.ok(wall().joints.every(j => j.width === 0));
assert.ok(layout.panels.every(p => p.width <= 1220));
assert.equal(layout.panels.length, source.walls[0].panels.length);
fs.mkdirSync('output/projects', { recursive: true });
fs.writeFileSync('output/projects/avpvap-zero-gaps.planko.json', JSON.stringify(project, null, 2));
const canvas = createCanvas(2830, 1300), ctx = canvas.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 2830, 1300);
(PdfExportService as any).drawWall2DOnCanvas(ctx, wall(), layout, 0, 0, 2830, 1300, true, project.materials);
fs.writeFileSync('tmp/pdfs/inspect-14/zero-gap-verification.png', canvas.toBuffer('image/png'));
console.log(JSON.stringify({ changedJoints: initial.length, panels: layout.panels.length,
  gaps: wall().joints.map(j => j.width), area, widths: [...new Set(layout.panels.map(p => p.width))] }));
`;
const result = buildSync({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
new Function('require', 'createCanvas', result.outputFiles[0].text)(require, createCanvas);
