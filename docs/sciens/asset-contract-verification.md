# Asset verification and Voxkera handoff

## Desktop reproduction

Use Node 24 (the clean consumer uses native TypeScript stripping) and installed
Chrome, or set `TOWER_CHROME` to an explicit Chromium executable path.

```sh
npm run smoke:assets
npm run smoke:assets:browser -- webgl --native
npm run smoke:assets:browser -- webgpu --native
npm run smoke:engine:consumer
npm run typecheck
npm run build
node --import tsx scripts/smoke-hybrid-scene.ts
node --import tsx scripts/smoke-rts-workers.ts
node --import tsx scripts/smoke-rts-gameplay.ts
```

Browser checks always start/stop an owned lab server on an ephemeral port and write screenshots
and JSON into `artifacts/character-assets`. WebGL without `--native` intentionally
uses SwiftShader for CI; never compare that run to native WebGPU as a speedup.
A requested WebGPU run may fall back: inspect `backend.selected`, not just its URL.
No forced WebGPU availability flags are used.

The controlled desktop measurement uses 60 warmup + 180 sampled frames on the
same rest-pose warden, three-quarter view, 1220×900 canvas and 540p nearest stage.
CPU submission, frame intervals and available GPU timer values are distinct.
Headless RAF intervals are not gameplay FPS. A null GPU timer is missing evidence,
not zero GPU work. Startup is cold-page first-frame timing, not a full asset-ready
or shader-cache-controlled startup benchmark. Use repeated AB/BA runs and a more
representative workload before claiming performance superiority.

## Physical iPhone — pending owner run

Only iPhone is available. Android coverage remains open, not waived or emulated.
Record the actual iPhone model, iOS/Safari versions, thermal/power mode and date.
Do not infer support solely from the OS name: the backend report is authoritative.

1. Build the lab with `npm --workspace @tower/voxel-lab run build`.
   Serve its `dist` over a trusted HTTPS origin accessible from the phone.
   Hosting/upload is a separate explicit action; no site was published here.
   Ordinary HTTP on a LAN IP is not a WebGPU secure context. The API is marked
   [SecureContext in the WebGPU specification](https://gpuweb.github.io/gpuweb/#navigator-gpu).
2. Open `/#character` in Safari in landscape. Then use the same origin's
   `/?backend=webgpu#character`. Save both backend status lines; fallback is a
   compatibility result, not a successful WebGPU renderer test.
3. For each backend inspect warden front/side/back/three-quarter, stride/salute,
   weapon grip through motion, part picking and explode. Repeat with beetle and
   sword; switch to Ritual to inspect PBR bump noise/emission/lighting.
4. Rotate portrait/landscape, resize, rebuild three times and switch tabs three
   times. Check that geometry does not disappear, controls remain usable, and
   there is no persistent resource growth or browser/GPU error.
5. Set the same fixture/view/clip/play state and resolution on both runs. Open
   **Device verification**, measure 60 warmup + 180 frames, then **Download result
   JSON**. Keep the tab visible and do not alter controls during measurement.
   Repeat three times per backend, alternating order; stop if the phone heats up.
6. Return JSON files and screenshots together with the device details. Review
   them before checking W2. The exported user-agent alone is not device identity,
   and unavailable GPU timer data remains explicitly missing.

## Fresh-agent authoring trial — pending

Give a fresh agent the installed `tower-assets/SKILL.md`, its bundled references
and public installed packages, not Tower client sources. Ask for a small new
nonhumanoid creature with articulated parts, one emissive region, a grip/effect
socket and a timed action marker. Require recipe JSON, validation output, four
rendered views, motion/attachment checks and an honest limitation report.
Do not accept invented fields, per-character renderer code or schema validation
alone as proof of visual quality. The packaged starter already passes the clean
consumer; that is a portability check, not a behavioral fresh-agent evaluation.

## Private Voxkera extraction

Owner choices: repository **Voxkera**, all packages private until a license is
chosen. `UNLICENSED` records no license grant; it is not an open-source license.
The existing `@tower/*` package scope is deliberately retained for compatibility.

```sh
npm run export:engine -- --history --verify
```

This creates a new ignored `artifacts/engine-export-*` directory containing only
six engine libraries, voxel-lab, independent scripts/docs and generated manifests.
It installs/builds/typechecks/tests outside Tower and runs the external-tarball
consumer plus the visible WebGL browser gate. `source-state.json` records the
source HEAD and whether working-tree changes were included. The optional verified
Git bundle preserves original committed Tower history and authors unchanged.

Important: the bundle is **full Tower history**, not filtered engine history, and
does not commit uncommitted source changes. It must not be uploaded blindly. The
export script never rewrites source refs, creates a remote or publishes npm.

Remaining migration sequence:

1. Review/commit the source slice with the owner's author identity and no assistant
   coauthor. Regenerate the candidate from that exact revision.
2. In a separate disposable clone, filter to the six libraries, lab and necessary
   tooling/docs, preserving author/commit ancestry; review the result and license
   provenance. Do not rewrite Tower's own history.
3. Create a **private** Voxkera repository and push reviewed engine history only.
   GitHub CLI is not installed in this environment; no remote was created here.
4. Run CI in that repository. Decide the license and package namespace/distribution;
   do not remove `private` or execute `npm publish` before explicit approval.
5. Switch Tower to exact extracted artifacts/versions and rerun build/typecheck,
   RTS worker/gameplay/browser and asset regressions without workspace source
   resolution. Keep ARPG work after this acceptance gate.
