export * from './area-effects.js';
import type {
  RgbTuple,
  SceneColliderSpec,
  SceneKitMetrics,
  SceneKitSpec,
  SceneMaterialSpec,
  ScenePrimitiveSpec,
  Vec3Tuple
} from '@tower/engine-scene';
import { validateSceneKit } from '@tower/engine-scene';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import '@babylonjs/core/Shaders/default.vertex.js';
import '@babylonjs/core/Shaders/default.fragment.js';
import '@babylonjs/core/Shaders/pbr.vertex.js';
import '@babylonjs/core/Shaders/pbr.fragment.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Nullable } from '@babylonjs/core/types.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Scene } from '@babylonjs/core/scene.js';

export interface BuildSceneKitOptions {
  position?: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale?: Vec3Tuple;
  /** Injectable clock for deterministic captures and editor previews. */
  timeSeconds?: () => number;
  /** World-space terrain sampler used by nodes with terrainAnchor metadata. */
  terrainHeightAt?: (worldX: number, worldZ: number) => number;
}

export interface BuiltCollider {
  nodeId: string;
  node: TransformNode;
  spec: SceneColliderSpec;
}

export interface SceneKitHandle {
  root: TransformNode;
  nodes: ReadonlyMap<string, TransformNode>;
  meshes: ReadonlyMap<string, InstancedMesh>;
  sockets: ReadonlyMap<string, TransformNode>;
  colliders: readonly BuiltCollider[];
  destructionGroups: ReadonlyMap<string, readonly TransformNode[]>;
  shadowCasters: readonly Mesh[];
  metrics: SceneKitMetrics;
  dispose(): void;
}

function color(tuple: RgbTuple, strength = 1): Color3 {
  return new Color3(tuple[0] * strength, tuple[1] * strength, tuple[2] * strength);
}

function setTransform(node: TransformNode, transform: { position?: Vec3Tuple; rotation?: Vec3Tuple; scale?: Vec3Tuple } = {}): void {
  if (transform.position) node.position.set(...transform.position);
  if (transform.rotation) node.rotation.set(...transform.rotation);
  if (transform.scale) node.scaling.set(...transform.scale);
}

function materialKey(primitive: ScenePrimitiveSpec, materialId: string): string {
  switch (primitive.kind) {
    case 'box': return `box:${materialId}`;
    case 'plane': return `plane:${materialId}`;
    case 'cylinder': return `cylinder:${primitive.tessellation ?? 12}:${materialId}`;
    case 'cone': return `cone:${primitive.tessellation ?? 12}:${materialId}`;
    case 'icosphere': return `icosphere:${primitive.subdivisions ?? 1}:${materialId}`;
    case 'torus': return `torus:${primitive.tessellation ?? 24}:${(primitive.thickness / primitive.diameter).toFixed(5)}:${materialId}`;
  }
}

function createMaster(key: string, primitive: ScenePrimitiveSpec, material: Material, scene: Scene): Mesh {
  let mesh: Mesh;
  switch (primitive.kind) {
    case 'box': mesh = MeshBuilder.CreateBox(`scene-master:${key}`, { size: 1 }, scene); break;
    case 'plane': mesh = MeshBuilder.CreatePlane(`scene-master:${key}`, { size: 1 }, scene); break;
    case 'cylinder':
      mesh = MeshBuilder.CreateCylinder(`scene-master:${key}`, { diameter: 1, height: 1, tessellation: primitive.tessellation ?? 12 }, scene);
      break;
    case 'cone':
      mesh = MeshBuilder.CreateCylinder(`scene-master:${key}`, {
        diameterTop: 0,
        diameterBottom: 1,
        height: 1,
        tessellation: primitive.tessellation ?? 12
      }, scene);
      break;
    case 'icosphere':
      mesh = MeshBuilder.CreateIcoSphere(`scene-master:${key}`, { radius: 0.5, subdivisions: primitive.subdivisions ?? 1 }, scene);
      break;
    case 'torus':
      mesh = MeshBuilder.CreateTorus(`scene-master:${key}`, {
        diameter: 1,
        thickness: primitive.thickness / primitive.diameter,
        tessellation: primitive.tessellation ?? 24
      }, scene);
      break;
  }
  mesh.material = material;
  mesh.isVisible = false;
  mesh.isPickable = false;
  return mesh;
}

