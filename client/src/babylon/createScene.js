import { Engine, Scene, ArcRotateCamera, HemisphericLight, MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode, LinesMesh, VertexData, VertexBuffer } from 'babylonjs';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function heightToColor(height, minH, maxH) {
  const range = Math.max(1e-3, maxH - minH);
  const t = Math.max(0, Math.min(1, (height - minH) / range));
  // Gradient: low dark soil -> grass -> rocky -> snow
  if (t < 0.25) {
    const k = t / 0.25;
    return new Color3(
      lerp(0.10, 0.15, k),
      lerp(0.12, 0.22, k),
      lerp(0.08, 0.12, k)
    );
  } else if (t < 0.55) {
    const k = (t - 0.25) / 0.30;
    return new Color3(
      lerp(0.15, 0.35, k),
      lerp(0.22, 0.65, k),
      lerp(0.12, 0.30, k)
    );
  } else if (t < 0.8) {
    const k = (t - 0.55) / 0.25;
    return new Color3(
      lerp(0.35, 0.55, k),
      lerp(0.40, 0.55, k),
      lerp(0.30, 0.55, k)
    );
  }
  const k = (t - 0.8) / 0.2;
  return new Color3(
    lerp(0.55, 0.9, k),
    lerp(0.55, 0.9, k),
    lerp(0.55, 0.95, k)
  );
}

export function createEngine(canvas) {
  const engine = new Engine(canvas, true);
  window.addEventListener('resize', () => engine.resize());
  return engine;
}

export function createScene(engine, grid, heightmap = null) {
  const scene = new Scene(engine);

  const boardWidth = grid.cols * grid.cellSize;
  const boardHeight = grid.rows * grid.cellSize;
  const maxSpan = Math.max(boardWidth, boardHeight);
  const cameraDistance = Math.max(40, maxSpan * 1.4);
  const camera = new ArcRotateCamera('cam', Math.PI / 4, Math.PI / 3, cameraDistance, new Vector3(0, 0, 0), scene);
  camera.attachControl(engine.getRenderingCanvas(), true);

  const light = new HemisphericLight('light', new Vector3(0, 1, 0), scene);
  light.intensity = 0.9;

  const targetStep = 0.5; // ~0.5m detail
  const maxSubdiv = 512;
  const subdivisionsX = Math.min(maxSubdiv, Math.max(grid.cols, Math.round(boardWidth / targetStep)));
  const subdivisionsY = Math.min(maxSubdiv, Math.max(grid.rows, Math.round(boardHeight / targetStep)));
  const ground = MeshBuilder.CreateGround('ground', {
    width: boardWidth,
    height: boardHeight,
    subdivisionsX,
    subdivisionsY
  }, scene);
  ground.metadata = { subdivisionsX, subdivisionsY };
  const mat = new StandardMaterial('gridMat', scene);
  mat.diffuseColor = new Color3(0.9, 0.9, 0.9);
  mat.specularColor = new Color3(0.1, 0.1, 0.1);
  mat.specularPower = 32;
  mat.useSpecularOverAlpha = false;
  mat.alpha = 1;
  ground.material = mat;
  applyHeightmapToGround(ground, grid, heightmap);

  // Grid lines
  const halfW = (grid.cols * grid.cellSize) / 2;
  const halfH = (grid.rows * grid.cellSize) / 2;
  const lines = [];
  for (let c = 0; c <= grid.cols; c++) {
    const x = c * grid.cellSize - halfW;
    lines.push([
      new Vector3(x, 0.01, -halfH),
      new Vector3(x, 0.01, halfH)
    ]);
  }
  for (let r = 0; r <= grid.rows; r++) {
    const z = r * grid.cellSize - halfH;
    lines.push([
      new Vector3(-halfW, 0.01, z),
      new Vector3(halfW, 0.01, z)
    ]);
  }
  const gridLines = MeshBuilder.CreateLineSystem('grid-lines', { lines }, scene);
  const gridMat = new StandardMaterial('gridLinesMat', scene);
  gridMat.emissiveColor = new Color3(0.75, 0.75, 0.75);
  gridLines.color = new Color3(0.7, 0.7, 0.7);
  gridLines.alwaysSelectAsActiveMesh = true;

  const towersParent = new TransformNode('towers', scene);

  return { scene, camera, light, ground, towersParent };
}

export function gridToWorld(grid, col, row) {
  const x = (col + 0.5) * grid.cellSize - (grid.cols * grid.cellSize) / 2;
  const z = (row + 0.5) * grid.cellSize - (grid.rows * grid.cellSize) / 2;
  return new Vector3(x, 0, z);
}

