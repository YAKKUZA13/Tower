import type {
  SceneColliderSpec,
  SceneEmitterSpec,
  SceneKitPlacement,
  SceneNodeSpec,
  ScenePrimitiveSpec,
  SceneTransformSpec,
  Vec3Tuple
} from './types.js';

/** Renderer-independent reusable hierarchy that can be instanced into a scene kit. */
export interface SceneFragmentSpec {
  nodes: readonly SceneNodeSpec[];
  emitters?: readonly SceneEmitterSpec[];
}

export interface SceneFragmentInstanceSpec extends SceneKitPlacement {
  /** Stable namespace and id of the generated logical root. */
  id: string;
  parent?: string;
  terrainAnchor?: SceneNodeSpec['terrainAnchor'];
  collider?: SceneColliderSpec;
  socketId?: string;
  destructionGroup?: string;
  tags?: string[];
}

export interface InstantiatedSceneFragment {
  nodes: SceneNodeSpec[];
  emitters: SceneEmitterSpec[];
}

function tuple(value: Vec3Tuple | undefined): Vec3Tuple | undefined {
  return value ? [...value] : undefined;
}

function cloneTransform(value: SceneTransformSpec | undefined): SceneTransformSpec | undefined {
  if (!value) return undefined;
  return { position: tuple(value.position), rotation: tuple(value.rotation), scale: tuple(value.scale) };
}

function clonePrimitive(value: ScenePrimitiveSpec | undefined): ScenePrimitiveSpec | undefined {
  if (!value) return undefined;
  switch (value.kind) {
    case 'box': return { ...value, size: [...value.size] };
    case 'plane': return { ...value, size: [...value.size] };
    default: return { ...value };
  }
}

function cloneCollider(value: SceneColliderSpec | undefined): SceneColliderSpec | undefined {
  if (!value) return undefined;
  return value.kind === 'box' ? { ...value, size: [...value.size] } : { ...value };
}

function namespace(prefix: string, id: string): string {
  return `${prefix}/${id}`;
}

/**
 * Instantiates a fragment behind one logical transform root. Node, emitter,
 * socket and destruction-group identifiers are namespaced automatically, so
 * repeated structures cannot silently alias engine metadata.
 */
export function instantiateSceneFragment(
  fragment: SceneFragmentSpec,
  instance: SceneFragmentInstanceSpec
): InstantiatedSceneFragment {
  if (!instance.id.trim()) throw new Error('Scene fragment instance id must not be empty');

  const nodeIds = new Set<string>();
  for (const node of fragment.nodes) {
    if (!node.id.trim()) throw new Error('Scene fragment node id must not be empty');
    if (nodeIds.has(node.id)) throw new Error(`Duplicate scene fragment node '${node.id}'`);
    nodeIds.add(node.id);
  }
  for (const node of fragment.nodes) {
    if (node.parent && !nodeIds.has(node.parent)) {
      throw new Error(`Scene fragment node '${node.id}' has external parent '${node.parent}'`);
    }
  }

  const emitterIds = new Set<string>();
  for (const emitter of fragment.emitters ?? []) {
    if (!emitter.id.trim()) throw new Error('Scene fragment emitter id must not be empty');
    if (emitterIds.has(emitter.id)) throw new Error(`Duplicate scene fragment emitter '${emitter.id}'`);
    if (emitter.parent && !nodeIds.has(emitter.parent)) {
      throw new Error(`Scene fragment emitter '${emitter.id}' has external parent '${emitter.parent}'`);
    }
    emitterIds.add(emitter.id);
  }

  const root: SceneNodeSpec = {
    id: instance.id,
    parent: instance.parent,
    transform: cloneTransform(instance),
    terrainAnchor: instance.terrainAnchor ? { ...instance.terrainAnchor } : undefined,
    collider: cloneCollider(instance.collider),
    socketId: instance.socketId,
    destructionGroup: instance.destructionGroup,
    tags: [...(instance.tags ?? []), 'scene-fragment']
  };

  const nodes = fragment.nodes.map((node): SceneNodeSpec => ({
    ...node,
    id: namespace(instance.id, node.id),
    parent: node.parent ? namespace(instance.id, node.parent) : instance.id,
    transform: cloneTransform(node.transform),
    terrainAnchor: node.terrainAnchor ? { ...node.terrainAnchor } : undefined,
    primitive: clonePrimitive(node.primitive),
    collider: cloneCollider(node.collider),
    tags: node.tags ? [...node.tags] : undefined,
    socketId: node.socketId ? namespace(instance.id, node.socketId) : undefined,
    destructionGroup: node.destructionGroup ? namespace(instance.id, node.destructionGroup) : undefined
  }));

  const emitters = (fragment.emitters ?? []).map((emitter): SceneEmitterSpec => {
    if (emitter.kind === 'orbital-cubes') {
      return {
        ...emitter,
        id: namespace(instance.id, emitter.id),
        parent: emitter.parent ? namespace(instance.id, emitter.parent) : instance.id,
        position: [...emitter.position],
        colors: emitter.colors.map((color) => [...color])
      };
    }
    return {
      ...emitter,
      id: namespace(instance.id, emitter.id),
      parent: emitter.parent ? namespace(instance.id, emitter.parent) : instance.id,
      position: [...emitter.position],
      color: [...emitter.color]
    };
  });

  return { nodes: [root, ...nodes], emitters };
}
