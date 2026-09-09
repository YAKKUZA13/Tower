import type {
  RgbTuple,
  SceneKitMetrics,
  SceneKitSpec,
  SceneKitValidationError,
  SceneKitValidationResult,
  SceneNodeSpec,
  ScenePrimitiveSpec,
  Vec3Tuple
} from './types.js';

function finiteTuple(value: Vec3Tuple | RgbTuple | undefined): boolean {
  return value === undefined || value.every(Number.isFinite);
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function estimateTriangles(primitive: ScenePrimitiveSpec): number {
  switch (primitive.kind) {
    case 'box': return 12;
    case 'plane': return 2;
    case 'cylinder': return Math.max(3, primitive.tessellation ?? 12) * 4;
    case 'torus': {
      const tessellation = Math.max(3, primitive.tessellation ?? 24);
      return tessellation * Math.max(6, Math.round(tessellation / 3)) * 2;
    }
    case 'icosphere': return 20 * 4 ** Math.max(0, primitive.subdivisions ?? 1);
  }
}

export function computeSceneKitMetrics(spec: SceneKitSpec): SceneKitMetrics {
  return {
    nodes: spec.nodes.length,
    renderNodes: spec.nodes.filter((node) => node.primitive).length,
    colliders: spec.nodes.filter((node) => node.collider).length,
    sockets: spec.nodes.filter((node) => node.socketId).length,
    emitters: spec.emitters.length,
    animatedInstances: spec.emitters.reduce(
      (total, emitter) => total + (emitter.kind === 'orbital-cubes' ? emitter.count : 0),
      0
    ),
    estimatedTriangles: spec.nodes.reduce(
      (total, node) => total + (node.primitive ? estimateTriangles(node.primitive) : 0),
      0
    ) + spec.emitters.reduce(
      (total, emitter) => total + (emitter.kind === 'orbital-cubes' ? emitter.count * 12 : 0),
      0
    )
  };
}

export function validateSceneKit(spec: SceneKitSpec): SceneKitValidationResult {
  const errors: SceneKitValidationError[] = [];
  const metrics = computeSceneKitMetrics(spec);
  const add = (path: string, message: string): void => { errors.push({ path, message }); };

  if (spec.formatVersion !== 1) add('formatVersion', 'must equal 1');
  if (!spec.name.trim()) add('name', 'must not be empty');

  const materialIds = new Set<string>();
  spec.materials.forEach((material, index) => {
    const path = `materials[${index}]`;
    if (!material.id.trim()) add(`${path}.id`, 'must not be empty');
    if (materialIds.has(material.id)) add(`${path}.id`, `duplicate material '${material.id}'`);
    materialIds.add(material.id);
    if (!finiteTuple(material.baseColor) || material.baseColor.some((channel) => channel < 0 || channel > 1)) {
      add(`${path}.baseColor`, 'channels must be finite and in [0,1]');
    }
    if (!Number.isFinite(material.roughness) || material.roughness < 0 || material.roughness > 1) {
      add(`${path}.roughness`, 'must be in [0,1]');
    }
    if (material.ambientStrength !== undefined && (!Number.isFinite(material.ambientStrength) || material.ambientStrength < 0 || material.ambientStrength > 1)) {
      add(`${path}.ambientStrength`, 'must be in [0,1]');
    }
    if (material.metallic !== undefined && (!Number.isFinite(material.metallic) || material.metallic < 0 || material.metallic > 1)) {
      add(`${path}.metallic`, 'must be in [0,1]');
    }
    if (material.alpha !== undefined && (!Number.isFinite(material.alpha) || material.alpha < 0 || material.alpha > 1)) {
      add(`${path}.alpha`, 'must be in [0,1]');
    }
    if (material.emissiveStrength !== undefined && (!Number.isFinite(material.emissiveStrength) || material.emissiveStrength < 0)) {
      add(`${path}.emissiveStrength`, 'must be a non-negative finite number');
    }
    if (material.emissiveColor && (!finiteTuple(material.emissiveColor) || material.emissiveColor.some((channel) => channel < 0 || channel > 1))) {
      add(`${path}.emissiveColor`, 'channels must be finite and in [0,1]');
    }
  });

  const nodeIds = new Set<string>();
  const socketIds = new Set<string>();
  spec.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    if (!node.id.trim()) add(`${path}.id`, 'must not be empty');
    if (nodeIds.has(node.id)) add(`${path}.id`, `duplicate node '${node.id}'`);
    nodeIds.add(node.id);
    if (!finiteTuple(node.transform?.position) || !finiteTuple(node.transform?.rotation) || !finiteTuple(node.transform?.scale)) {
      add(`${path}.transform`, 'position/rotation/scale must contain finite numbers');
    }
    if (node.terrainAnchor?.offset !== undefined && !Number.isFinite(node.terrainAnchor.offset)) {
      add(`${path}.terrainAnchor.offset`, 'must be finite');
    }
    if (node.primitive && !node.material) add(`${path}.material`, 'render node requires a material');
    if (node.material && !materialIds.has(node.material)) add(`${path}.material`, `unknown material '${node.material}'`);
    validatePrimitive(node, path, add);
    if (node.socketId) {
      if (socketIds.has(node.socketId)) add(`${path}.socketId`, `duplicate socket '${node.socketId}'`);
      socketIds.add(node.socketId);
    }
  });

  for (const node of spec.nodes) {
    if (node.parent && !nodeIds.has(node.parent)) add(`nodes.${node.id}.parent`, `unknown parent '${node.parent}'`);
  }
  detectCycles(spec.nodes, add);

  const emitterIds = new Set<string>();
  spec.emitters.forEach((emitter, index) => {
    const path = `emitters[${index}]`;
    if (emitterIds.has(emitter.id)) add(`${path}.id`, `duplicate emitter '${emitter.id}'`);
    emitterIds.add(emitter.id);
    if (emitter.parent && !nodeIds.has(emitter.parent)) add(`${path}.parent`, `unknown parent '${emitter.parent}'`);
    if (!finiteTuple(emitter.position)) add(`${path}.position`, 'must contain finite numbers');
    if (emitter.kind === 'orbital-cubes') {
      if (!Number.isInteger(emitter.count) || emitter.count < 1) add(`${path}.count`, 'must be a positive integer');
      if (!positive(emitter.radius) || !positive(emitter.verticalRadius) || !positive(emitter.cubeSize)) {
        add(path, 'radius, verticalRadius and cubeSize must be positive');
      }
      if (emitter.colors.length === 0) add(`${path}.colors`, 'must contain at least one color');
      emitter.colors.forEach((color, colorIndex) => {
        if (!finiteTuple(color) || color.some((channel) => channel < 0 || channel > 1)) {
          add(`${path}.colors[${colorIndex}]`, 'channels must be finite and in [0,1]');
        }
      });
      if (!Number.isFinite(emitter.angularSpeed)) add(`${path}.angularSpeed`, 'must be finite');
    } else {
      if (!positive(emitter.intensity) || !positive(emitter.range)) add(path, 'intensity and range must be positive');
      if (!finiteTuple(emitter.color) || emitter.color.some((channel) => channel < 0 || channel > 1)) {
        add(`${path}.color`, 'channels must be finite and in [0,1]');
      }
    }
  });

  if (metrics.nodes > spec.budget.maxNodes) add('budget.maxNodes', `${metrics.nodes} nodes exceed ${spec.budget.maxNodes}`);
  if (metrics.estimatedTriangles > spec.budget.maxEstimatedTriangles) {
    add('budget.maxEstimatedTriangles', `${metrics.estimatedTriangles} estimated triangles exceed ${spec.budget.maxEstimatedTriangles}`);
  }
  if (metrics.emitters > spec.budget.maxEmitters) add('budget.maxEmitters', `${metrics.emitters} emitters exceed ${spec.budget.maxEmitters}`);
  if (metrics.animatedInstances > spec.budget.maxAnimatedInstances) {
    add('budget.maxAnimatedInstances', `${metrics.animatedInstances} instances exceed ${spec.budget.maxAnimatedInstances}`);
  }
  if (spec.quality.criticalFeatures.length === 0) add('quality.criticalFeatures', 'must define visible acceptance features');
  if (spec.quality.requiredViews.length === 0) add('quality.requiredViews', 'must define at least one review view');

  return errors.length > 0 ? { ok: false, metrics, errors } : { ok: true, metrics };
}

