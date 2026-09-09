import type { SceneKitSpec, SceneNodeSpec, Vec3Tuple } from './types.js';

export interface RitualSanctumOptions {
  scale?: number;
  particleCount?: number;
  seed?: number;
}

function scaled(value: number, scale: number): number {
  return value * scale;
}

function vec(x: number, y: number, z: number, scale: number): Vec3Tuple {
  return [scaled(x, scale), scaled(y, scale), scaled(z, scale)];
}

/**
 * Hybrid dark-fantasy landmark: polygonal masonry + emissive rune geometry +
 * instanced voxel-like magic particles. It is intentionally a reusable scene
 * kit, not a client component.
 */
export function createRitualSanctumKit(options: RitualSanctumOptions = {}): SceneKitSpec {
  const scale = options.scale ?? 1;
  const nodes: SceneNodeSpec[] = [
    { id: 'sanctum-root', socketId: 'ritual-origin', tags: ['landmark', 'ritual-sanctum'] },
    {
      id: 'ritual-foundation', parent: 'sanctum-root', material: 'stone-dark',
      primitive: { kind: 'cylinder', diameter: scaled(8.35, scale), height: scaled(0.14, scale), tessellation: 48 },
      transform: { position: vec(0, 0.07, 0, scale) },
      tags: ['ground-detail', 'receives-shadows']
    },
    {
      id: 'ritual-dais', parent: 'sanctum-root', material: 'ritual-slab',
      primitive: { kind: 'cylinder', diameter: scaled(7.45, scale), height: scaled(0.2, scale), tessellation: 48 },
      transform: { position: vec(0, 0.2, 0, scale) },
      collider: { kind: 'cylinder', diameter: scaled(7.45, scale), height: scaled(0.2, scale), navBlocking: false },
      destructionGroup: 'ritual-floor', tags: ['ground-detail', 'receives-shadows']
    },
    {
      id: 'outer-rune-ring', parent: 'sanctum-root', material: 'rune-blood',
      primitive: { kind: 'torus', diameter: scaled(6.35, scale), thickness: scaled(0.14, scale), tessellation: 48 },
      transform: { position: vec(0, 0.32, 0, scale), rotation: [Math.PI / 2, 0, 0] },
      tags: ['emissive', 'rune']
    },
    {
      id: 'inner-rune-ring', parent: 'sanctum-root', material: 'rune-ember',
      primitive: { kind: 'torus', diameter: scaled(4.15, scale), thickness: scaled(0.105, scale), tessellation: 40 },
      transform: { position: vec(0, 0.325, 0, scale), rotation: [Math.PI / 2, 0, 0] },
      tags: ['emissive', 'rune']
    },
    {
      id: 'void-core', parent: 'sanctum-root', material: 'void-magic', socketId: 'magic-core',
      primitive: { kind: 'icosphere', diameter: scaled(0.72, scale), subdivisions: 2 },
      transform: { position: vec(0, 3.45, 0, scale), scale: [0.86, 1.08, 0.86] },
      tags: ['emissive', 'magic-focal-point']
    }
  ];

  // Pentagram strokes derived from exact endpoints, so the structural pass is deterministic.
  const pentagon: Array<[number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / 5;
    pentagon.push([Math.cos(angle) * 1.8, Math.sin(angle) * 1.8]);
  }
  const order = [0, 2, 4, 1, 3, 0];
  for (let i = 0; i < 5; i++) {
    const a = pentagon[order[i]!]!;
    const b = pentagon[order[i + 1]!]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    nodes.push({
      id: `pentagram-${i}`, parent: 'sanctum-root', material: 'rune-blood',
      primitive: { kind: 'box', size: vec(Math.hypot(dx, dz), 0.055, 0.09, scale) },
      transform: {
        position: vec((a[0] + b[0]) * 0.5, 0.35, (a[1] + b[1]) * 0.5, scale),
        rotation: [0, -Math.atan2(dz, dx), 0]
      },
      tags: ['emissive', 'rune']
    });
  }

  // Repeated glyph bars: one instancing family, irregular length/offset but deterministic.
  for (let i = 0; i < 20; i++) {
    const angle = i * Math.PI * 2 / 20;
    const radius = 2.65 + ((i * 17) % 5) * 0.035;
    const length = 0.26 + ((i * 13) % 4) * 0.045;
    nodes.push({
      id: `glyph-${i}`, parent: 'sanctum-root', material: i % 3 === 0 ? 'rune-ember' : 'rune-blood',
      primitive: { kind: 'box', size: vec(length, 0.06, 0.095, scale) },
      transform: { position: vec(Math.cos(angle) * radius, 0.355, Math.sin(angle) * radius, scale), rotation: [0, -angle, 0] },
      tags: ['emissive', 'glyph']
    });
  }

  // A broken radial apron adds the mid-frequency floor detail that survives the
  // default RTS zoom. Small gaps keep the silhouette archaeological, not clean.
  for (let i = 0; i < 24; i++) {
    if (i === 3 || i === 4 || i === 15 || i === 16) continue;
    const angle = i * Math.PI * 2 / 24;
    const radius = 3.88 + ((i * 11) % 3) * 0.055;
    nodes.push({
      id: `apron-stone-${i}`, parent: 'sanctum-root',
      material: i % 7 === 0 ? 'stone-moss' : i % 3 === 0 ? 'stone-worn' : 'stone-dark',
      primitive: { kind: 'box', size: vec(0.82, 0.11, 0.52, scale) },
      transform: {
        position: vec(Math.cos(angle) * radius, 0.19 + (i % 2) * 0.018, Math.sin(angle) * radius, scale),
        rotation: [(i % 4 - 1.5) * 0.012, -angle, (i % 5 - 2) * 0.014]
      },
      tags: ['ground-detail', 'casts-shadows', 'broken-apron']
    });
  }

  // Four readable ruined corner structures. Logical parent nodes keep sockets/colliders stable.
  const corners: Array<[number, number, number]> = [
    [-4.25, -3.8, 0.08], [4.2, -3.75, -0.11], [-4.1, 3.8, -0.04], [4.3, 3.7, 0.14]
  ];
  corners.forEach(([x, z, cant], index) => {
    const parent = `ruin-${index}`;
    const height = 1.8 + (index % 3) * 0.38;
    nodes.push({
      id: parent, parent: 'sanctum-root', transform: { position: vec(x, 0, z, scale), rotation: [0, cant, 0] },
      socketId: `ruin-socket-${index}`, destructionGroup: `ruin-${index}`, tags: ['ruin-cluster']
    });
    nodes.push(
      {
        id: `${parent}-base`, parent, material: 'stone-worn',
        primitive: { kind: 'box', size: vec(1.05, 0.32, 1.05, scale) },
        transform: { position: vec(0, 0.16, 0, scale) }, tags: ['casts-shadows']
      },
      {
        id: `${parent}-shaft`, parent, material: 'stone-dark',
        primitive: { kind: 'box', size: vec(0.62, height, 0.62, scale) },
        transform: { position: vec(0.05 * (index - 1.5), 0.32 + height * 0.5, 0, scale), rotation: [0.04 * index, 0, -0.035 * (index + 1)] },
        collider: { kind: 'box', size: vec(0.72, height, 0.72, scale), navBlocking: true }, tags: ['casts-shadows']
      },
      {
        id: `${parent}-cap`, parent, material: 'stone-worn',
        primitive: { kind: 'box', size: vec(0.88, 0.24, 0.88, scale) },
        transform: { position: vec(0.08, 0.4 + height, 0, scale), rotation: [0.06 * (index % 2), 0.08, -0.06] }, tags: ['casts-shadows']
      }
    );
  });

  // Warm lantern posts establish the focal hierarchy seen in the reference.
  const lanterns: Array<[number, number]> = [[-2.85, -2.15], [2.85, 2.15]];
  lanterns.forEach(([x, z], index) => {
    nodes.push(
      {
        id: `lantern-post-${index}`, parent: 'sanctum-root', material: 'metal-aged',
        primitive: { kind: 'cylinder', diameter: scaled(0.13, scale), height: scaled(1.65, scale), tessellation: 8 },
        transform: { position: vec(x, 0.825, z, scale) }, tags: ['casts-shadows']
      },
      {
        id: `lantern-core-${index}`, parent: 'sanctum-root', material: 'lantern-fire',
        primitive: { kind: 'box', size: vec(0.29, 0.4, 0.29, scale) },
        transform: { position: vec(x, 1.55, z, scale), rotation: [0, Math.PI / 4, 0] }, tags: ['emissive']
      },
      {
        id: `lantern-roof-${index}`, parent: 'sanctum-root', material: 'metal-aged',
        primitive: { kind: 'box', size: vec(0.48, 0.12, 0.48, scale) },
        transform: { position: vec(x, 1.82, z, scale), rotation: [0, Math.PI / 4, 0] }, tags: ['casts-shadows']
      },
      {
        id: `lantern-foot-${index}`, parent: 'sanctum-root', material: 'metal-aged',
        primitive: { kind: 'box', size: vec(0.42, 0.1, 0.42, scale) },
        transform: { position: vec(x, 1.3, z, scale), rotation: [0, Math.PI / 4, 0] }, tags: ['casts-shadows']
      }
    );
  });

  return {
    formatVersion: 1,
    name: 'ritual-sanctum',
    materials: [
      { id: 'ritual-slab', baseColor: [0.15, 0.085, 0.075], roughness: 0.98, ambientStrength: 0.34, emissiveColor: [0.11, 0.035, 0.025], emissiveStrength: 0.035 },
      { id: 'stone-dark', baseColor: [0.19, 0.145, 0.125], roughness: 0.98, ambientStrength: 0.38, emissiveColor: [0.14, 0.095, 0.075], emissiveStrength: 0.035 },
      { id: 'stone-worn', baseColor: [0.29, 0.215, 0.175], roughness: 0.94, ambientStrength: 0.36, emissiveColor: [0.18, 0.12, 0.09], emissiveStrength: 0.03 },
      { id: 'stone-highlight', baseColor: [0.38, 0.285, 0.225], roughness: 0.95, ambientStrength: 0.32, emissiveColor: [0.2, 0.13, 0.095], emissiveStrength: 0.025 },
      { id: 'stone-moss', baseColor: [0.15, 0.205, 0.13], roughness: 1, ambientStrength: 0.38, emissiveColor: [0.09, 0.13, 0.075], emissiveStrength: 0.03 },
      { id: 'metal-aged', baseColor: [0.16, 0.13, 0.10], roughness: 0.62, metallic: 0.55 },
      { id: 'rune-blood', baseColor: [0.22, 0.025, 0.018], roughness: 0.72, emissiveColor: [0.72, 0.035, 0.018], emissiveStrength: 1.05 },
      { id: 'rune-ember', baseColor: [0.3, 0.065, 0.025], roughness: 0.6, emissiveColor: [0.9, 0.16, 0.04], emissiveStrength: 1.25 },
      { id: 'lantern-fire', baseColor: [0.9, 0.36, 0.07], roughness: 0.3, emissiveColor: [1.0, 0.48, 0.08], emissiveStrength: 2.8 },
      { id: 'void-magic', baseColor: [0.12, 0.01, 0.42], roughness: 0.3, emissiveColor: [0.34, 0.025, 1.0], emissiveStrength: 1.75 }
    ],
    nodes,
    emitters: [
      {
        id: 'void-orb', kind: 'orbital-cubes', parent: 'sanctum-root', position: vec(0, 3.45, 0, scale),
        colors: [[0.42, 0.04, 1.0], [0.68, 0.035, 0.92], [0.22, 0.018, 0.62], [0.82, 0.055, 0.32]],
        count: options.particleCount ?? 46, radius: scaled(0.94, scale), verticalRadius: scaled(0.68, scale),
        cubeSize: scaled(0.074, scale), angularSpeed: 0.42, seed: options.seed ?? 0x51a7c7
      },
      { id: 'void-glow', kind: 'point-glow', parent: 'sanctum-root', position: vec(0, 3.45, 0, scale), color: [0.68, 0.08, 1.0], intensity: 2.05, range: scaled(6.5, scale) },
      { id: 'lantern-glow-0', kind: 'point-glow', parent: 'sanctum-root', position: vec(-2.85, 1.55, -2.15, scale), color: [1.0, 0.55, 0.17], intensity: 1.5, range: scaled(4.2, scale) },
      { id: 'lantern-glow-1', kind: 'point-glow', parent: 'sanctum-root', position: vec(2.85, 1.55, 2.15, scale), color: [1.0, 0.55, 0.17], intensity: 1.5, range: scaled(4.2, scale) }
    ],
    budget: { maxNodes: 104, maxEstimatedTriangles: 11_000, maxEmitters: 6, maxAnimatedInstances: 128 },
    quality: {
      targetStyle: 'hybrid polygonal dark-fantasy diorama with voxel actors and pixel-scale effects',
      criticalFeatures: ['readable concentric ritual seal', 'four broken masonry silhouettes', 'warm lantern vs violet magic color hierarchy', 'single focal magic orb'],
      failureModes: ['runes disappear at default zoom', 'orb hides gameplay actors', 'ruins merge into terrain value', 'particle count causes overdraw or visual noise'],
      requiredViews: ['default-rts-isometric', 'top-structure', 'night-readability']
    }
  };
}
