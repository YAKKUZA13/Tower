import {Engine,
        Scene,
        ArcRotateCamera,
        HemisphericLight, 
        MeshBuilder, 
        StandardMaterial, 
        Color3, 
        Vector3, 
        TransformNode, 
        LinesMesh, 
        VertexData, 
        VertexBuffer, 
        RawTexture, 
        ShaderMaterial, 
        Effect, 
        Constants, 
        Texture, 
        Vector2 } from 'babylonjs';

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

const HEIGHTMAP_TEXEL_SCALE = 2;
const MAX_HEIGHTMAP_TEX_SIZE = 512;

function getHeightmapSize(heightmap, grid) {
  const rows = Array.isArray(heightmap) && heightmap.length ? heightmap.length : grid.rows;
  const cols = Array.isArray(heightmap?.[0]) && heightmap[0].length ? heightmap[0].length : grid.cols;
  return { rows, cols };
}

function getHeightmapTextureResolution(heightmap, grid) {
  const { rows, cols } = getHeightmapSize(heightmap, grid);
  const targetRows = Math.min(MAX_HEIGHTMAP_TEX_SIZE, Math.max(1, rows * HEIGHTMAP_TEXEL_SCALE));
  const targetCols = Math.min(MAX_HEIGHTMAP_TEX_SIZE, Math.max(1, cols * HEIGHTMAP_TEXEL_SCALE));
  return { rows: targetRows, cols: targetCols, srcRows: rows, srcCols: cols };
}

