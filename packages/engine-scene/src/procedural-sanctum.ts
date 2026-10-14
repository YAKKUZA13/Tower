import { createRitualSanctumKit, type RitualSanctumOptions } from './ritual-sanctum.js';
import { instantiateSceneFragment } from './fragment.js';
import { createSceneRandom } from './random.js';
import type { SceneKitSpec, SceneNodeSpec } from './types.js';

export interface ProceduralSanctumOptions extends RitualSanctumOptions {
  density?: number;
}

/**
 * Seeded scene grammar around the authored composition skeleton. Critical focal
 * features stay stable; ruin rhythm, rubble, marker heights and damage vary.
 */
export function generateProceduralSanctum(options: ProceduralSanctumOptions = {}): SceneKitSpec {
  const seed = options.seed ?? 0x51a7c7;
  const scale = options.scale ?? 1;
  const density = Math.max(0, Math.min(1, options.density ?? 0.72));
  const random = createSceneRandom(seed).next;
  const spec = createRitualSanctumKit(options);
  spec.name = `ritual-sanctum-${seed.toString(16)}`;

  for (const node of spec.nodes) {
    if (node.id.startsWith('ruin-') && !node.id.includes('-base') && !node.id.includes('-shaft') && !node.id.includes('-cap')) {
      node.terrainAnchor = { offset: 0 };
      const position = node.transform?.position ?? [0, 0, 0];
      const rotation = node.transform?.rotation ?? [0, 0, 0];
      position[0] += (random() - 0.5) * 0.45 * scale;
      position[2] += (random() - 0.5) * 0.45 * scale;
      rotation[1] += (random() - 0.5) * 0.3;
      node.transform = { ...node.transform, position, rotation };
    }
  }

  const extra: SceneNodeSpec[] = [];
  const wallCount = Math.round(6 + density * 8);
  for (let index = 0; index < wallCount; index++) {
    const angle = index * Math.PI * 2 / wallCount + (random() - 0.5) * 0.16;
    // Preserve two broad diagonal gameplay gates through the landmark.
    const gateDistance = Math.min(
      Math.abs(Math.atan2(Math.sin(angle - Math.PI / 4), Math.cos(angle - Math.PI / 4))),
      Math.abs(Math.atan2(Math.sin(angle - Math.PI * 5 / 4), Math.cos(angle - Math.PI * 5 / 4)))
    );
    if (gateDistance < 0.3) continue;
    const radius = (5.15 + random() * 0.65) * scale;
    const width = (0.75 + random() * 0.85) * scale;
    const height = (0.65 + random() * 1.45) * scale;
    const wallId = `outer-wall-${index}`;
    const materialRoll = random();
    const material = materialRoll > 0.68 ? 'stone-moss' : materialRoll > 0.32 ? 'stone-dark' : 'stone-worn';
    const wallNodes: SceneNodeSpec[] = [{
      id: 'foot', material: 'stone-worn',
      primitive: { kind: 'box', size: [width * 1.18, Math.min(height * 0.24, 0.3 * scale), 0.55 * scale] },
      transform: { position: [0, Math.min(height * 0.12, 0.15 * scale), 0], rotation: [0, 0, (random() - 0.5) * 0.035] },
      tags: ['casts-shadows', 'architectural-course']
    }];
    const courseHeight = height * 0.205;
    for (let course = 0; course < 3; course++) {
      const stagger = (course % 2 === 0 ? -1 : 1) * width * 0.035;
      for (let block = 0; block < 2; block++) {
        const blockWidth = width * (0.46 + (random() - 0.5) * 0.055);
        wallNodes.push({
          id: `course-${course}-${block}`,
          material: random() > 0.78 ? 'stone-highlight' : material,
          primitive: { kind: 'box', size: [blockWidth, courseHeight * 0.9, (0.33 + random() * 0.06) * scale] },
          transform: {
            position: [(block === 0 ? -1 : 1) * width * 0.245 + stagger, height * 0.27 + course * courseHeight, 0],
            rotation: [0, (random() - 0.5) * 0.04, (random() - 0.5) * 0.045]
          },
          tags: ['casts-shadows', 'masonry-block']
        });
      }
    }
    wallNodes.push({
      id: 'cap', material: random() > 0.45 ? 'stone-highlight' : 'stone-worn',
      primitive: { kind: 'box', size: [width * (0.82 + random() * 0.22), 0.18 * scale, 0.48 * scale] },
      transform: { position: [(random() - 0.5) * 0.12 * scale, height * 0.89, 0], rotation: [0, (random() - 0.5) * 0.12, (random() - 0.5) * 0.14] },
      tags: ['casts-shadows', 'broken-cap']
    });
    const wall = instantiateSceneFragment(
      { nodes: wallNodes },
      {
        id: wallId, parent: 'sanctum-root',
        position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
        rotation: [0, -angle + Math.PI / 2, 0],
        terrainAnchor: { offset: 0 },
        collider: { kind: 'box', size: [width, height, 0.48 * scale], navBlocking: true },
        destructionGroup: wallId,
        tags: ['procedural-ruin']
      }
    );
    extra.push(...wall.nodes);
  }

  const rubbleCount = Math.round(8 + density * 14);
  for (let index = 0; index < rubbleCount; index++) {
    const angle = random() * Math.PI * 2;
    const radius = (3.8 + random() * 3.0) * scale;
    const width = (0.15 + random() * 0.38) * scale;
    const height = (0.09 + random() * 0.22) * scale;
    const depth = (0.14 + random() * 0.42) * scale;
    extra.push({
      id: `rubble-${index}`, parent: 'sanctum-root', material: random() > 0.72 ? 'stone-moss' : random() > 0.35 ? 'stone-dark' : 'stone-worn',
      primitive: { kind: 'box', size: [width, height, depth] },
      transform: { position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius], rotation: [(random() - 0.5) * 0.35, random() * Math.PI, (random() - 0.5) * 0.35] },
      terrainAnchor: { offset: height * 0.45 }, tags: ['procedural-rubble']
    });
  }

  // Broken paving extends the landmark into its terrain instead of leaving a
  // clean prop on top of a noise field. It is deliberately non-blocking: the
  // district silhouette may vary without silently changing combat clearance.
  const pavingCount = Math.round(18 + density * 14);
  for (let index = 0; index < pavingCount; index++) {
    const angle = random() * Math.PI * 2;
    const radius = (4.45 + Math.pow(random(), 0.72) * 4.1) * scale;
    const tangent = angle + Math.PI / 2 + (random() - 0.5) * 0.34;
    const width = (0.62 + random() * 0.9) * scale;
    const depth = (0.34 + random() * 0.55) * scale;
    extra.push({
      id: `district-paving-${index}`,
      parent: 'sanctum-root',
      material: index % 9 === 0 ? 'stone-moss' : index % 4 === 0 ? 'stone-worn' : 'ritual-slab',
      primitive: { kind: 'box', size: [width, 0.055 * scale, depth] },
      transform: {
        position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
        rotation: [(random() - 0.5) * 0.035, -tangent, (random() - 0.5) * 0.035]
      },
      terrainAnchor: { offset: 0.035 * scale },
      tags: ['district-floor', 'procedural-paving', 'receives-shadows']
    });
  }

  // A sparse fractured tile field fills the negative space between the ritual
  // dais and outer ruins. It stays deterministic and non-blocking.
  let gridIndex = 0;
  for (let row = -4; row <= 4; row++) {
    for (let col = -5; col <= 5; col++) {
      const x = col * 1.16 * scale;
      const z = row * 1.02 * scale + 0.28 * scale;
      const distance = Math.hypot(x, z);
      if (distance < 4.05 * scale || random() > 0.34 + density * 0.34) continue;
      const width = (0.72 + random() * 0.34) * scale;
      const depth = (0.5 + random() * 0.28) * scale;
      extra.push({
        id: `crypt-paver-grid-${gridIndex++}`,
        parent: 'sanctum-root',
        material: random() > 0.82 ? 'stone-moss' : random() > 0.46 ? 'stone-dark' : 'stone-worn',
        primitive: { kind: 'box', size: [width, 0.045 * scale, depth] },
        transform: {
          position: [x + (random() - 0.5) * 0.16 * scale, 0, z + (random() - 0.5) * 0.14 * scale],
          rotation: [(random() - 0.5) * 0.028, (random() - 0.5) * 0.12, (random() - 0.5) * 0.028]
        },
        terrainAnchor: { offset: 0.03 * scale },
        tags: ['district-floor', 'crypt-paving', 'receives-shadows']
      });
    }
  }

  spec.nodes.push(...extra);
  spec.budget.maxNodes = 480;
  spec.budget.maxEstimatedTriangles = 24_000;
  spec.quality.criticalFeatures.push('seeded outer ruin rhythm with two readable gameplay gates');
  return spec;
}
