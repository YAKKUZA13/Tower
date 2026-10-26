# Asset pipeline: plan and acceptance gates

Status: active. Scope: reusable runtime-generated assets, not a new ARPG and not
completion of the ritual scene. Research: [asset-contract-research.md](asset-contract-research.md).

## Target

A separate game can load an agent-authored JSON character, reject invalid input
before allocating geometry, build articulated geometry at runtime, attach equipment
to named sockets, and play documented animations through public engine APIs.
No prebuilt model files, game-client imports, executable expressions or silent fallbacks.
"Prime" means the following gates pass; it is not a claim about the current version.

| Stage | Deliverable | Exit gate | Depends on |
| --- | --- | --- | --- |
| A0 | Research and coordinate/compatibility decisions | Sources, alternatives, limitations recorded | — |
| A1 | Character recipe v1, schema, validator, compiler, animation sampling | Valid/invalid fixtures, bounded work, deterministic round trips, public-API render preview | A0 |
| A2 | Runtime templates and material channels | Instances share geometry, poses stay independent; dispose in either order is safe; emission does not light the whole body | A1 |
| A3 | Animation runtime | Named clips, explicit action events, transitions, interruption, rest-pose reset; no Tower cooldown dependencies | A1–A2 |
| A4 | Asset authoring lab and engine skill | Humanoid, nonhumanoid and equipment recipes; part/socket inspection; front/side/back/orbit and motion review; a new agent can use only the skill and public API | A1–A3 |
| W1 | Opt-in WebGPU in voxel-lab | Explicit backend/result/error reporting; unsupported/init-failure fallback; same fixtures on WebGL and WebGPU | Can start after A1 |
| W2 | Renderer compatibility/performance | Remove unsupported formats; shader/lighting/resize/disposal parity; real Android/iOS evidence and equal-quality CPU/GPU/startup comparison | W1, A4 |
| E1 | Package independence | No engine dependency on Tower shared/client/server; samples outside library exports | Can proceed alongside A2–A4 |
| E2 | Release packaging | Built JS/d.ts in tarballs; clean external consumer installs; dependency/version/license choices explicit; release CI | E1, A4 |
| E3 | Separate engine repository | Tower consumes released packages without regressions; repository migration preserves history/ownership | E2 |
| G1 | Small ARPG | Begin game development only after extraction; reuse engine, keep loot/quests/game rules in game | E3 |

## Current implementation status — 2026-10-19

| Stage | Status | Evidence / remaining gate |
| --- | --- | --- |
| A0 | Verified | Research, primary sources and img2threejs adaptations documented |
| A1 | Verified candidate v1 | Schema/semantic limits, deterministic compile, negative fixtures, visible public-API preview |
| A2 | Verified | 100-instance shared geometry, independent poses/material regions, anchored equipment, disposal in both orders |
| A3 | Verified | Transitions, interruption, markers, completion, seek/rest reset and bounded event delivery |
| A4 | Implemented; final evaluation open | Three recipe categories, picking/explode/socket/motion inspection and packaged skill work; independent fresh-agent authoring trial remains |
| W1 | Verified lab experiment | Default WebGL, opt-in actual WebGPU, injected failure/fallback tests; no Tower backend switch |
| W2 | Desktop subset verified; mobile open | Native desktop visual/error/resize checks pass; real iPhone not run, Android unavailable; no GPU speedup conclusion |
| E1 | Verified | Six libraries have no Tower shared/client/server dependencies; ritual samples live in voxel-lab |
| E2 | Local packaging verified; release held | Packed JS/d.ts and skill pass external consumer; CI workflow added but not remotely run; owner explicitly keeps packages private pending license |
| E3 | Prepared, not migrated | Engine-only export + verified original-history bundle; no filtered-history repo/remote or Tower released-package switchover yet |
| G1 | Not started | ARPG stays after extraction; loot/quests/combat are not added to the engine contract |

Owner decisions: separate repository name **Voxkera**; packages remain
`private: true`, `license: UNLICENSED` until a license is chosen. Do not infer npm
publication authorization from packaging tests. Package scope remains `@tower` for
now; choosing a repository name does not reserve a registry namespace.

## Completed implementation checklist

