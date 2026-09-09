# Voxel Engine Improvement Plan

## Investigation Summary

I performed a deep audit of `packages/voxel-core` and all consumers (`client/src/babylon/voxel/`,
`packages/voxel-lab/`), including headless diagnostic runs of `computeGreedyGeometry` on
`skeletonEnemy()` with per-quad reconstruction.

### How the Engine Works

```
Voxel Builders (voxel-builders.ts)
  → Voxel[] (array of {x,y,z,sx,sy,sz,color})
    → computeGreedyGeometry(voxels, flat) → GreedyGeometry {positions, indices, colors, normals}
    → OR buildVoxelMesh (naive: per-cell CreateBox + MergeMeshes)
      → normalizeMesh (scale to height 1)
```

**Two meshing strategies:**
- **Greedy** (`voxel-greedy.ts`): sweeps 3 axes, builds 2D face masks per layer boundary,
  greedy-merges into maximal axis-aligned quads. Exports raw vertex buffers (positions/indices/colors/normals).
- **Naive** (`voxel-builder.ts:buildVoxelMesh`): creates one `CreateBox` per unique voxel cell,
  bakes per-vertex tint+AO+color, merges with `Mesh.MergeMeshes`, normalizes to height 1.

**Two consumers:**
- **Voxel Lab** (`packages/voxel-lab/src/scenes/greedy-lab.ts`): has its OWN naive/greedy rendering
  (separate from the game's `voxel-builder.ts`).
- **Game** (`client/src/babylon/voxel/voxel-builder.ts`): shared `buildVoxelMesh` (naive) and
  `buildVoxelMeshGreedy` used by `asset-catalog.ts`, `voxel-parts.ts`, terrain.

---

## Root Cause Analysis

### Bug A — Greedy: "flat rectangles at different depths, eyes on inside of skull"

**Diagnostic result:** The greedy mesher produces geometrically correct output.
- Eye voxels at (-1,17,1) and (1,17,1) correctly overwrite skull bone cells in the `cells` map
  → eye-red color key (`FF2E1F`) differs from bone key (`B8B5AD`).
- The mask at axis=2 (Z), d=2 correctly shows eye keys at X=-1 and X=1, Y=17.
- The greedy merge correctly produces separate 1×1 eye quads at z=1.5 with `ownColor=(1.00, 0.18, 0.12)`.
- Face positions span the correct bounding box: Z∈[-1.5, 1.5], Y∈[-0.5, 19.5].

**The geometry is correct. The defect is in how Babylon.js consumes it.**

**Likely causes (ranked by probability):**

#### Cause A1 (MEDIUM): `diffuseColor` dims vertex colors unevenly, destroying depth cues
```typescript
// voxel-builder.ts (both game + lab)
mat.diffuseColor = new Color3(0.82, 0.82, 0.82);
```
The greedy mesher bakes face orientation into vertex colors:
- Top faces: tint ×1.0, then diffuse ×0.82 = **0.82**
- Side faces: tint ×0.6, then diffuse ×0.82 = **0.49**
- Bottom faces: tint ×0.38, then diffuse ×0.82 = **0.31**

Side faces are 2.6× darker than top faces. When the model is lit by directional light, this
causes extreme contrast that makes different faces look like they're at different "depths"
because the human visual system interprets brightness as surface angle × light direction.
Since the face tint is baked *before* lighting, the lighting pass multiplies it *again*,
producing a lighting + tint product that doesn't correspond to any real surface orientation.

**Fix:** Set `diffuseColor = (1, 1, 1)` so vertex colors pass through unmodified.
The face tint is already baked at the correct magnitude for the desired dark-fantasy look.

#### Cause A2 (LOW): Potential winding mismatch for specific face-axis-sign combinations
Face vertices are emitted in a consistent order (`v0→v1→v2, v0→v2→v3`). The sign of the
cross product depends on the axis and u/v axis ordering. For axis=1 (Y faces), the u/v
ordering differs from axis=0 and axis=2, which could produce inside-out winding for Y-top
or Y-bottom faces in Babylon's left-handed coordinate system.

**Fix:** Write a visual winding verification test that renders a single cube's 6 faces
in Babylon and checks that all faces are front-face visible from their normal direction.
If any face shows inside-out, fix the winding for that axis-sign pair.

#### Cause A3 (LOW): No explicit `mesh.useVertexColors = true`
Babylon 7.x uses `mesh.useVertexColors` (default `true`) to enable the VERTEXCOLOR shader
define. But `vd.applyToMesh(mesh, false)` does NOT guarantee this flag stays true after
subsequent operations (e.g., `bakeTransformIntoVertices`).

**Fix:** Add explicit `mesh.useVertexColors = true` after `vd.applyToMesh`.

---

### Bug B — Naive: "unpainted and too big"

There are TWO separate naive implementations. Both have bugs.

#### Bug B1: Voxel Lab's naive path (greedy-lab.ts) — CONFIRMED BROKEN

```typescript
function buildNaiveMesh(voxels: Voxel[]): Mesh {
    const root = new Mesh('naive-root', scene);
    for (const v of voxels) {
      const box = MeshBuilder.CreateBox('v', { size: 1 }, scene);
      box.position.set(v.x, v.y, v.z);
      box.parent = root;
    }
    // ...
}
```

**Problems:**
1. **No vertex colors** — boxes are plain white (CreateBox has no vertex color data by default).
   The greedy mesh has per-face tinted vertex colors → color mismatch between modes.
2. **No size normalization** — boxes are at integer positions (e.g., skeleton Y∈[0,19]), producing
   a 20-unit-tall mesh. Greedy mesh is scaled to height=3. Naive is ≈6.7× bigger.
3. **All 189 voxels** rendered as individual boxes — no deduplication (skull bone at same
   position as eye → 2 boxes overlapping, Z-fighting).

#### Bug B2: Game's naive path (`buildVoxelMesh`) — PARTIALLY CORRECT

The game path DOES set vertex colors and normalize. However:
1. **`diffuseColor = (0.82, 0.82, 0.82)`** — same double-tinting as greedy (see Cause A1).
2. **No explicit `mesh.useVertexColors`** — relies on default, which is fragile.
3. **Deduplication uses Map** — loses non-unit cube voxels (see Bug D).

---

### Bug C — Code Duplication: Lab has separate rendering code

```
Game:  buildVoxelMesh()      / buildVoxelMeshGreedy()   → normalizeMesh
Lab:   buildNaiveMesh()      / buildGreedyMesh()          → manual scaling
```

The lab should use the SAME functions as the game. The lab's `buildNaiveMesh` is a
completely separate, broken implementation. The lab's `buildGreedyMesh` does manual
`mesh.scaling.setAll(s)` instead of `bakeTransformIntoVertices`, producing a different
pivot behavior.

**Fix:** Refactor `greedy-lab.ts` to use `buildVoxelMesh` and `buildVoxelMeshGreedy`
from `client/src/babylon/voxel/voxel-builder.ts`.

---

### Bug D — `computeGreedyGeometry` ignores non-unit voxel sizes

```typescript
// voxel-greedy.ts, computeGreedyGeometry:
for (const v of voxels) {
    cells.set(`${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`, v.color);
}
```

The `Voxel` type has `sx, sy, sz` fields, but the greedy mesher assumes all voxels are
unit cubes (ignores `sx/sy/sz`). The `box3` and `cube` helpers always produce `sx=sy=sz=1`,
so procedural models are fine. But imported VOX models (via `voxel-io/vox-importer.ts`)
can have non-unit voxels.

**Fix:** Either:
- Add validation in `computeGreedyGeometry` that rejects non-unit voxels, OR
- Extend the greedy algorithm to handle non-unit sizes.
- Recommend: *reject with clear error* and route to naive for non-unit voxels.

---

### Bug E — Face tint overapplied (see Cause A1, applies to both modes)

The face tint (TOP=1.0, SIDE=0.6, BOTTOM=0.38) is baked into vertex colors. But the
material's diffuseColor (0.82) further dims everything. The result: side faces are at
0.49 brightness before lighting, bottom faces at 0.31 — producing a "flat 2D paper"
illusion because the normal-dependent shading from the renderer is fighting the
pre-baked face-darkening.

**The correct approach** would be ONE of:
- (A) Set `diffuseColor = (1, 1, 1)` and let vertex colors carry all the tinting.
- (B) Remove face tint from vertex colors and use a material with per-face diffuse
  (requires separate materials per face direction — impractical for merged meshes).

**Recommendation: (A)** — keep the baked tints and remove the diffuse dimming.

---

## Improvement Plan

### Phase 1: Fix Naive Mode (Critical — user-visible)

1. **Fix greedy-lab's naive path** — Replace `buildNaiveMesh()` with a call to
   `buildVoxelMesh()` from `voxel-builder.ts`.
   - File: `packages/voxel-lab/src/scenes/greedy-lab.ts`
   - Remove the custom `buildNaiveMesh` function entirely.
   - The lab will then share the game's correctly-colored, correctly-normalized naive path.

2. **Fix greedy-lab's greedy path** — Replace `buildGreedyMesh()` with a call to
   `buildVoxelMeshGreedy()` from `voxel-builder.ts`.
   - This also eliminates the manual height=3 scaling (now uses the game's height=1 normalization).

### Phase 2: Fix Face Rendering (Critical — user-visible)

3. **Fix double-tinting in both game and lab**:
   - In `voxel-builder.ts` (`buildVoxelMesh` and `buildVoxelMeshGreedy`):
     Change `mat.diffuseColor = new Color3(0.82, 0.82, 0.82)` to `Color3(1, 1, 1)`.
   - In `greedy-lab.ts` (`applyMaterial`): Change `diffuseColor` to `(1, 1, 1)` or
     remove entirely (once the lab uses game's builders).
   - In `voxel-parts.ts` (`assembleRig`): Change `diffuseColor` to `(1, 1, 1)`.
   - In `voxel-debris.ts`, `voxel-field.ts`: Change `diffuseColor` to `(1, 1, 1)`.
   - In `voxel-floor.ts`: Change `diffuseColor` to `(1, 1, 1)`.

4. **Add explicit `mesh.useVertexColors = true`**:
   - After `vd.applyToMesh(mesh, false)` in `buildVoxelMeshGreedy`.
   - After `merged.setVerticesData` / `MergeMeshes` in `buildVoxelMesh`.
   - In the lab if it keeps any custom mesh building.
   - Also call `mesh.hasVertexAlpha = false` (or true if alpha < 1).

### Phase 3: Verify Winding (Medium)

5. **Write a unit test** using Babylon `NullEngine` that verifies face visibility:
   - Create a 2×2×2 solid cube via `computeGreedyGeometry`.
   - For each of the 6 face directions, verify that the face's triangle indices produce
     a normal facing outward (cross product sign matches the face's intended normal).
   - This test catches any axis-sign winding bugs.

6. **Manual visual smoke test** in the game:
   - Load skeleton enemy with greedy meshing.
   - Rotate 360° around Y axis.
   - Verify: all faces visible from correct angle, no inside-out faces, eyes are red and
     on the front of the skull.
   - Repeat for naive meshing (projectile:bolt) — verify correct color and height.

### Phase 4: Structural Improvements (Medium)

7. **Validate voxel sizes in greedy mesher**:
   - In `computeGreedyGeometry`, check that all voxels have `sx=sy=sz=1`.
   - If any non-unit voxel found, throw or fall back to naive with a warning.

8. **Consolidate lab rendering**:
   - Move the game's `buildVoxelMesh` and `buildVoxelMeshGreedy` into `voxel-core` so
     they're the single source of truth (currently they're in `client/`).
   - The lab can then import them from `@tower/voxel-core` directly.

9. **Add vertex color type definition**:
   - `GreedyGeometry.colors` is typed as `number[]` (RGBA flat). Add a helper that lets
     consumers validate color array length and format.

### Phase 5: Testing (Medium)

10. **Extend smoke-voxel-mesh.ts**:
    - Add per-quad color verification: for a small test model with known colors
      (e.g., 2×2×2 with red front face, blue top face), verify that each face's
      vertex colors match expected (after tint/AO).
    - Add winding verification (see item 5).

---

## File Manifest (What Changes)

| File | Change |
|------|--------|
| `client/src/babylon/voxel/voxel-builder.ts` | diffuseColor → (1,1,1); add useVertexColors |
| `client/src/babylon/voxel/voxel-parts.ts` | diffuseColor → (1,1,1) |
| `client/src/babylon/voxel/voxel-debris.ts` | diffuseColor → (1,1,1) |
| `client/src/babylon/voxel/voxel-field.ts` | diffuseColor → (1,1,1) |
| `client/src/babylon/voxel/voxel-floor.ts` | diffuseColor → (1,1,1) |
| `packages/voxel-lab/src/scenes/greedy-lab.ts` | Rewrite: use game's builders |
| `packages/voxel-core/src/voxel-greedy.ts` | Add non-unit voxel validation |
| `scripts/smoke-voxel-mesh.ts` | Add winding + color verification |
| NEW: `scripts/smoke-voxel-winding.ts` | Winding test with NullEngine |

---

## Priority Order

1. **Phase 1-2** (immediate): Fix naive mode colors/size + face tinting → user sees
   identical-looking models in both modes.
2. **Phase 3** (high): Verify/correct winding → fix any inside-out faces.
3. **Phase 4-5** (medium): Structural cleanup + tests → prevent regression.