function scaleInstance(mesh: InstancedMesh, primitive: ScenePrimitiveSpec): void {
  switch (primitive.kind) {
    case 'box': mesh.scaling.set(...primitive.size); break;
    case 'plane': mesh.scaling.set(primitive.size[0], primitive.size[1], 1); break;
    case 'cylinder': mesh.scaling.set(primitive.diameter, primitive.height, primitive.diameter); break;
    case 'cone': mesh.scaling.set(primitive.diameter, primitive.height, primitive.diameter); break;
    case 'icosphere': mesh.scaling.setAll(primitive.diameter); break;
    case 'torus': mesh.scaling.setAll(primitive.diameter); break;
  }
}

function hash01(seed: number): number {
  let value = seed | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function makeSurfaceNoise(size: number, seed: number): Uint8Array {
  const data = new Uint8Array(size * size);
  const sample = (x: number, y: number, salt: number): number => hash01(
    seed ^ salt ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663)
  );
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const macro = sample(Math.floor(x / 8), Math.floor(y / 8), 0x68bc21eb);
      const meso = sample(Math.floor(x / 3), Math.floor(y / 3), 0x02e5be93);
      const micro = sample(x, y, 0x7f4a7c15);
      data[y * size + x] = Math.round(56 + (macro * 0.5 + meso * 0.34 + micro * 0.16) * 184);
    }
  }
  return data;
}

function parentsFirst(spec: SceneKitSpec): SceneKitSpec['nodes'] {
  const byId = new Map(spec.nodes.map((node) => [node.id, node]));
  const depths = new Map<string, number>();
  const depth = (id: string): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id)!;
    const value = node.parent ? depth(node.parent) + 1 : 0;
    depths.set(id, value);
    return value;
  };
  return [...spec.nodes].sort((a, b) => depth(a.id) - depth(b.id));
}