export function sampleHeight(heightmap, grid, col, row, bilinear = false) {
  const maxRow = Math.max(0, grid.rows - 1);
  const maxCol = Math.max(0, grid.cols - 1);
  if (!bilinear) {
    const rIdx = Math.max(0, Math.min(maxRow, Math.round(row)));
    const cIdx = Math.max(0, Math.min(maxCol, Math.round(col)));
    const val = Number(heightmap?.[rIdx]?.[cIdx]);
    return Number.isFinite(val) ? val : 0;
  }
  const clampedRow = Math.max(0, Math.min(maxRow, row));
  const clampedCol = Math.max(0, Math.min(maxCol, col));
  const r0 = Math.floor(clampedRow);
  const r1 = Math.min(maxRow, Math.ceil(clampedRow));
  const c0 = Math.floor(clampedCol);
  const c1 = Math.min(maxCol, Math.ceil(clampedCol));
  const fr = clampedRow - r0;
  const fc = clampedCol - c0;
  const h00 = Number(heightmap?.[r0]?.[c0]) || 0;
  const h10 = Number(heightmap?.[r1]?.[c0]) || 0;
  const h01 = Number(heightmap?.[r0]?.[c1]) || 0;
  const h11 = Number(heightmap?.[r1]?.[c1]) || 0;
  const h0 = h00 * (1 - fc) + h01 * fc;
  const h1 = h10 * (1 - fc) + h11 * fc;
  return h0 * (1 - fr) + h1 * fr;
}

export function addTower(scene, grid, { id, col, row, level }, heightmap = null) {
  const pos = gridToWorld(grid, col, row);
  const baseHeight = sampleHeight(heightmap, grid, col, row, true);
  const mesh = MeshBuilder.CreateCylinder(`tower-${id}` , { diameter: grid.cellSize * 0.7, height: 2 + level * 0.2 }, scene);
  mesh.position = pos.add(new Vector3(0, baseHeight + (2 + level * 0.2) / 2, 0));
  const mat = new StandardMaterial(`towerMat-${id}`, scene);
  mat.diffuseColor = new Color3(0.2, 0.6, 0.9);
  mesh.material = mat;
  return mesh;
}

export function addBuilding(scene, grid, b, heightmap = null) {
  const width = (b?.size?.w || 1) * grid.cellSize;
  const depth = (b?.size?.h || 1) * grid.cellSize;
  const height = Math.max(0.1, Number(b?.height || 2));
  const centerCol = b.col + (b?.size?.w || 1) / 2 - 0.5;
  const centerRow = b.row + (b?.size?.h || 1) / 2 - 0.5;
  const pos = gridToWorld(grid, centerCol, centerRow);
  const groundHeight = sampleHeight(heightmap, grid, centerCol, centerRow, true);
  const mesh = MeshBuilder.CreateBox(`building-${b.id}`, { width, height, depth }, scene);
  mesh.position = pos.add(new Vector3(0, groundHeight + height / 2, 0));
  const mat = new StandardMaterial(`buildingMat-${b.id}`, scene);
  const color = b?.color || { r: 0.6, g: 0.6, b: 0.6 };
  mat.diffuseColor = new Color3(color.r, color.g, color.b);
  mesh.material = mat;
  return mesh;
}

