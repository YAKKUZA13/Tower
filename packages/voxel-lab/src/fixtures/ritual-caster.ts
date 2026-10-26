import type { SceneFragmentSpec, SceneNodeSpec, Vec3Tuple } from '@voxkera/engine-scene';

export interface RitualCasterMaterials {
  robe: string;
  robeEdge: string;
  robeRot: string;
  mask: string;
  boneShadow: string;
  eyeMetal: string;
  eyeVoid: string;
  skin: string;
  leather: string;
  wood: string;
  woodRot: string;
  charm: string;
  lantern: string;
  lanternFrame: string;
}

export interface RitualCasterOptions {
  scale?: number;
  materials?: Partial<RitualCasterMaterials>;
}

const DEFAULT_MATERIALS: RitualCasterMaterials = {
  robe: 'cloth-void',
  robeEdge: 'cloth-edge',
  robeRot: 'cloth-rotten',
  mask: 'bone-aged',
  boneShadow: 'bone-shadow',
  eyeMetal: 'eye-gold',
  eyeVoid: 'eye-void',
  skin: 'skin-ashen',
  leather: 'leather-worn',
  wood: 'staff-wood',
  woodRot: 'staff-bark',
  charm: 'charm-bone',
  lantern: 'lantern-fire',
  lanternFrame: 'metal-aged'
};

function vec(x: number, y: number, z: number, scale: number): Vec3Tuple {
  return [x * scale, y * scale, z * scale];
}

/**
 * Action-ready plague ritualist fragment. The geometry stays intentionally
 * low-resolution and modular: hood, mask, props, arms and robe panels remain
 * separate named parts with stable sockets and destruction groups.
 */