/** Builds one validated, disposable hybrid scene-kit instance. */
export function buildSceneKit(scene: Scene, spec: SceneKitSpec, options: BuildSceneKitOptions = {}): SceneKitHandle {
  const validation = validateSceneKit(spec);
  if (!validation.ok) {
    throw new Error(`Invalid scene kit '${spec.name}': ${validation.errors.map((error) => `${error.path} ${error.message}`).join('; ')}`);
  }

  const root = new TransformNode(`scene-kit:${spec.name}`, scene);
  setTransform(root, options);
  const nodes = new Map<string, TransformNode>();
  const meshes = new Map<string, InstancedMesh>();
  const sockets = new Map<string, TransformNode>();
  const colliders: BuiltCollider[] = [];
  const destructionGroups = new Map<string, TransformNode[]>();
  const masters = new Map<string, Mesh>();
  const materials = new Map<string, Material>();
  const surfaceTextures: RawTexture[] = [];
  const shadowCasters = new Set<Mesh>();
  const lights: PointLight[] = [];
  const orbitMeshes: Mesh[] = [];
  const observers: Array<Nullable<Observer<Scene>>> = [];

  for (const definition of spec.materials) {
    const instance = new PBRMaterial(`scene-material:${spec.name}:${definition.id}`, scene);
    instance.albedoColor = color(definition.baseColor);
    instance.ambientColor = color(definition.baseColor, definition.ambientStrength ?? 0);
    instance.environmentIntensity = definition.ambientStrength ?? 1;
    instance.metallic = definition.metallic ?? 0;
    instance.roughness = definition.roughness;
    instance.maxSimultaneousLights = 8;
    instance.alpha = definition.alpha ?? 1;
    if (definition.emissiveColor) {
      instance.emissiveColor = color(definition.emissiveColor);
      instance.emissiveIntensity = definition.emissiveStrength ?? 1;
    }
    if (definition.surfaceNoise) {
      const texture = RawTexture.CreateLuminanceTexture(
        makeSurfaceNoise(64, definition.surfaceNoise.seed ?? 0x51a7c7),
        64, 64, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE
      );
      texture.name = `scene-surface-noise:${spec.name}:${definition.id}`;
      texture.uScale = definition.surfaceNoise.scale;
      texture.vScale = definition.surfaceNoise.scale;
      texture.level = definition.surfaceNoise.strength;
      instance.bumpTexture = texture;
      surfaceTextures.push(texture);
    }
    materials.set(definition.id, instance);
  }

  // Allocate logical nodes first so declaration order never constrains hierarchy.
  for (const definition of spec.nodes) {
    const node = new TransformNode(`scene-node:${spec.name}:${definition.id}`, scene);
    setTransform(node, definition.transform);
    node.metadata = { sceneKit: spec.name, sceneNodeId: definition.id, tags: definition.tags ?? [] };
    nodes.set(definition.id, node);
  }

  for (const definition of spec.nodes) {
    const node = nodes.get(definition.id)!;
    node.parent = definition.parent ? nodes.get(definition.parent)! : root;
    if (definition.socketId) sockets.set(definition.socketId, node);
    if (definition.collider) colliders.push({ nodeId: definition.id, node, spec: definition.collider });
    if (definition.destructionGroup) {
      const group = destructionGroups.get(definition.destructionGroup) ?? [];
      group.push(node);
      destructionGroups.set(definition.destructionGroup, group);
    }
    if (!definition.primitive || !definition.material) continue;

    const key = materialKey(definition.primitive, definition.material);
    let master = masters.get(key);
    if (!master) {
      master = createMaster(key, definition.primitive, materials.get(definition.material)!, scene);
      masters.set(key, master);
    }
    const mesh = master.createInstance(`scene-mesh:${spec.name}:${definition.id}`);
    mesh.parent = node;
    scaleInstance(mesh, definition.primitive);
    mesh.isPickable = false;
    if (definition.tags?.includes('receives-shadows')) master.receiveShadows = true;
    meshes.set(definition.id, mesh);
    if (definition.tags?.includes('casts-shadows')) shadowCasters.add(master);
  }

  if (options.terrainHeightAt) {
    root.computeWorldMatrix(true);
    // Validation permits declaration-order-independent hierarchies, so terrain
    // anchoring must explicitly settle parents before their descendants.
    for (const definition of parentsFirst(spec)) {
      if (!definition.terrainAnchor) continue;
      const node = nodes.get(definition.id)!;
      node.computeWorldMatrix(true);
      const absolute = node.getAbsolutePosition();
      const terrainY = options.terrainHeightAt(absolute.x, absolute.z);
      node.setAbsolutePosition(new Vector3(absolute.x, terrainY + (definition.terrainAnchor.offset ?? 0), absolute.z));
      node.computeWorldMatrix(true);
    }
  }

  for (const emitter of spec.emitters) {
    const parent = emitter.parent ? nodes.get(emitter.parent)! : root;
    if (emitter.kind === 'point-glow') {
      const light = new PointLight(`scene-light:${spec.name}:${emitter.id}`, new Vector3(...emitter.position), scene);
      light.parent = parent;
      light.diffuse = color(emitter.color);
      light.specular = color(emitter.color, 0.35);
      light.intensity = emitter.intensity;
      light.range = emitter.range;
      lights.push(light);
      continue;
    }

    const paletteBuckets = emitter.colors.map(() => [] as number[]);
    for (let index = 0; index < emitter.count; index++) paletteBuckets[index % emitter.colors.length]!.push(index);
    paletteBuckets.forEach((indices, paletteIndex) => {
      if (indices.length === 0) return;
      const definition: SceneMaterialSpec = {
        id: `${emitter.id}:${paletteIndex}`,
        baseColor: emitter.colors[paletteIndex]!, roughness: 0.25,
        emissiveColor: emitter.colors[paletteIndex]!, emissiveStrength: emitter.emissiveStrength ?? 2.1
      };
      const orbitMaterial = new StandardMaterial(`scene-material:${spec.name}:${definition.id}`, scene);
      orbitMaterial.diffuseColor = color(definition.baseColor);
      orbitMaterial.emissiveColor = color(definition.emissiveColor!, definition.emissiveStrength);
      orbitMaterial.specularColor = Color3.Black();
      materials.set(definition.id, orbitMaterial);
      const orbit = MeshBuilder.CreateBox(`scene-emitter:${spec.name}:${emitter.id}:${paletteIndex}`, { size: emitter.cubeSize }, scene);
      orbit.parent = parent;
      orbit.material = orbitMaterial;
      orbit.isPickable = false;
      orbit.alwaysSelectAsActiveMesh = true;
      const matrices = new Float32Array(indices.length * 16);
      const nowSeconds = options.timeSeconds ?? (() => performance.now() / 1000);
      const startedAt = nowSeconds();
      const update = (): void => {
        const time = nowSeconds() - startedAt;
        indices.forEach((particleIndex, localIndex) => {
          const phase = hash01(emitter.seed + particleIndex * 7919) * Math.PI * 2;
          const band01 = hash01(emitter.seed ^ (particleIndex * 104729));
          const band = band01 * 2 - 1;
          const angular = phase + time * emitter.angularSpeed * (0.65 + hash01(particleIndex + emitter.seed) * 0.7);
          const isVortex = emitter.shape === 'vortex';
          const isOrb = emitter.shape === 'orb';
          const heightT = hash01(emitter.seed + particleIndex * 15485863);
          const shellNoise = hash01(emitter.seed + particleIndex * 32452843);
          const radius = isVortex
            ? (emitter.innerRadius ?? emitter.radius * 0.12) + emitter.radius * (0.18 + heightT * 0.82) * (0.72 + hash01(emitter.seed + particleIndex * 31) * 0.28)
            : isOrb
              ? (emitter.innerRadius ?? emitter.radius * 0.7) + (emitter.radius - (emitter.innerRadius ?? emitter.radius * 0.7)) * shellNoise
            : emitter.radius * (0.35 + hash01(emitter.seed + particleIndex * 31) * 0.65);
          const vortexAngle = angular + (isVortex ? heightT * Math.PI * 3.4 : 0);
          const sphereY = 1 - heightT * 2;
          const spherePlanar = Math.sqrt(Math.max(0, 1 - sphereY * sphereY));
          const x = emitter.position[0] + Math.cos(vortexAngle) * radius * (isOrb ? spherePlanar : 1);
          const y = isVortex
            ? emitter.position[1] + (heightT - 0.5) * (emitter.height ?? emitter.verticalRadius * 2) + Math.sin(phase + time) * emitter.verticalRadius * 0.08
            : isOrb
              ? emitter.position[1] + sphereY * emitter.verticalRadius * (0.88 + shellNoise * 0.12)
            : emitter.position[1] + Math.sin(phase * 1.7 + time * 0.7) * emitter.verticalRadius * (0.35 + Math.abs(band) * 0.65);
          const z = emitter.position[2] + Math.sin(vortexAngle) * radius * (isOrb ? spherePlanar : 1);
          const offset = localIndex * 16;
          matrices[offset + 12] = x;
          matrices[offset + 13] = y;
          matrices[offset + 14] = z;
        });
        orbit.thinInstanceBufferUpdated('matrix');
      };
      // Seed the matrix buffer before the first frame, then mutate it in place.
      for (let i = 0; i < indices.length; i++) {
        const offset = i * 16;
        matrices[offset] = 1;
        matrices[offset + 5] = 1;
        matrices[offset + 10] = 1;
        matrices[offset + 15] = 1;
      }
      orbit.thinInstanceSetBuffer('matrix', matrices, 16, false);
      update();
      observers.push(scene.onBeforeRenderObservable.add(update));
      orbitMeshes.push(orbit);
    });
  }

  return {
    root, nodes, meshes, sockets, colliders, destructionGroups, shadowCasters: [...shadowCasters], metrics: validation.metrics,
    dispose(): void {
      for (const observer of observers) if (observer) scene.onBeforeRenderObservable.remove(observer);
      for (const light of lights) light.dispose();
      for (const orbit of orbitMeshes) orbit.dispose(false, true);
      root.dispose(false, true);
      for (const master of masters.values()) master.dispose(false, false);
      for (const material of materials.values()) material.dispose();
      for (const texture of surfaceTextures) texture.dispose();
    }
  };
}