export function makePreviewMesh(scene, grid) {
  const mesh = MeshBuilder.CreateBox('preview', { width: grid.cellSize, height: 1, depth: grid.cellSize }, scene);
  const mat = new StandardMaterial('previewMat', scene);
  mat.alpha = 0.4;
  mat.diffuseColor = new Color3(0.2, 0.8, 0.2);
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

export function updatePreviewMesh(previewMesh, grid, b, valid, heightmap = null) {
  const width = (b?.size?.w || 1) * grid.cellSize;
  const depth = (b?.size?.h || 1) * grid.cellSize;
  const height = Math.max(0.1, Number(b?.height || 1));
  previewMesh.scaling = new Vector3(width / grid.cellSize, height, depth / grid.cellSize);
  const centerCol = b.col + (b?.size?.w || 1) / 2 - 0.5;
  const centerRow = b.row + (b?.size?.h || 1) / 2 - 0.5;
  const pos = gridToWorld(grid, centerCol, centerRow);
  const groundHeight = sampleHeight(heightmap, grid, centerCol, centerRow, true);
  previewMesh.position = pos.add(new Vector3(0, groundHeight + height / 2, 0));
  const mat = previewMesh.material;
  if (mat && mat.diffuseColor) {
    mat.diffuseColor = valid ? new Color3(0.2, 0.8, 0.2) : new Color3(0.9, 0.2, 0.2);
  }
  previewMesh.setEnabled(true);
}

export function drawPath(scene, grid, waypoints, heightmap = null) {
  // Remove old path meshes
  scene.meshes.filter(m => m.name.startsWith('path-cell-') || m.name === 'path-lines').forEach(m => m.dispose());
  if (!Array.isArray(waypoints) || waypoints.length === 0) return;

  // Build list of grid cells along orthogonal segments between waypoints
  const cells = [];
  for (let i = 0; i < waypoints.length; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    cells.push({ col: a.col, row: a.row });
    if (!b) break;
    const dCol = Math.sign(b.col - a.col);
    const dRow = Math.sign(b.row - a.row);
    // move horizontally then vertically (Manhattan)
    for (let c = a.col + dCol; c !== b.col + dCol && dCol !== 0; c += dCol) {
      cells.push({ col: c, row: a.row });
    }
    for (let r = a.row + dRow; r !== b.row + dRow && dRow !== 0; r += dRow) {
      cells.push({ col: b.col, row: r });
    }
  }

  // Unique cells
  const keySet = new Set();
  const unique = [];
  for (const c of cells) {
    const k = `${c.col}:${c.row}`;
    if (!keySet.has(k)) { keySet.add(k); unique.push(c); }
  }

  // Draw semi-transparent tiles on path cells
  for (const c of unique) {
    const pos = gridToWorld(grid, c.col, c.row);
    const groundHeight = sampleHeight(heightmap, grid, c.col, c.row, true);
    const tile = MeshBuilder.CreateGround(`path-cell-${c.col}-${c.row}`, { width: grid.cellSize, height: grid.cellSize }, scene);
    tile.position = pos.add(new Vector3(0, groundHeight + 0.02, 0));
    const mat = new StandardMaterial(`pathMat-${c.col}-${c.row}`, scene);
    mat.alpha = 0.5;
    mat.diffuseColor = new Color3(0.95, 0.8, 0.2);
    tile.material = mat;
    tile.isPickable = false;
  }

  // Optional lines between waypoints
  const segments = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = gridToWorld(grid, waypoints[i].col, waypoints[i].row);
    const b = gridToWorld(grid, waypoints[i + 1].col, waypoints[i + 1].row);
    a.y = sampleHeight(heightmap, grid, waypoints[i].col, waypoints[i].row, true) + 0.03;
    b.y = sampleHeight(heightmap, grid, waypoints[i + 1].col, waypoints[i + 1].row, true) + 0.03;
    segments.push([a, b]);
  }
  if (segments.length) {
    const ls = MeshBuilder.CreateLineSystem('path-lines', { lines: segments }, scene);
    ls.color = new Color3(0.95, 0.6, 0.1);
    ls.isPickable = false;
  }
}

export function pickGrid(scene, grid) {
  const pick = scene.pick(scene.pointerX, scene.pointerY);
  if (!pick?.pickedPoint) return null;
  const p = pick.pickedPoint;
  const x = p.x + (grid.cols * grid.cellSize) / 2;
  const z = p.z + (grid.rows * grid.cellSize) / 2;
  const col = Math.floor(x / grid.cellSize);
  const row = Math.floor(z / grid.cellSize);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
  return { col, row };
}

export function applyHeightmapToGround(ground, grid, heightmap = null) {
  if (!ground) return;
  const positions = ground.getVerticesData(VertexBuffer.PositionKind);
  const indices = ground.getIndices();
  if (!positions || !indices) return;
  // Find height range for coloring
  let minH = Infinity;
  let maxH = -Infinity;
  if (Array.isArray(heightmap)) {
    for (let r = 0; r < heightmap.length; r++) {
      const row = heightmap[r];
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < row.length; c++) {
        const v = Number(row[c]);
        if (!Number.isFinite(v)) continue;
        if (v < minH) minH = v;
        if (v > maxH) maxH = v;
      }
    }
  }
  if (minH === Infinity || maxH === -Infinity) {
    minH = 0;
    maxH = 1;
  } else if (minH === maxH) {
    maxH = minH + 1;
  }
  const subdivX = ground.metadata?.subdivisionsX ?? grid.cols;
  const subdivY = ground.metadata?.subdivisionsY ?? grid.rows;
  const stride = subdivX + 1;
  const colors = new Array((stride) * (subdivY + 1) * 4);
  for (let r = 0; r <= subdivY; r++) {
    for (let c = 0; c <= subdivX; c++) {
      const idx = (r * stride + c) * 3;
      const col = (c / subdivX) * grid.cols;
      const row = (r / subdivY) * grid.rows;
      const h = sampleHeight(heightmap, grid, col, row, true);
      positions[idx + 1] = h;
      const color = heightToColor(h, minH, maxH);
      const ci = (r * stride + c) * 4;
      colors[ci + 0] = color.r;
      colors[ci + 1] = color.g;
      colors[ci + 2] = color.b;
      colors[ci + 3] = 1;
    }
  }
  ground.updateVerticesData(VertexBuffer.PositionKind, positions);
  ground.setVerticesData(VertexBuffer.ColorKind, colors, false);
  const normals = [];
  VertexData.ComputeNormals(positions, indices, normals);
  ground.updateVerticesData(VertexBuffer.NormalKind, normals);
  ground.refreshBoundingInfo();
}