- [x] A0: researched choices and local img2threejs adaptations documented.
- [x] A1: strict versioned data schema and cross-reference/resource validation.
- [x] A1: deterministic per-part box/ellipsoid compilation to existing CharacterDef.
- [x] A1: socket and explicitly timed rigid animation support without client code.
- [x] A1: lab preview, negative fixtures, render/disposal verification.
- [x] A2: one meshed template per family, shared geometry/materials and independent poses.
- [x] A2: palette emission/specular regions and explicit ownership/disposal tests.
- [x] A3: public player with fades, interruption, action markers, one-shot completion and seek.
- [x] A4 implementation: humanoid, creature, equipment; part picking, sockets, grip attachment, explode and review views.
- [x] A4 implementation: self-contained packaged `tower-assets/SKILL.md`, reference and validated starter.
- [x] E1: terrain structural types separated from shared; game fixtures removed from engine exports.
- [x] E2 local: six tarballs install, run and typecheck outside the workspace, including the packaged skill starter.
- [x] W2 desktop: replace LUMINANCE noise upload with RGBA and correct the pinned Babylon emissive WGSL branch.
- [ ] A4 acceptance: independent fresh agent authors a new asset using only the packaged skill/public API; review its output.
- [ ] W2 acceptance: real iPhone result JSON + screenshots, then real Android evidence when available.
- [ ] E2 release: choose license, review CI result and approve a private/public distribution strategy explicitly.
- [ ] E3 acceptance: filter/review history, create private Voxkera remote and verify Tower consuming the extracted versions.

Items are checked only after verification. A1 is a limited candidate v1, not a freeze
of the entire future SDK. Existing building recipes and CharacterDef generators must
continue working; this slice does not quietly migrate their units or semantics.

## Protocol decisions

- New character format is separate from static Building recipe v3.
- Explicit Y-up, X-right, +Z character-forward model coordinates; voxel centres are
  integers. Pivots, shape coordinates and socket positions are absolute model-grid
  coordinates. The renderer converts to parent-local transforms once.
- Clip time is seconds, rotations are YXZ Euler radians in [X,Y,Z] tuples
  (Babylon yaw/pitch/roll), relative to rest pose.
  Rotation samples interpolate component-wise, not quaternion shortest-arc rotation.
- Validate unknown JSON before generating voxels. Hard host ceilings bound file size,
  parts, keys, candidate cells and generated cells; asset budgets may only tighten them.
- Unknown fields/capabilities are errors. No eval, arbitrary JS, URLs, expressions,
  downloaded geometry or implied physics in the format.
- Structural validation is not visual approval. Required views/features are review
  instructions, never an automatic claim that quality passed.

## Checkpoints

After each slice run its fixtures and relevant existing regressions. Before declaring
the asset subsystem prime: full typecheck/build, external-consumer test, browser
console/network/visual checks, bounded clone/spawn workload, repeated scene disposal,
and device evidence. Do not fix a failing resource test by raising a magic threshold.
Keep WebGPU experimental until W2; do not couple ARPG gameplay to a GPU-only feature.

## Verified checkpoint and reproduction

Public pipeline: engine-recipe schema/validation → voxel-core compilation/player →
voxel-babylon template/instances. Zod is pinned to 4.6.7; Babylon peers to 7.54.3.
The warden has 11 parts / 353 voxels; lantern-beetle and rune-sword exercise
nonhumanoid articulation, material regions and anchored equipment. These are
technical blockouts, not art-approved heroes or a claim of image likeness.

`smoke-character-runtime.ts` checks three cycles of 100 actors, sharing 11 geometry
objects while keeping poses independent. It also checks attachments at rest/in
motion, detached ownership, events, fades, interrupted fades and transactional
event delivery limits. Fades snapshot the displayed source pose; no blend tree,
IK, skinning or root-motion is implied.

The browser suite covers invalid-edit preservation, rebuild/tab-switch resource
stability, all three recipes, four warden views, actual pointer picking, animated
equipment, ritual PBR noise/emitters, resize and native/540p resolution. It checks
canvas pixels, not merely scene counters, and treats GPU validation warnings as
failures. Captures and JSON reports are ignored artifacts under
`artifacts/character-assets`. Native desktop adapters observed: WebGL ANGLE AMD
Radeon 610M/D3D11; WebGPU AMD RDNA-2. This is not iPhone or Android evidence.

The previous hybrid smoke's 476-vs-460 failure is resolved by exact accounting of
actual geometry masters, render instances and emitter meshes, not by increasing a
magic allowance. Disposal still has to return to the original resource counts.

Commands (see [verification runbook](asset-contract-verification.md) for devices,
equal-configuration measurements and extraction):

```sh
npm run smoke:assets
npm run smoke:assets:browser
npm run smoke:assets:browser -- webgpu
npm run smoke:engine:consumer
npm run typecheck
npm run build
node --import tsx scripts/smoke-hybrid-scene.ts
npm run dev:lab
```

URLs: `http://127.0.0.1:5184/#character` and
`http://127.0.0.1:5184/?backend=webgpu#character`.

Next gates, in order: independent authoring evaluation; real iPhone test using the
lab's result exporter; Android coverage when hardware is available; license/release
decision; reviewed history migration to private Voxkera; Tower regression on the
extracted packages. A complete WebGPU migration or a separate GitHub repository is
not claimed merely because an extraction snapshot and desktop experiment pass.
