import { instantiateSceneFragment, type SceneKitSpec, type SceneNodeSpec, type Vec3Tuple } from '@voxkera/engine-scene';
import { createRitualCasterFragment } from './ritual-caster.js';

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
      id: 'crypt-floor', parent: 'sanctum-root', material: 'crypt-earth',
      primitive: { kind: 'box', size: vec(14.8, 0.1, 13.2, scale) },
      transform: { position: vec(0, -0.08, 0.35, scale) },
      collider: { kind: 'box', size: vec(14.8, 0.1, 13.2, scale), navBlocking: false },
      destructionGroup: 'crypt-floor', tags: ['district-floor', 'receives-shadows']
    },
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
      id: 'outer-rune-ring', parent: 'sanctum-root', material: 'blood-dried',
      primitive: { kind: 'torus', diameter: scaled(6.35, scale), thickness: scaled(0.14, scale), tessellation: 48 },
      transform: { position: vec(0, 0.32, 0, scale) },
      tags: ['emissive', 'rune']
    },
    {
      id: 'inner-rune-ring', parent: 'sanctum-root', material: 'rune-blood',
      primitive: { kind: 'torus', diameter: scaled(4.15, scale), thickness: scaled(0.105, scale), tessellation: 40 },
      transform: { position: vec(0, 0.325, 0, scale) },
      tags: ['emissive', 'rune']
    },
    {
      id: 'middle-rune-ring', parent: 'sanctum-root', material: 'blood-dried',
      primitive: { kind: 'torus', diameter: scaled(5.22, scale), thickness: scaled(0.12, scale), tessellation: 44 },
      transform: { position: vec(0, 0.322, 0, scale) },
      tags: ['rune', 'blood-groove']
    },
    {
      id: 'void-core', parent: 'sanctum-root', material: 'void-magic', socketId: 'magic-core',
      primitive: { kind: 'icosphere', diameter: scaled(0.56, scale), subdivisions: 1 },
      transform: { position: vec(0.45, 4.96, 1.12, scale), scale: [0.92, 1.16, 0.92] },
      tags: ['emissive', 'magic-focal-point']
    }
  ];

  const caster = instantiateSceneFragment(
    createRitualCasterFragment({ scale: scale * 1.16 }),
    {
      id: 'ritual-caster', parent: 'sanctum-root', position: vec(0, 0.34, 0.15, scale), rotation: [0, -Math.PI / 8, 0],
      collider: { kind: 'cylinder', diameter: scaled(1.68, scale), height: scaled(4.25, scale), navBlocking: false },
      socketId: 'caster-root', destructionGroup: 'ritual-caster', tags: ['character', 'ritual-focal-point']
    }
  );
  nodes.push(...caster.nodes);

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
      id: `pentagram-${i}`, parent: 'sanctum-root', material: 'blood-dried',
      primitive: { kind: 'box', size: vec(Math.hypot(dx, dz), 0.055, 0.09, scale) },
      transform: {
        position: vec((a[0] + b[0]) * 0.5, 0.35, (a[1] + b[1]) * 0.5, scale),
        rotation: [0, -Math.atan2(dz, dx), 0]
      },
      tags: ['emissive', 'rune']
    });
    const point = pentagon[order[i]!]!;
    const rayAngle = Math.atan2(point[1], point[0]);
    nodes.push({
      id: `pentagram-fill-${i}`, parent: 'sanctum-root', material: 'blood-dried',
      primitive: { kind: 'box', size: vec(1.46, 0.034, 0.58, scale) },
      transform: {
        position: vec(Math.cos(rayAngle) * 0.92, 0.337, Math.sin(rayAngle) * 0.92, scale),
        rotation: [0, -rayAngle, (i % 2 ? 1 : -1) * 0.012]
      },
      tags: ['blood-mark', 'pentagram-fill']
    });
  }

  // Repeated glyph bars: one instancing family, irregular length/offset but deterministic.
  for (let i = 0; i < 20; i++) {
    const angle = i * Math.PI * 2 / 20;
    const radius = 2.65 + ((i * 17) % 5) * 0.035;
    const length = 0.26 + ((i * 13) % 4) * 0.045;
    nodes.push({
      id: `glyph-${i}`, parent: 'sanctum-root', material: i % 3 === 0 ? 'rune-ember' : 'rune-blood',
      primitive: { kind: 'box', size: vec(length * 1.18, 0.07, 0.12, scale) },
      transform: { position: vec(Math.cos(angle) * radius, 0.355, Math.sin(angle) * radius, scale), rotation: [0, -angle, 0] },
      tags: ['emissive', 'glyph']
    });
    if (i % 2 === 0 || i % 5 === 0) {
      nodes.push({
        id: `glyph-cross-${i}`, parent: 'sanctum-root', material: i % 4 === 0 ? 'rune-ember' : 'rune-blood',
        primitive: { kind: 'box', size: vec(length * 0.72, 0.065, 0.1, scale) },
        transform: {
          position: vec(Math.cos(angle) * (radius + 0.015), 0.36, Math.sin(angle) * (radius + 0.015), scale),
          rotation: [0, -angle + (i % 3 === 0 ? Math.PI / 3 : Math.PI / 2.35), 0]
        },
        tags: ['emissive', 'glyph', 'glyph-cross-stroke']
      });
    }
  }

  // Broad dried-blood spokes and irregular drops keep the seal embedded in the
  // floor instead of reading as pristine neon UI geometry.
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI * 2 / 12 + (i % 3 - 1) * 0.045;
    const length = 0.78 + (i % 4) * 0.16;
    const radius = 3.72 + length * 0.35;
    nodes.push({
      id: `blood-spoke-${i}`, parent: 'sanctum-root', material: i % 3 === 0 ? 'rune-blood' : 'blood-dried',
      primitive: { kind: 'box', size: vec(length, 0.035, 0.18 + (i % 2) * 0.08, scale) },
      transform: {
        position: vec(Math.cos(angle) * radius, 0.315, Math.sin(angle) * radius, scale),
        rotation: [0, -angle, (i % 2 ? 1 : -1) * 0.025]
      },
      tags: ['blood-mark', 'ground-detail']
    });
  }
  for (let i = 0; i < 18; i++) {
    const angle = i * 2.399963229728653;
    const radius = 3.25 + (i % 7) * 0.31;
    nodes.push({
      id: `blood-drop-${i}`, parent: 'sanctum-root', material: 'blood-dried',
      primitive: { kind: 'box', size: vec(0.11 + (i % 3) * 0.05, 0.025, 0.12 + (i % 4) * 0.045, scale) },
      transform: {
        position: vec(Math.cos(angle) * radius, 0.31, Math.sin(angle) * radius, scale),
        rotation: [0, angle * 0.7, 0]
      },
      tags: ['blood-mark', 'ground-detail']
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

  // A broken rear arcade gives the landmark a readable crypt silhouette from
  // the default camera without enclosing the gameplay approaches.
  const rearPierX = [-4.45, -1.55, 1.35, 4.25];
  rearPierX.forEach((x, index) => {
    const height = 3.15 + (index % 2) * 0.42;
    nodes.push(
      {
        id: `rear-pier-${index}`, parent: 'sanctum-root', material: 'stone-dark',
        primitive: { kind: 'box', size: vec(0.72, height, 0.72, scale) },
        transform: { position: vec(x, height * 0.5, 5.35, scale), rotation: [0, (index - 1.5) * 0.018, (index % 2 ? 1 : -1) * 0.025] },
        collider: { kind: 'box', size: vec(0.78, height, 0.78, scale), navBlocking: true },
        destructionGroup: 'rear-arcade', tags: ['casts-shadows', 'crypt-architecture']
      },
      {
        id: `rear-pier-cap-${index}`, parent: 'sanctum-root', material: 'stone-worn',
        primitive: { kind: 'box', size: vec(1.05, 0.24, 0.92, scale) },
        transform: { position: vec(x + (index % 2 ? 0.04 : -0.06), height + 0.04, 5.35, scale), rotation: [0.02, (index - 1.5) * 0.025, (index % 2 ? 1 : -1) * 0.05] },
        destructionGroup: 'rear-arcade', tags: ['casts-shadows', 'broken-cap']
      }
    );
    for (let band = 0; band < 3; band++) {
      nodes.push({
        id: `rear-pier-band-${index}-${band}`, parent: 'sanctum-root', material: band === 1 ? 'stone-highlight' : 'stone-worn',
        primitive: { kind: 'box', size: vec(0.84, 0.12, 0.84, scale) },
        transform: { position: vec(x, 0.62 + band * 0.82, 5.35, scale), rotation: [0, (index - 1.5) * 0.02, 0] },
        destructionGroup: 'rear-arcade', tags: ['casts-shadows', 'architectural-course']
      });
    }
  });
  for (let bay = 0; bay < 3; bay++) {
    for (let course = 0; course < 6; course++) {
      const x = -3 + bay * 2.9 + (course % 2 ? 0.18 : -0.08);
      nodes.push({
        id: `rear-wall-${bay}-${course}`, parent: 'sanctum-root', material: course === 1 ? 'stone-worn' : 'stone-dark',
        primitive: { kind: 'box', size: vec(2.05 - (course > 3 ? 0.16 * (course - 3) : 0), 0.46, 0.42, scale) },
        transform: { position: vec(x, 0.36 + course * 0.49, 5.47, scale), rotation: [0, (bay - 1) * 0.012, (course - 1) * 0.012] },
        collider: { kind: 'box', size: vec(2.05, 0.48, 0.42, scale), navBlocking: true },
        destructionGroup: 'rear-arcade', tags: ['casts-shadows', 'masonry-block']
      });
    }
  }

  // Warm lantern posts establish the focal hierarchy seen in the reference.
  const lanterns: Array<[number, number]> = [];
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
      { id: 'crypt-earth', baseColor: [0.115, 0.105, 0.085], roughness: 1, ambientStrength: 0.42, emissiveColor: [0.065, 0.06, 0.045], emissiveStrength: 0.02, surfaceNoise: { scale: 8, strength: 0.16, seed: 1001 } },
      { id: 'ritual-slab', baseColor: [0.135, 0.105, 0.09], roughness: 0.98, ambientStrength: 0.34, emissiveColor: [0.075, 0.045, 0.035], emissiveStrength: 0.025, surfaceNoise: { scale: 7, strength: 0.14, seed: 1002 } },
      { id: 'blood-dried', baseColor: [0.24, 0.018, 0.018], roughness: 0.94, ambientStrength: 0.24, emissiveColor: [0.16, 0.005, 0.004], emissiveStrength: 0.06 },
      { id: 'stone-dark', baseColor: [0.125, 0.13, 0.105], roughness: 0.98, ambientStrength: 0.4, emissiveColor: [0.07, 0.075, 0.055], emissiveStrength: 0.025, surfaceNoise: { scale: 9, strength: 0.18, seed: 1101 } },
      { id: 'stone-worn', baseColor: [0.245, 0.215, 0.17], roughness: 0.94, ambientStrength: 0.38, emissiveColor: [0.13, 0.105, 0.075], emissiveStrength: 0.025, surfaceNoise: { scale: 7, strength: 0.15, seed: 1102 } },
      { id: 'stone-highlight', baseColor: [0.34, 0.29, 0.22], roughness: 0.95, ambientStrength: 0.34, emissiveColor: [0.17, 0.13, 0.09], emissiveStrength: 0.02, surfaceNoise: { scale: 6, strength: 0.12, seed: 1103 } },
      { id: 'stone-moss', baseColor: [0.105, 0.16, 0.095], roughness: 1, ambientStrength: 0.4, emissiveColor: [0.055, 0.09, 0.045], emissiveStrength: 0.02, surfaceNoise: { scale: 10, strength: 0.18, seed: 1104 } },
      { id: 'metal-aged', baseColor: [0.16, 0.13, 0.10], roughness: 0.62, metallic: 0.55 },
      { id: 'cloth-void', baseColor: [0.04, 0.055, 0.065], roughness: 0.92, ambientStrength: 0.22, surfaceNoise: { scale: 14, strength: 0.08, seed: 1201 } },
      { id: 'cloth-edge', baseColor: [0.075, 0.11, 0.12], roughness: 0.88, ambientStrength: 0.25, surfaceNoise: { scale: 12, strength: 0.1, seed: 1202 } },
      { id: 'cloth-rotten', baseColor: [0.07, 0.13, 0.105], roughness: 1, ambientStrength: 0.29, emissiveColor: [0.018, 0.034, 0.026], emissiveStrength: 0.025, surfaceNoise: { scale: 11, strength: 0.12, seed: 1203 } },
      { id: 'bone-aged', baseColor: [0.82, 0.65, 0.38], roughness: 0.72, ambientStrength: 0.36, surfaceNoise: { scale: 7, strength: 0.08, seed: 1301 } },
      { id: 'bone-shadow', baseColor: [0.44, 0.29, 0.16], roughness: 0.9, ambientStrength: 0.3, surfaceNoise: { scale: 8, strength: 0.1, seed: 1302 } },
      { id: 'charm-bone', baseColor: [0.88, 0.73, 0.4], roughness: 0.68, ambientStrength: 0.38, surfaceNoise: { scale: 6, strength: 0.07, seed: 1303 } },
      { id: 'eye-gold', baseColor: [0.58, 0.34, 0.07], roughness: 0.38, metallic: 0.78, ambientStrength: 0.24 },
      { id: 'eye-void', baseColor: [0.012, 0.008, 0.014], roughness: 0.2, ambientStrength: 0.02 },
      { id: 'skin-ashen', baseColor: [0.72, 0.54, 0.3], roughness: 0.74, ambientStrength: 0.32 },
      { id: 'leather-worn', baseColor: [0.19, 0.095, 0.055], roughness: 0.76, ambientStrength: 0.2, surfaceNoise: { scale: 9, strength: 0.08, seed: 1401 } },
      { id: 'staff-wood', baseColor: [0.23, 0.105, 0.07], roughness: 0.82, ambientStrength: 0.18, surfaceNoise: { scale: 10, strength: 0.12, seed: 1402 } },
      { id: 'staff-bark', baseColor: [0.34, 0.11, 0.085], roughness: 0.96, ambientStrength: 0.22, surfaceNoise: { scale: 12, strength: 0.15, seed: 1403 } },
      { id: 'rune-blood', baseColor: [0.42, 0.045, 0.03], roughness: 0.78, emissiveColor: [0.58, 0.022, 0.012], emissiveStrength: 0.24 },
      { id: 'rune-ember', baseColor: [0.54, 0.13, 0.045], roughness: 0.68, emissiveColor: [0.82, 0.11, 0.025], emissiveStrength: 0.38 },
      { id: 'lantern-fire', baseColor: [0.9, 0.36, 0.07], roughness: 0.3, emissiveColor: [1.0, 0.48, 0.08], emissiveStrength: 2.8 },
      { id: 'void-magic', baseColor: [0.055, 0.004, 0.12], roughness: 0.3, emissiveColor: [0.2, 0.01, 0.56], emissiveStrength: 0.9 }
    ],
    nodes,
    emitters: [
      ...caster.emitters,
      {
        id: 'void-orb-outer', kind: 'orbital-cubes', parent: 'sanctum-root', position: vec(0.45, 5.0, 1.12, scale),
        colors: [[0.46, 0.025, 0.94], [0.72, 0.035, 0.84], [0.28, 0.012, 0.62], [0.88, 0.07, 0.72]],
        count: options.particleCount ?? 120, radius: scaled(1.4, scale), verticalRadius: scaled(1.46, scale),
        cubeSize: scaled(0.068, scale), angularSpeed: 0.34, seed: options.seed ?? 0x51a7c7, emissiveStrength: 0.78,
        shape: 'orb', innerRadius: scaled(0.82, scale)
      },
      {
        id: 'void-orb-inner', kind: 'orbital-cubes', parent: 'sanctum-root', position: vec(0.45, 4.88, 1.12, scale),
        colors: [[0.92, 0.025, 0.12], [0.7, 0.012, 0.16], [1.0, 0.08, 0.28]],
        count: Math.max(42, Math.round((options.particleCount ?? 120) * 0.44)), radius: scaled(0.76, scale), verticalRadius: scaled(0.96, scale),
        cubeSize: scaled(0.074, scale), angularSpeed: -0.48, seed: (options.seed ?? 0x51a7c7) ^ 0x9e3779, emissiveStrength: 0.88,
        shape: 'orb', innerRadius: scaled(0.3, scale)
      },
      {
        id: 'void-orb-tail', kind: 'orbital-cubes', parent: 'sanctum-root', position: vec(1.42, 3.92, 0.32, scale),
        colors: [[0.86, 0.025, 0.18], [0.6, 0.02, 0.78], [0.95, 0.08, 0.38]],
        count: 36, radius: scaled(0.56, scale), verticalRadius: scaled(0.38, scale),
        cubeSize: scaled(0.064, scale), angularSpeed: 0.62, seed: (options.seed ?? 0x51a7c7) ^ 0x85ebca, emissiveStrength: 0.78,
        shape: 'vortex', height: scaled(1.85, scale), innerRadius: scaled(0.08, scale)
      },
      { id: 'void-glow', kind: 'point-glow', parent: 'sanctum-root', position: vec(0.45, 4.88, 1.12, scale), color: [0.7, 0.035, 0.92], intensity: 1.55, range: scaled(7.2, scale) }
    ],
    budget: { maxNodes: 280, maxEstimatedTriangles: 24_000, maxEmitters: 7, maxAnimatedInstances: 320 },
    quality: {
      targetStyle: 'hybrid polygonal dark-fantasy diorama with voxel actors and pixel-scale effects',
      criticalFeatures: ['readable concentric ritual seal', 'four broken masonry silhouettes', 'plague-mask caster with staff and raised casting hand', 'warm lantern vs violet magic color hierarchy', 'single hollow focal magic vortex'],
      failureModes: ['runes disappear at default zoom', 'vortex hides the caster silhouette', 'plague beak reads as a generic cone', 'ruins merge into terrain value', 'particle count causes overdraw or visual noise'],
      requiredViews: ['reference-isometric', 'opposite-three-quarter', 'top-structure', 'night-readability']
    }
  };
}
