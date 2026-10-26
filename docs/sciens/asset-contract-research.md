# Runtime asset contract research

Research date: 2026-10-19. Installed renderer: Babylon.js 7.54.3.

## Existing systems and what we take

1. [Bedrock geometry](https://learn.microsoft.com/en-us/minecraft/creator/reference/content/schemasreference/schemas/minecraftschema_geometry_1.14.0?view=minecraft-bedrock-stable)
   documents bone hierarchies, pivots and cube geometry in JSON. This is evidence
   that articulated low-detail model authoring can be data-driven. We adopt named
   parts and explicit pivots, not Bedrock compatibility or its units/rotation rules.
2. [glTF 2.0](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc)
   separates scene nodes, animation samplers and channels. We adopt independent
   node-targeted clips. glTF does not specify gameplay playback policy and is not
   our procedural source language; importing meshes is not needed for this path.
3. [Bedrock animation controllers](https://learn.microsoft.com/en-us/minecraft/creator/documents/animations/animationcontroller?view=minecraft-bedrock-stable)
   illustrate separate animation/state control. A future controller belongs above
   clip sampling; do not make a JSON geometry compiler understand Tower's cooldowns.
4. [Zod JSON Schema support](https://zod.dev/json-schema) allows one structural schema
   to drive inferred TypeScript types, runtime parsing and exported JSON Schema.
   Choose Zod 4.6.7 (registry version checked) rather than three hand-maintained
   descriptions. Reference integrity, cycles and cumulative resource limits still
   require semantic validation and cannot be promised by structural JSON Schema.
5. [Blockbench](https://github.com/JannisX11/blockbench) is an authoring/reference tool,
   not a runtime dependency. Its repository declares GPL-3.0-or-later. We do not
   copy its implementation into engine packages. This is a provenance decision,
   not a legal compatibility determination for all future integrations.

## Adaptation from the local img2threejs skill

Reviewed local skill v1.4.3 and `action_rigging.md`, `joint_attachment.md`,
`quality_contract.md`. This is contract research, not reconstruction of an image;
no sculpt-generation passes or visual similarity scores were run.

Adopt the separation of specification from renderer objects; stable component IDs;
pivot hierarchies; named grip/effect sockets; explicit supported capabilities; review
of structural coverage and multiple views. A valid JSON file is not proof that a
shape looks correct or that an attachment remains connected while moving.

Do not import its Three.js factory, CS2 intake pipeline, photo projection requirement
or likeness thresholds into a procedural voxel SDK. They solve different tasks.
No code from the skill is copied; source attribution should be revisited if that changes.

## Initial audit and design (before implementation)

Building recipe v3 merges all parts into static voxels; it is not suitable for limbs.
CharacterDef supports rigid parts, but the application's animation drivers are in
client renderers. Define a separate `kind: character`, `formatVersion: 1` contract
in engine-recipe, compile its geometry in voxel-core, render it in voxel-babylon.
Retain per-part geometry and compile named sockets/clip metadata separately.

First scope: boxes and ellipsoids, palette RGB, bounded model-space coordinates,
one rooted acyclic part hierarchy, named sockets, rigid linear/step clips in seconds.
No rest-pose rotations, arbitrary CSG, textured/PBR regions, blend trees, skinning,
IK, morph targets, root-motion, humanoid retargeting or executable procedural rules.
Unsupported inputs fail rather than being silently approximated.

## WebGPU and extraction research track

[Babylon's WebGPU backend](https://doc.babylonjs.com/setup/support/webGPU/) uses async
initialization; it is not a new voxel data model. Test opt-in backend selection in
the lab before changing Tower startup. [GLSL compatibility](https://doc.babylonjs.com/setup/support/webGPU/webGPUWGSL/)
can require runtime WASM translation; native WGSL is a later startup optimization.
The installed texture helper rejects LUMINANCE, originally used for scene surface
noise. The implementation now uploads deterministic RGBA instead. Native desktop
WebGL/WebGPU captures exercise the ritual's PBR noise, emitters and stage lighting.

Initial packaging audit: all six library dry-run tarballs omitted dist while exporting
dist/index.js and exposed source types. Manifests now include built JS/declarations,
and six packed tarballs pass a clean external runtime/type consumer. Packages remain
private/UNLICENSED by the owner's decision. See the roadmap for current evidence;
research alone never establishes mobile performance.

## Observed WebGPU compatibility failure

Native Chrome on AMD RDNA-2 rejected Babylon 7.54.3's StandardMaterial
EMISSIVEASILLUMINATION branch: its WGSL `clamp(vec3, 0.0, 1.0)` uses scalar bounds.
The [WGSL clamp overloads](https://www.w3.org/TR/WGSL/#clamp-builtin) require matching
vector operands here. The character adapter uses the material's public final-shader
processing hook to replace only that expression's bounds with vec3 values. No global
shader-store mutation, dependency-file patch, emission removal or backend fallback.
Before the fix, meshes and ready counters passed despite a completely blank canvas.
Browser gates now inspect canvas pixels and fail on GPU validation warnings as well
as console errors. This is why resource/ready assertions alone are insufficient.