function sampleHeightmapBilinear(heightmap, row, col, maxRow, maxCol) {
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

function computeHeightRange(heightmap) {
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
  return { minH, maxH };
}

function pickHeightmapTextureType(engine) {
  const caps = engine.getCaps?.() || {};
  if (caps.textureFloat && caps.textureFloatLinearFiltering) return Constants.TEXTURETYPE_FLOAT;
  return Constants.TEXTURETYPE_UNSIGNED_BYTE;
}

function buildHeightmapTextureData(heightmap, grid, type) {
  const { rows, cols, srcRows, srcCols } = getHeightmapTextureResolution(heightmap, grid);
  const { minH, maxH } = computeHeightRange(heightmap);
  const range = Math.max(1e-6, maxH - minH);
  const count = rows * cols * 4;
  const isFloat = type === Constants.TEXTURETYPE_FLOAT;
  const data = isFloat ? new Float32Array(count) : new Uint8Array(count);
  const maxRow = Math.max(0, srcRows - 1);
  const maxCol = Math.max(0, srcCols - 1);
  for (let r = 0; r < rows; r++) {
    const v = rows > 1 ? r / (rows - 1) : 0;
    const srcRow = v * maxRow;
    for (let c = 0; c < cols; c++) {
      const u = cols > 1 ? c / (cols - 1) : 0;
      const srcCol = u * maxCol;
      const raw = sampleHeightmapBilinear(heightmap, srcRow, srcCol, maxRow, maxCol);
      const t = clamp01((raw - minH) / range);
      const idx = (r * cols + c) * 4;
      if (isFloat) {
        data[idx + 0] = t;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 1;
      } else {
        const v = Math.round(t * 255);
        data[idx + 0] = v;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 255;
      }
    }
  }
  return { data, rows, cols, minH, maxH, srcRows, srcCols };
}

function ensureTerrainShaders() {
  if (Effect.ShadersStore.terrainVertexShader) return;
  Effect.ShadersStore.terrainVertexShader = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    uniform vec2 groundSize;
    uniform vec2 heightmapSize;
    uniform vec2 heightStep;
    uniform sampler2D heightmapSampler;
    uniform float heightMin;
    uniform float heightMax;
    varying vec3 vNormal;
    varying float vHeight;
    vec2 worldToUv(vec2 worldXZ) {
      vec2 uv = worldXZ / groundSize + 0.5;
      return clamp(uv, vec2(0.0), vec2(1.0));
    }
    float sampleHeight(vec2 uv) {
      float h = texture2D(heightmapSampler, uv).r;
      return mix(heightMin, heightMax, h);
    }
    vec3 computeNormal(vec2 uv) {
      vec2 texel = vec2(1.0) / heightmapSize;
      float hL = sampleHeight(uv - vec2(texel.x, 0.0));
      float hR = sampleHeight(uv + vec2(texel.x, 0.0));
      float hD = sampleHeight(uv - vec2(0.0, texel.y));
      float hU = sampleHeight(uv + vec2(0.0, texel.y));
      float dhdx = (hR - hL) / (2.0 * heightStep.x);
      float dhdz = (hU - hD) / (2.0 * heightStep.y);
      return normalize(vec3(-dhdx, 1.0, -dhdz));
    }
    void main() {
      vec2 uv = worldToUv(position.xz);
      float h = sampleHeight(uv);
      vec3 displaced = vec3(position.x, h, position.z);
      vNormal = computeNormal(uv);
      vHeight = h;
      gl_Position = worldViewProjection * vec4(displaced, 1.0);
    }
  `;
  Effect.ShadersStore.terrainFragmentShader = `
    precision highp float;
    uniform vec3 lightDir;
    uniform vec3 lightSky;
    uniform vec3 lightGround;
    uniform float lightIntensity;
    uniform float heightMin;
    uniform float heightMax;
    varying vec3 vNormal;
    varying float vHeight;
    vec3 heightToColor(float height, float minH, float maxH) {
      float range = max(1e-3, maxH - minH);
      float t = clamp((height - minH) / range, 0.0, 1.0);
      if (t < 0.25) {
        float k = t / 0.25;
        return vec3(
          mix(0.10, 0.15, k),
          mix(0.12, 0.22, k),
          mix(0.08, 0.12, k)
        );
      } else if (t < 0.55) {
        float k = (t - 0.25) / 0.30;
        return vec3(
          mix(0.15, 0.35, k),
          mix(0.22, 0.65, k),
          mix(0.12, 0.30, k)
        );
      } else if (t < 0.8) {
        float k = (t - 0.55) / 0.25;
        return vec3(
          mix(0.35, 0.55, k),
          mix(0.40, 0.55, k),
          mix(0.30, 0.55, k)
        );
      }
      float k = (t - 0.8) / 0.2;
      return vec3(
        mix(0.55, 0.9, k),
        mix(0.55, 0.9, k),
        mix(0.55, 0.95, k)
      );
    }
    void main() {
      vec3 n = normalize(vNormal);
      vec3 l = normalize(lightDir);
      float hemi = dot(n, l) * 0.5 + 0.5;
      vec3 lightColor = mix(lightGround, lightSky, hemi);
      vec3 base = heightToColor(vHeight, heightMin, heightMax);
      vec3 color = base * lightColor * lightIntensity;
      gl_FragColor = vec4(color, 1.0);
    }
  `;
}

function createHeightmapTexture(scene, grid, heightmap) {
  const engine = scene.getEngine();
  const type = pickHeightmapTextureType(engine);
  const { data, rows, cols, minH, maxH, srcRows, srcCols } = buildHeightmapTextureData(heightmap, grid, type);
  const texture = new RawTexture(
    data,
    cols,
    rows,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    false,
    false,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
    type
  );
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return { texture, info: { rows, cols, minH, maxH, srcRows, srcCols, type } };
}

function createTerrainMaterial(scene, ground, grid, heightmap, light) {
  ensureTerrainShaders();
  const { texture, info } = createHeightmapTexture(scene, grid, heightmap);
  const material = new ShaderMaterial(
    'terrainMat',
    scene,
    { vertex: 'terrain', fragment: 'terrain' },
    {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'groundSize', 'heightmapSize', 'heightStep', 'heightMin', 'heightMax', 'lightDir', 'lightSky', 'lightGround', 'lightIntensity'],
      samplers: ['heightmapSampler']
    }
  );
  material.setTexture('heightmapSampler', texture);
  const boardWidth = grid.cols * grid.cellSize;
  const boardHeight = grid.rows * grid.cellSize;
  const stepX = boardWidth / Math.max(1, info.cols - 1);
  const stepY = boardHeight / Math.max(1, info.rows - 1);
  material.setVector2('groundSize', new Vector2(boardWidth, boardHeight));
  material.setVector2('heightmapSize', new Vector2(info.cols, info.rows));
  material.setVector2('heightStep', new Vector2(stepX, stepY));
  material.setFloat('heightMin', info.minH);
  material.setFloat('heightMax', info.maxH);
  const lightDir = light?.direction ? light.direction : new Vector3(0, 1, 0);
  const sky = light?.diffuse ? light.diffuse : new Color3(1, 1, 1);
  const groundCol = light?.groundColor ? light.groundColor : new Color3(0.4, 0.4, 0.4);
  material.setVector3('lightDir', lightDir);
  material.setVector3('lightSky', new Vector3(sky.r, sky.g, sky.b));
  material.setVector3('lightGround', new Vector3(groundCol.r, groundCol.g, groundCol.b));
  material.setFloat('lightIntensity', light?.intensity ?? 1);
  return { material, texture, info };
}

export function updateHeightmapTexture(ground, grid, heightmap = null) {
  if (!ground?.metadata?.terrain) return false;
  const terrain = ground.metadata.terrain;
  const engine = ground.getScene().getEngine();
  const type = terrain.info?.type ?? pickHeightmapTextureType(engine);
  const { data, rows, cols, minH, maxH, srcRows, srcCols } = buildHeightmapTextureData(heightmap, grid, type);
  if (rows !== terrain.info.rows || cols !== terrain.info.cols) {
    const newTexture = new RawTexture(
      data,
      cols,
      rows,
      Constants.TEXTUREFORMAT_RGBA,
      ground.getScene(),
      false,
      false,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      type
    );
    newTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
    newTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    terrain.texture = newTexture;
    terrain.material.setTexture('heightmapSampler', newTexture);
  } else {
    terrain.texture.update(data);
  }
  terrain.info = { rows, cols, minH, maxH, srcRows, srcCols, type };
  const boardWidth = grid.cols * grid.cellSize;
  const boardHeight = grid.rows * grid.cellSize;
  const stepX = boardWidth / Math.max(1, cols - 1);
  const stepY = boardHeight / Math.max(1, rows - 1);
  terrain.material.setVector2('heightmapSize', new Vector2(cols, rows));
  terrain.material.setVector2('heightStep', new Vector2(stepX, stepY));
  terrain.material.setFloat('heightMin', minH);
  terrain.material.setFloat('heightMax', maxH);
  return true;
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
  ground.metadata = { subdivisionsX, subdivisionsY, terrain: null };
  const terrain = createTerrainMaterial(scene, ground, grid, heightmap, light);
  ground.material = terrain.material;
  ground.metadata.terrain = terrain;

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

function applyHeightmapToGroundCpu(ground, grid, heightmap = null) {
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

export function applyHeightmapToGround(ground, grid, heightmap = null) {
  if (!ground) return;
  const handled = updateHeightmapTexture(ground, grid, heightmap);
  if (handled) return;
  applyHeightmapToGroundCpu(ground, grid, heightmap);
}
