export type Vec3Tuple = [number, number, number];
export type RgbTuple = [number, number, number];

export interface SceneTransformSpec {
  position?: Vec3Tuple;
  /** Euler rotation in radians, XYZ order. */
  rotation?: Vec3Tuple;
  scale?: Vec3Tuple;
}

export interface TerrainAnchorSpec {
  /** Place the node origin at the sampled world-space terrain height plus offset. */
  offset?: number;
}

export type ScenePrimitiveSpec =
  | { kind: 'box'; size: Vec3Tuple }
  | { kind: 'cylinder'; diameter: number; height: number; tessellation?: number }
  | { kind: 'cone'; diameter: number; height: number; tessellation?: number }
  | { kind: 'torus'; diameter: number; thickness: number; tessellation?: number }
  | { kind: 'icosphere'; diameter: number; subdivisions?: number }
  | { kind: 'plane'; size: [number, number] };

export interface SceneMaterialSpec {
  id: string;
  baseColor: RgbTuple;
  roughness: number;
  ambientStrength?: number;
  metallic?: number;
  emissiveColor?: RgbTuple;
  emissiveStrength?: number;
  alpha?: number;
  /** Deterministic multi-frequency height texture used as a bump channel. */
  surfaceNoise?: {
    scale: number;
    strength: number;
    seed?: number;
  };
}

export type SceneColliderSpec =
  | { kind: 'box'; size: Vec3Tuple; navBlocking?: boolean }
  | { kind: 'cylinder'; diameter: number; height: number; navBlocking?: boolean }
  | { kind: 'sphere'; diameter: number; navBlocking?: boolean };

export interface SceneNodeSpec {
  id: string;
  parent?: string;
  transform?: SceneTransformSpec;
  terrainAnchor?: TerrainAnchorSpec;
  primitive?: ScenePrimitiveSpec;
  material?: string;
  tags?: string[];
  socketId?: string;
  collider?: SceneColliderSpec;
  destructionGroup?: string;
}

export interface OrbitalCubesEmitterSpec {
  id: string;
  kind: 'orbital-cubes';
  parent?: string;
  position: Vec3Tuple;
  colors: RgbTuple[];
  count: number;
  radius: number;
  verticalRadius: number;
  cubeSize: number;
  angularSpeed: number;
  seed: number;
  emissiveStrength?: number;
  /** Optional spell volume; orbital remains the default. */
  shape?: 'orbital' | 'vortex' | 'orb';
  height?: number;
  innerRadius?: number;
}

export interface PointGlowEmitterSpec {
  id: string;
  kind: 'point-glow';
  parent?: string;
  position: Vec3Tuple;
  color: RgbTuple;
  intensity: number;
  range: number;
}

export type SceneEmitterSpec = OrbitalCubesEmitterSpec | PointGlowEmitterSpec;

export interface SceneQualityContract {
  targetStyle: string;
  criticalFeatures: string[];
  failureModes: string[];
  requiredViews: string[];
}

export interface SceneBudgetSpec {
  maxNodes: number;
  maxEstimatedTriangles: number;
  maxEmitters: number;
  maxAnimatedInstances: number;
}

export interface SceneKitSpec {
  formatVersion: 1;
  name: string;
  materials: SceneMaterialSpec[];
  nodes: SceneNodeSpec[];
  emitters: SceneEmitterSpec[];
  budget: SceneBudgetSpec;
  quality: SceneQualityContract;
}

export interface SceneKitMetrics {
  nodes: number;
  renderNodes: number;
  colliders: number;
  sockets: number;
  emitters: number;
  animatedInstances: number;
  estimatedTriangles: number;
}

export interface SceneKitValidationError {
  path: string;
  message: string;
}

export interface SceneGridSpec {
  cols: number;
  rows: number;
  cellSize: number;
}

export interface SceneKitPlacement {
  position?: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale?: Vec3Tuple;
}

export interface NavCell {
  col: number;
  row: number;
}

export type SceneKitValidationResult =
  | { ok: true; metrics: SceneKitMetrics }
  | { ok: false; metrics: SceneKitMetrics; errors: SceneKitValidationError[] };
