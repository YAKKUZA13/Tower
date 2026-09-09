# @tower/voxel-babylon

Babylon adapter for renderer-independent `@tower/voxel-core` geometry.

## Geometry

```ts
import { createMasonryVoxels } from '@tower/voxel-core';
import { buildVoxelMeshGreedy } from '@tower/voxel-babylon';

const voxels = createMasonryVoxels({
  width: 80, height: 35, depth: 5,
  brickWidth: 14, brickHeight: 7,
  joint: 1, relief: 2, chipChance: 0.15, seed: 17,
});
const wall = buildVoxelMeshGreedy(scene, voxels, {
  name: 'wall', normalize: false,
});
wall.scaling.setAll(0.1); // one grid cell = 0.1 world units
```

`normalize` defaults to `true`: height 1, XZ centered, base at Y = -0.5.
Both naive and greedy builders support `normalize: false` to preserve cell coordinates.
Cell centers are integers and cell boundaries are at +/-0.5.
World bounding boxes remain responsive to subsequent mesh transforms.

Use `applyGreedyGeometry(mesh, geometry)` when creating a mesh with custom materials
or transforms. It converts the core's outward cross-product winding to Babylon's
native triangle convention without modifying the source arrays. Core normals remain
unchanged. Directly uploading core indices with default Babylon culling shows the
inside of the object; disabling backface culling conceals that defect.

Masonry is deterministic running-bond geometry with a closed one-cell backing,
recessed joints, per-brick relief and edge chips. `width` and `height` span the face;
`depth` bounds its thickness. `orientation: 'floor'` maps the face to XZ with relief
along +Y; the default wall faces +Z. The default candidate-cell budget is 250,000.
It generates unit cells, so cell density is controlled by mesh scale rather than
non-unit voxel sizes. This is a surface builder, not a structural damage simulator.

## Lighting stage

```ts
import { createVoxelStage } from '@tower/voxel-babylon';

const stage = createVoxelStage(scene, camera, {
  viewHeight: 12, pixelHeight: 540, shadowMapSize: 1024,
});
stage.addMesh(wall);
stage.addPointLight(position, color, 3, 6);
// Before reusing a mesh outside the stage:
stage.removeMesh(wall);
// When leaving the scene/preview:
stage.dispose();
```

Use one stage per scene. It provides an orthographic projection, a warm directional
key with a shadow map, cool hemispheric fill and up to two local point lights.
Disable the consumer's other lights if you want the stage's four-light setup;
existing lights and meshes are not disposed or silently disabled by the stage.

`setPixelHeight(360 | 540 | 0)` selects render height (0 = native resolution).
The nearest-sampled postprocess uses one scene render; it does not render a separate
copy of the scene. Its width follows the engine's backbuffer aspect ratio.
`setViewHeight()` changes orthographic framing. Engine resize updates projection and
render-target size. Mesh disposal automatically removes shadow registration.
`dispose()` is idempotent and restores camera projection, clear color and surviving
meshes' previous shadow-receiver flags.

Local lights are direct illumination without local shadow maps. This stage does
not implement voxel GI, SSAO, bloom, temporal camera snapping or a material system
for independently emissive voxel regions. Existing baked voxel AO and face tint
remain active. WebGL was verified; WebGPU is not an acceptance claim.

## Lab and verification

Build dependencies with `npm run build:pkgs`, then run:

```sh
npm --workspace @tower/voxel-lab run dev -- --host 127.0.0.1 --port 5184 --open false
node --import tsx scripts/smoke-voxel-stage.ts
```

Open `http://127.0.0.1:5184/#material`. Gallery and Courtyard use the same public APIs
with different assemblies. Controls cover seed, lighting, render resolution and
orthographic view height. Other lab tabs and client voxel rigs/fields also use the
common geometry upload function.

The smoke verifies masonry occupancy and bounds, both normalization modes,
transformed bounds, winding against native Babylon boxes in LH/RH scenes, render
size, light budget and resource/state restoration across repeated disposal.
Visual verification must additionally inspect outside faces, shadows, colored light,
resizing and scene switching in the browser. Passing these checks does not establish
reference-level asset detail or a target GPU frame-time budget.
