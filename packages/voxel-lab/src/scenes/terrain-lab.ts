/**
 * Terrain Lab — 3D heightmap renderer for engine-terrain
 * Value-noise terrain with vertex-colors by altitude.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import {
  sampleHeight,
  computeHeightRange
} from '@tower/engine-terrain';
import type { LabScene } from './greedy-lab';

type StatsFn = (tri: number, vox: number, meshing: string) => void;

// ── Value noise (inline — full terrain pipeline = S3) ────────────────────
function mulberry32(s: number) {
  let a = s >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makeNoise(seed: number) {
  const rng = mulberry32(seed);
  const perm: number[] = [];
  for (let i = 0; i < 256; i++) perm.push(i);
  for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [perm[i], perm[j]] = [perm[j]!, perm[i]!]; }
  const hash = (x: number, z: number) => perm[(perm[(x & 255)!]! + (z & 255)) & 255]! / 256;
  return (x: number, z: number, scale: number) => {
    const sx = x / scale, sz = z / scale;
    const ix = Math.floor(sx), iz = Math.floor(sz);
    const fx = sx - ix, fz = sz - iz;
    const sxf = fx * fx * (3 - 2 * fx), szf = fz * fz * (3 - 2 * fz);
    const n00 = hash(ix, iz), n10 = hash(ix + 1, iz), n01 = hash(ix, iz + 1), n11 = hash(ix + 1, iz + 1);
    return (n00 + (n10 - n00) * sxf) + ((n01 + (n11 - n01) * sxf) - (n00 + (n10 - n00) * sxf)) * szf;
  };
}

function generateHeightmap(seed: number, cols: number, rows: number): number[][] {
  const noise = makeNoise(seed);
  const hm: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      let h = noise(c, r, 10) * 5;          // hills
      h += noise(c + 100, r + 100, 20) * 2;  // detail
      h += noise(c + 200, r + 200, 5) * 3;   // large
      row.push(h);
    }
    hm.push(row);
  }
  return hm;
}

function heightColor(h: number, minH: number, maxH: number): [number, number, number] {
  const t = (maxH - minH) > 0 ? (h - minH) / (maxH - minH) : 0.5;
  if (t < 0.15) return [0.12, 0.22, 0.45];   // deep water
  if (t < 0.25) return [0.18, 0.35, 0.55];   // shallow water
  if (t < 0.35) return [0.55, 0.50, 0.30];   // sand/beach
  if (t < 0.55) return [0.22, 0.38, 0.15];   // grass
  if (t < 0.75) return [0.28, 0.30, 0.18];   // dark grass
  if (t < 0.90) return [0.38, 0.35, 0.30];   // rock
  return [0.65, 0.62, 0.58];                   // snow/peak
}

export async function createTerrainScene(
  scene: Scene,
  onStats: StatsFn,
  content: HTMLElement
): Promise<LabScene> {
  const meshes: Mesh[] = [];
  let seed = 42;
  let cols = 80;
  let rows = 60;

  function rebuild() {
    meshes.forEach(m => m.dispose());
    meshes.length = 0;

    const hm = generateHeightmap(seed, cols, rows);
    const { minH, maxH } = computeHeightRange(hm);

    // build ground mesh
    const mesh = new Mesh('terrain', scene);
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const cellSize = 0.25;
    const offX = (cols * cellSize) / 2;
    const offZ = (rows * cellSize) / 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cellSize - offX;
        const z = r * cellSize - offZ;
        const y = hm[r]![c]!;
        positions.push(x, y, z);
        const [cr, cg, cb] = heightColor(y, minH, maxH);
        colors.push(cr, cg, cb, 1);
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }

    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = colors;
    vd.applyToMesh(mesh, false);
    mesh.convertToFlatShadedMesh();

    const mat = new StandardMaterial('terrain-mat', scene);
    mat.diffuseColor = new Color3(0.82, 0.82, 0.82);
    mat.specularColor = new Color3(0.02, 0.02, 0.02);
    mesh.material = mat;
    mesh.position.y = -2;
    meshes.push(mesh);

    // water plane
    const waterLevel = minH + (maxH - minH) * 0.22;
    if (waterLevel > minH) {
      const waterPlane = Mesh.CreateGround('water', cols * cellSize, rows * cellSize, 1, scene);
      const wmat = new StandardMaterial('water-mat', scene);
      wmat.diffuseColor = new Color3(0.12, 0.28, 0.50);
      wmat.alpha = 0.45;
      waterPlane.material = wmat;
      waterPlane.position.y = waterLevel - 2;
      meshes.push(waterPlane);
    }

    const triCount = indices.length / 3;
    onStats(triCount, cols * rows, `terrain ${cols}×${rows} seed=${seed}`);
  }

  content.innerHTML = `
    <label>Grid <code id="tr-grid">80×60</code></label>
    <input type="range" id="tr-size" min="20" max="120" value="80" step="1">
    <label>Seed <code id="tr-seed-label">42</code></label>
    <input type="range" id="tr-seed" min="1" max="500" value="42" step="1">
    <button id="tr-random" style="width:100%;padding:5px 10px;cursor:pointer;margin-top:4px">Random Seed</button>
  `;

  const sizeSlider = document.getElementById('tr-size') as HTMLInputElement;
  const seedSlider = document.getElementById('tr-seed') as HTMLInputElement;

  sizeSlider.oninput = () => {
    cols = +sizeSlider.value;
    rows = Math.round(cols * 0.75);
    document.getElementById('tr-grid')!.textContent = `${cols}×${rows}`;
    rebuild();
  };
  seedSlider.oninput = () => {
    seed = +seedSlider.value;
    document.getElementById('tr-seed-label')!.textContent = String(seed);
    rebuild();
  };
  document.getElementById('tr-random')!.onclick = () => {
    seed = Math.floor(Math.random() * 500) + 1;
    seedSlider.value = String(seed);
    document.getElementById('tr-seed-label')!.textContent = String(seed);
    rebuild();
  };

  rebuild();

  return {
    dispose() { meshes.forEach(m => m.dispose()); }
  };
}