function validatePrimitive(
  node: SceneNodeSpec,
  path: string,
  add: (path: string, message: string) => void
): void {
  const primitive = node.primitive;
  if (!primitive) return;
  if (primitive.kind === 'box' && (!finiteTuple(primitive.size) || primitive.size.some((value) => !positive(value)))) {
    add(`${path}.primitive.size`, 'box dimensions must be positive finite numbers');
  }
  if (primitive.kind === 'plane' && primitive.size.some((value) => !positive(value))) {
    add(`${path}.primitive.size`, 'plane dimensions must be positive');
  }
  if (primitive.kind === 'cylinder' && (!positive(primitive.diameter) || !positive(primitive.height))) {
    add(`${path}.primitive`, 'cylinder diameter/height must be positive');
  }
  if (primitive.kind === 'torus' && (!positive(primitive.diameter) || !positive(primitive.thickness) || primitive.thickness >= primitive.diameter)) {
    add(`${path}.primitive`, 'torus dimensions must be positive and thickness < diameter');
  }
  if (primitive.kind === 'icosphere' && !positive(primitive.diameter)) add(`${path}.primitive.diameter`, 'must be positive');
}

function detectCycles(
  nodes: SceneNodeSpec[],
  add: (path: string, message: string) => void
): void {
  const parents = new Map(nodes.map((node) => [node.id, node.parent]));
  for (const node of nodes) {
    const seen = new Set<string>();
    let current: string | undefined = node.id;
    while (current) {
      if (seen.has(current)) {
        add(`nodes.${node.id}.parent`, `hierarchy cycle through '${current}'`);
        break;
      }
      seen.add(current);
      current = parents.get(current);
    }
  }
}