export function createRitualCasterFragment(options: RitualCasterOptions = {}): SceneFragmentSpec {
  const scale = options.scale ?? 1;
  const material = { ...DEFAULT_MATERIALS, ...options.materials };
  const nodes: SceneNodeSpec[] = [
    {
      id: 'body', socketId: 'caster-origin',
      collider: { kind: 'cylinder', diameter: 1.25 * scale, height: 3.35 * scale, navBlocking: false },
      destructionGroup: 'caster-body', tags: ['character', 'ritual-caster']
    },
    {
      id: 'torso', parent: 'body', material: material.robe,
      primitive: { kind: 'box', size: vec(1.02, 1.02, 0.72, scale) },
      transform: { position: vec(0, 2.08, 0.02, scale), rotation: [0.04, 0, -0.035] },
      destructionGroup: 'caster-body', tags: ['casts-shadows', 'robe-shell']
    },
    {
      id: 'shoulders', parent: 'body', material: material.robeEdge,
      primitive: { kind: 'box', size: vec(1.62, 0.32, 0.78, scale) },
      transform: { position: vec(0, 2.5, 0.02, scale), rotation: [0.03, 0, -0.04] },
      destructionGroup: 'caster-body', tags: ['casts-shadows', 'robe-shell']
    },
    {
      id: 'hood', parent: 'body', material: material.robe,
      primitive: { kind: 'icosphere', diameter: 1.28 * scale, subdivisions: 1 },
      transform: { position: vec(-0.04, 3.08, 0.08, scale), scale: [1.02, 1.12, 0.9] },
      socketId: 'head-top', destructionGroup: 'caster-head', tags: ['casts-shadows', 'hood']
    },
    {
      id: 'hood-brow', parent: 'body', material: material.robeEdge,
      primitive: { kind: 'box', size: vec(0.96, 0.28, 0.34, scale) },
      transform: { position: vec(-0.05, 3.28, -0.37, scale), rotation: [-0.16, 0.04, -0.03] },
      destructionGroup: 'caster-head', tags: ['casts-shadows', 'hood-shadow']
    },
    {
      id: 'mask', parent: 'body', material: material.mask,
      primitive: { kind: 'icosphere', diameter: 0.82 * scale, subdivisions: 1 },
      transform: { position: vec(0.04, 3.02, -0.46, scale), rotation: [0.02, -0.06, -0.08], scale: [1.02, 0.94, 0.5] },
      socketId: 'mask-front', destructionGroup: 'caster-mask', tags: ['casts-shadows', 'plague-mask']
    },
    {
      id: 'beak', parent: 'body', material: material.mask,
      primitive: { kind: 'cone', diameter: 0.55 * scale, height: 1.32 * scale, tessellation: 6 },
      transform: { position: vec(0.08, 2.9, -1.05, scale), rotation: [-Math.PI / 2, 0.06, -0.08], scale: [1, 1, 0.82] },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'plague-beak']
    },
    {
      id: 'beak-ridge', parent: 'body', material: material.mask,
      primitive: { kind: 'box', size: vec(0.12, 0.14, 1.0, scale) },
      transform: { position: vec(0.08, 3.06, -1.0, scale), rotation: [-0.2, 0.06, -0.08] },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'beak-ridge']
    },
    {
      id: 'eye-left-ring', parent: 'body', material: material.eyeVoid,
      primitive: { kind: 'torus', diameter: 0.19 * scale, thickness: 0.045 * scale, tessellation: 8 },
      transform: { position: vec(-0.18, 3.14, -0.66, scale), rotation: [Math.PI / 2, 0.04, -0.08], scale: [0.9, 1, 1] },
      destructionGroup: 'caster-mask', tags: ['skull-eye-shadow']
    },
    {
      id: 'eye-right-ring', parent: 'body', material: material.mask,
      primitive: { kind: 'torus', diameter: 0.25 * scale, thickness: 0.075 * scale, tessellation: 10 },
      transform: { position: vec(0.26, 3.13, -0.65, scale), rotation: [Math.PI / 2, -0.03, -0.08], scale: [0.92, 1.08, 1] },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'skull-eye-socket']
    },
    {
      id: 'eye-left-void', parent: 'body', material: material.eyeVoid,
      primitive: { kind: 'icosphere', diameter: 0.22 * scale, subdivisions: 1 },
      transform: { position: vec(-0.18, 3.14, -0.68, scale), scale: [1.08, 1, 0.42] },
      destructionGroup: 'caster-mask', tags: ['mask-eye']
    },
    {
      id: 'eye-right-void', parent: 'body', material: material.eyeVoid,
      primitive: { kind: 'icosphere', diameter: 0.19 * scale, subdivisions: 1 },
      transform: { position: vec(0.26, 3.13, -0.68, scale), scale: [0.92, 1.08, 0.42] },
      destructionGroup: 'caster-mask', tags: ['mask-eye']
    },
    {
      id: 'belt', parent: 'body', material: material.leather,
      primitive: { kind: 'box', size: vec(1.05, 0.18, 0.72, scale) },
      transform: { position: vec(0, 1.72, -0.01, scale), rotation: [0, 0, -0.03] },
      destructionGroup: 'caster-equipment', tags: ['casts-shadows', 'belt']
    },
    {
      id: 'belt-buckle', parent: 'body', material: material.eyeMetal,
      primitive: { kind: 'box', size: vec(0.22, 0.24, 0.1, scale) },
      transform: { position: vec(-0.08, 1.7, -0.39, scale), rotation: [0.02, 0, 0.04] },
      destructionGroup: 'caster-equipment', tags: ['casts-shadows', 'belt-hardware']
    },
    {
      id: 'pouch-left', parent: 'body', material: material.leather,
      primitive: { kind: 'box', size: vec(0.32, 0.42, 0.24, scale) },
      transform: { position: vec(-0.43, 1.48, -0.27, scale), rotation: [0, 0.12, 0.08] },
      destructionGroup: 'caster-equipment', tags: ['casts-shadows', 'pouch']
    },
    {
      id: 'pouch-right', parent: 'body', material: material.leather,
      primitive: { kind: 'box', size: vec(0.28, 0.36, 0.23, scale) },
      transform: { position: vec(0.42, 1.52, -0.26, scale), rotation: [0, -0.1, -0.06] },
      destructionGroup: 'caster-equipment', tags: ['casts-shadows', 'pouch']
    },
    {
      id: 'staff-upper-arm', parent: 'body', material: material.robeEdge,
      primitive: { kind: 'box', size: vec(0.82, 0.32, 0.38, scale) },
      transform: { position: vec(-0.68, 2.27, -0.05, scale), rotation: [0, 0.08, 0.58] },
      destructionGroup: 'caster-staff-arm', tags: ['casts-shadows', 'arm']
    },
    {
      id: 'staff-forearm', parent: 'body', material: material.robe,
      primitive: { kind: 'box', size: vec(0.3, 0.78, 0.3, scale) },
      transform: { position: vec(-0.83, 1.89, -0.08, scale), rotation: [0, 0.05, 0.12] },
      destructionGroup: 'caster-staff-arm', tags: ['casts-shadows', 'arm']
    },
    {
      id: 'staff-hand', parent: 'body', material: material.skin,
      primitive: { kind: 'box', size: vec(0.3, 0.34, 0.3, scale) },
      transform: { position: vec(-0.9, 1.54, -0.1, scale), rotation: [0.08, 0, 0.08] },
      socketId: 'staff-grip', destructionGroup: 'caster-staff-arm', tags: ['casts-shadows', 'hand']
    },
    {
      id: 'casting-upper-arm', parent: 'body', material: material.robeEdge,
      primitive: { kind: 'box', size: vec(0.92, 0.34, 0.4, scale) },
      transform: { position: vec(0.78, 2.55, -0.05, scale), rotation: [0, -0.08, -0.16] },
      destructionGroup: 'caster-casting-arm', tags: ['casts-shadows', 'arm']
    },
    {
      id: 'casting-forearm', parent: 'body', material: material.robe,
      primitive: { kind: 'box', size: vec(0.94, 0.29, 0.34, scale) },
      transform: { position: vec(1.28, 2.78, -0.14, scale), rotation: [0, -0.12, -0.36] },
      destructionGroup: 'caster-casting-arm', tags: ['casts-shadows', 'arm']
    },
    {
      id: 'casting-palm', parent: 'body', material: material.skin,
      primitive: { kind: 'box', size: vec(0.36, 0.36, 0.28, scale) },
      transform: { position: vec(1.73, 3.05, -0.22, scale), rotation: [-0.16, 0.08, -0.1] },
      socketId: 'magic-origin', destructionGroup: 'caster-casting-arm', tags: ['casts-shadows', 'hand', 'magic-hand']
    },
    {
      id: 'staff-shaft', parent: 'body', material: material.wood,
      primitive: { kind: 'cylinder', diameter: 0.16 * scale, height: 3.72 * scale, tessellation: 7 },
      transform: { position: vec(-1.28, 1.86, 0.02, scale), rotation: [0.03, 0, -0.04] },
      destructionGroup: 'caster-staff', tags: ['casts-shadows', 'staff']
    },
    {
      id: 'staff-head', parent: 'body', material: material.woodRot,
      primitive: { kind: 'torus', diameter: 0.72 * scale, thickness: 0.115 * scale, tessellation: 16 },
      transform: { position: vec(-1.07, 3.68, 0.02, scale), rotation: [Math.PI / 2, 0.12, -0.12], scale: [0.82, 1, 1] },
      destructionGroup: 'caster-staff', tags: ['casts-shadows', 'staff-crook']
    },
    {
      id: 'staff-crook-mid', parent: 'body', material: material.woodRot,
      primitive: { kind: 'box', size: vec(0.52, 0.15, 0.16, scale) },
      transform: { position: vec(-0.78, 3.92, 0.02, scale), rotation: [0.08, 0, -0.35] },
      destructionGroup: 'caster-staff', tags: ['casts-shadows', 'staff-crook']
    },
    {
      id: 'staff-crook-tip', parent: 'body', material: material.woodRot,
      primitive: { kind: 'box', size: vec(0.17, 0.56, 0.17, scale) },
      transform: { position: vec(-0.54, 4.05, 0.02, scale), rotation: [0.05, 0, -0.42] },
      destructionGroup: 'caster-staff', tags: ['casts-shadows', 'staff-crook']
    },
    {
      id: 'lantern-hanger', parent: 'body', material: material.lanternFrame,
      primitive: { kind: 'box', size: vec(0.1, 0.58, 0.1, scale) },
      transform: { position: vec(-1.62, 2.82, -0.02, scale), rotation: [0, 0, -0.08] },
      destructionGroup: 'caster-lantern', tags: ['casts-shadows', 'lantern']
    },
    {
      id: 'lantern-core', parent: 'body', material: material.lantern,
      primitive: { kind: 'box', size: vec(0.32, 0.44, 0.32, scale) },
      transform: { position: vec(-1.66, 2.25, -0.02, scale), rotation: [0, Math.PI / 4, -0.04] },
      socketId: 'lantern-light', destructionGroup: 'caster-lantern', tags: ['emissive', 'lantern']
    },
    {
      id: 'lantern-roof', parent: 'body', material: material.lanternFrame,
      primitive: { kind: 'box', size: vec(0.52, 0.13, 0.52, scale) },
      transform: { position: vec(-1.66, 2.59, -0.02, scale), rotation: [0, Math.PI / 4, -0.04] },
      destructionGroup: 'caster-lantern', tags: ['casts-shadows', 'lantern']
    },
    {
      id: 'lantern-foot', parent: 'body', material: material.lanternFrame,
      primitive: { kind: 'box', size: vec(0.48, 0.12, 0.48, scale) },
      transform: { position: vec(-1.66, 1.91, -0.02, scale), rotation: [0, Math.PI / 4, -0.04] },
      destructionGroup: 'caster-lantern', tags: ['casts-shadows', 'lantern']
    }
  ];

  // Layered hood bands replace the clean doctor-cap read with a stacked,
  // weathered occult cowl. The offsets are intentionally irregular.
  for (let index = 0; index < 4; index++) {
    nodes.push({
      id: `hood-band-${index}`, parent: 'body', material: index % 2 === 0 ? material.robeRot : material.robeEdge,
      primitive: { kind: 'box', size: vec(0.92 - index * 0.08, 0.15, 0.66 - index * 0.045, scale) },
      transform: {
        position: vec(-0.08 + (index % 2) * 0.05, 3.35 + index * 0.15, 0.02 + index * 0.03, scale),
        rotation: [0.03 * (index - 1), -0.03 * index, (index % 2 ? 1 : -1) * 0.055]
      },
      destructionGroup: 'caster-head', tags: ['casts-shadows', 'hood-fold']
    });
  }

  nodes.push(
    {
      id: 'skull-cheek-left', parent: 'body', material: material.mask,
      primitive: { kind: 'box', size: vec(0.24, 0.44, 0.22, scale) },
      transform: { position: vec(-0.25, 2.9, -0.67, scale), rotation: [-0.08, 0.08, -0.25] },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'skull-cheek']
    },
    {
      id: 'skull-cheek-right', parent: 'body', material: material.boneShadow,
      primitive: { kind: 'box', size: vec(0.22, 0.38, 0.2, scale) },
      transform: { position: vec(0.28, 2.91, -0.67, scale), rotation: [-0.06, -0.08, 0.22] },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'skull-cheek']
    },
    {
      id: 'skull-upper-jaw', parent: 'body', material: material.mask,
      primitive: { kind: 'box', size: vec(0.62, 0.14, 0.32, scale) },
      transform: { position: vec(0.05, 2.79, -0.74, scale), rotation: [-0.08, 0.04, -0.09] },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'skull-jaw']
    },
    {
      id: 'skull-lower-jaw', parent: 'body', material: material.boneShadow,
      primitive: { kind: 'box', size: vec(0.52, 0.12, 0.38, scale) },
      transform: { position: vec(0.08, 2.66, -0.77, scale), rotation: [0.08, 0.04, -0.12] },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'skull-jaw']
    },
    {
      id: 'skull-nasal-cavity', parent: 'body', material: material.eyeVoid,
      primitive: { kind: 'icosphere', diameter: 0.18 * scale, subdivisions: 1 },
      transform: { position: vec(0.09, 2.9, -1.62, scale), scale: [0.62, 0.75, 0.32] },
      destructionGroup: 'caster-mask', tags: ['skull-cavity']
    }
  );

  nodes.push(
    {
      id: 'chest-strap-left', parent: 'body', material: material.leather,
      primitive: { kind: 'box', size: vec(0.14, 1.02, 0.1, scale) },
      transform: { position: vec(-0.24, 2.02, -0.4, scale), rotation: [0.04, 0, -0.52] },
      destructionGroup: 'caster-equipment', tags: ['casts-shadows', 'chest-strap']
    },
    {
      id: 'chest-strap-right', parent: 'body', material: material.leather,
      primitive: { kind: 'box', size: vec(0.12, 0.96, 0.1, scale) },
      transform: { position: vec(0.25, 2.0, -0.4, scale), rotation: [0.04, 0, 0.48] },
      destructionGroup: 'caster-equipment', tags: ['casts-shadows', 'chest-strap']
    },
    {
      id: 'skull-horn-left', parent: 'body', material: material.charm,
      primitive: { kind: 'cone', diameter: 0.18 * scale, height: 0.62 * scale, tessellation: 6 },
      transform: { position: vec(-0.55, 3.45, -0.18, scale), rotation: [0.18, 0.16, -0.68] },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'bone-antler']
    },
    {
      id: 'skull-horn-right', parent: 'body', material: material.boneShadow,
      primitive: { kind: 'cone', diameter: 0.14 * scale, height: 0.44 * scale, tessellation: 6 },
      transform: { position: vec(0.48, 3.4, -0.2, scale), rotation: [-0.12, -0.16, 0.58] },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'broken-bone-antler']
    }
  );

  for (let index = 0; index < 6; index++) {
    nodes.push({
      id: `chest-bone-${index}`, parent: 'body', material: index % 2 ? material.boneShadow : material.charm,
      primitive: { kind: 'box', size: vec(0.1, 0.24 + (index % 2) * 0.07, 0.1, scale) },
      transform: {
        position: vec(-0.42 + index * 0.17, 2.26 - Math.sin(index / 5 * Math.PI) * 0.22, -0.48, scale),
        rotation: [0.05, 0, -0.48 + index * 0.19]
      },
      destructionGroup: 'caster-equipment', tags: ['casts-shadows', 'bone-necklace']
    });
  }

  for (let index = 0; index < 6; index++) {
    nodes.push({
      id: `robe-front-fold-${index}`, parent: 'body', material: index % 2 ? material.robeRot : material.robeEdge,
      primitive: { kind: 'box', size: vec(0.09, 1.55 - (index % 3) * 0.18, 0.09, scale) },
      transform: {
        position: vec(-0.48 + index * 0.19, 0.96 + (index % 2) * 0.06, -0.34, scale),
        rotation: [0.02, 0, (index - 2.5) * -0.025]
      },
      destructionGroup: 'caster-robe', tags: ['casts-shadows', 'robe-fold']
    });
  }

  for (let index = 0; index < 7; index++) {
    nodes.push({
      id: `skull-tooth-${index}`, parent: 'body', material: index % 3 === 0 ? material.charm : material.mask,
      primitive: { kind: 'cone', diameter: 0.11 * scale, height: (0.18 + (index % 2) * 0.055) * scale, tessellation: 5 },
      transform: {
        position: vec(-0.23 + index * 0.09, 2.61 - Math.abs(index - 3) * 0.008, -0.88 - Math.abs(index - 3) * 0.025, scale),
        rotation: [0, 0, Math.PI]
      },
      destructionGroup: 'caster-mask', tags: ['casts-shadows', 'skull-tooth']
    });
  }

  // Ragged mantle silhouette: separate torn tabs keep the shoulders wide and
  // broken instead of reading as a clean coat.
  const mantleTabs = [-3, -2, -1, 1, 2, 3];
  mantleTabs.forEach((slot, index) => {
    const side = Math.sign(slot);
    nodes.push({
      id: `mantle-tatter-${index}`, parent: 'body', material: index % 3 === 0 ? material.robeRot : material.robeEdge,
      primitive: { kind: 'box', size: vec(0.28, 0.52 + (index % 2) * 0.18, 0.42, scale) },
      transform: {
        position: vec(slot * 0.25, 2.34 - Math.abs(slot) * 0.055, 0.02 + Math.abs(slot) * 0.035, scale),
        rotation: [0.06 * side, -0.04 * slot, side * (0.2 + Math.abs(slot) * 0.055)]
      },
      destructionGroup: 'caster-robe', tags: ['casts-shadows', 'ragged-mantle']
    });
  });

  // Bone fetishes and cord wraps make the crooked staff read as a ritual prop,
  // not a straight walking cane.
  for (let index = 0; index < 5; index++) {
    nodes.push({
      id: `staff-charm-${index}`, parent: 'body', material: index % 2 === 0 ? material.charm : material.mask,
      primitive: { kind: index % 2 === 0 ? 'cone' : 'box', ...(index % 2 === 0
        ? { diameter: 0.12 * scale, height: 0.3 * scale, tessellation: 5 }
        : { size: vec(0.1, 0.3, 0.1, scale) }) },
      transform: {
        position: vec(-1.12 + (index % 2) * 0.17, 2.74 + index * 0.19, -0.04 - (index % 3) * 0.05, scale),
        rotation: [0.08 * index, 0, (index % 2 ? 1 : -1) * (0.22 + index * 0.05)]
      },
      destructionGroup: 'caster-staff', tags: ['casts-shadows', 'staff-fetish']
    } as SceneNodeSpec);
  }
  nodes.push(
    {
      id: 'staff-branch-left', parent: 'body', material: material.woodRot,
      primitive: { kind: 'box', size: vec(0.48, 0.13, 0.14, scale) },
      transform: { position: vec(-1.48, 3.43, 0.03, scale), rotation: [0.05, 0, 0.58] },
      destructionGroup: 'caster-staff', tags: ['casts-shadows', 'staff-branch']
    },
    {
      id: 'staff-branch-tip', parent: 'body', material: material.woodRot,
      primitive: { kind: 'box', size: vec(0.16, 0.46, 0.15, scale) },
      transform: { position: vec(-1.66, 3.65, 0.03, scale), rotation: [0.04, 0, 0.22] },
      destructionGroup: 'caster-staff', tags: ['casts-shadows', 'staff-branch']
    }
  );

  for (let index = 0; index < 8; index++) {
    nodes.push({
      id: `belt-chain-${index}`, parent: 'body', material: index % 3 === 0 ? material.eyeMetal : material.charm,
      primitive: { kind: 'box', size: vec(0.09, 0.1, 0.09, scale) },
      transform: {
        position: vec(-0.52 + index * 0.15, 1.58 - Math.sin(index / 7 * Math.PI) * 0.16, -0.43, scale),
        rotation: [0, 0, index * 0.18]
      },
      destructionGroup: 'caster-equipment', tags: ['casts-shadows', 'belt-chain']
    });
  }
  nodes.push(
    {
      id: 'boot-left', parent: 'body', material: material.leather,
      primitive: { kind: 'box', size: vec(0.34, 0.22, 0.56, scale) },
      transform: { position: vec(-0.3, 0.14, -0.24, scale), rotation: [0, -0.12, -0.03] },
      destructionGroup: 'caster-body', tags: ['casts-shadows', 'boot']
    },
    {
      id: 'boot-right', parent: 'body', material: material.leather,
      primitive: { kind: 'box', size: vec(0.34, 0.22, 0.56, scale) },
      transform: { position: vec(0.31, 0.14, -0.24, scale), rotation: [0, 0.18, 0.025] },
      destructionGroup: 'caster-body', tags: ['casts-shadows', 'boot']
    }
  );

  for (let index = -3; index <= 3; index++) {
    const side = Math.abs(index) / 3;
    nodes.push({
      id: `robe-panel-${index + 3}`, parent: 'body', material: index % 3 === 0 ? material.robeRot : index % 2 === 0 ? material.robe : material.robeEdge,
      primitive: { kind: 'box', size: vec(0.27 + (index % 2 === 0 ? 0.04 : 0), 1.72 - side * 0.2 - (index % 3) * 0.08, 0.5 + side * 0.1, scale) },
      transform: {
        position: vec(index * 0.15, 0.91 + side * 0.04 + (index % 2) * 0.035, -0.01 + side * 0.045, scale),
        rotation: [side * 0.045, index * -0.035, index * -0.052]
      },
      destructionGroup: 'caster-robe', tags: ['casts-shadows', 'robe-panel']
    });
  }

  for (let index = 0; index < 9; index++) {
    const slot = index - 4;
    nodes.push({
      id: `robe-fray-${index}`, parent: 'body', material: index % 3 === 0 ? material.robeRot : material.robeEdge,
      primitive: { kind: 'box', size: vec(0.16 + (index % 2) * 0.05, 0.42 + (index % 3) * 0.12, 0.34, scale) },
      transform: {
        position: vec(slot * 0.12, 0.18 + (index % 2) * 0.08, -0.04 + Math.abs(slot) * 0.025, scale),
        rotation: [0.05 * (index % 3 - 1), slot * -0.035, slot * -0.075]
      },
      destructionGroup: 'caster-robe', tags: ['casts-shadows', 'ragged-hem']
    });
  }

  const sleeveFrays: Array<[number, number, number, number]> = [
    [-0.98, 1.96, -0.04, 0.18], [-1.02, 1.78, -0.02, -0.12],
    [1.55, 2.73, -0.13, -0.28], [1.66, 2.88, -0.16, 0.2]
  ];
  sleeveFrays.forEach(([x, y, z, cant], index) => {
    nodes.push({
      id: `sleeve-fray-${index}`, parent: 'body', material: index % 2 ? material.robeRot : material.robeEdge,
      primitive: { kind: 'box', size: vec(0.18, 0.46, 0.28, scale) },
      transform: { position: vec(x, y, z, scale), rotation: [0.05, -0.06, cant] },
      destructionGroup: index < 2 ? 'caster-staff-arm' : 'caster-casting-arm', tags: ['casts-shadows', 'ragged-sleeve']
    });
  });

  for (let index = 0; index < 5; index++) {
    const spread = (index - 2) * 0.095;
    nodes.push({
      id: `casting-finger-${index}`, parent: 'body', material: material.skin,
      primitive: { kind: 'box', size: vec(0.09, 0.28 + (index % 2) * 0.06, 0.09, scale) },
      transform: {
        position: vec(1.82 + spread, 3.31 + Math.abs(index - 2) * -0.028, -0.24, scale),
        rotation: [0.08 * (index - 2), 0, -0.08 + spread]
      },
      destructionGroup: 'caster-casting-arm', tags: ['casts-shadows', 'finger']
    });
  }

  const lanternBars: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  lanternBars.forEach(([x, z], index) => {
    nodes.push({
      id: `lantern-bar-${index}`, parent: 'body', material: material.lanternFrame,
      primitive: { kind: 'box', size: vec(0.065, 0.5, 0.065, scale) },
      transform: { position: vec(-1.66 + x * 0.18, 2.25, -0.02 + z * 0.18, scale), rotation: [0, Math.PI / 4, -0.04] },
      destructionGroup: 'caster-lantern', tags: ['casts-shadows', 'lantern-frame']
    });
  });

  return {
    nodes,
    emitters: [{
      id: 'lantern-glow', kind: 'point-glow', parent: 'body', position: vec(-1.66, 2.25, -0.02, scale),
      color: [1, 0.5, 0.12], intensity: 1.45, range: 4.8 * scale
    }]
  };
}
