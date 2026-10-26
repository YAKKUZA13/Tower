import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents.js';
import '@babylonjs/core/Culling/ray.js';
import { loadCharacterRecipe } from '@voxkera/engine-recipe';
import {compileCharacterAsset} from '@voxkera/voxel-core';
import { collectRigMeshes, createCharacterAssetRig, createVoxelStage } from '@voxkera/voxel-babylon';
import type { LabScene } from './greedy-lab';

/** Uses only public engine APIs; no RTS types, generators or animation drivers. */
export function createCharacterLab(scene: Scene, camera: ArcRotateCamera,
  onStats: (tri: number, vox: number, label: string) => void, content: HTMLElement): LabScene {
  content.innerHTML = `
    <h2>Character recipe v1</h2>
    <p>Runtime geometry · strict JSON · no model files</p>
    <label>Fixture</label><select id="character-fixture"><option value="warden">Humanoid warden</option><option value="lantern-beetle">Lantern beetle</option><option value="rune-sword">Equipment: rune sword</option></select>
    <label>Resolution</label><select id="character-resolution"><option value="540">540p nearest upscale</option><option value="0">Native (no postprocess)</option></select>
    <label>Recipe</label><textarea id="character-json" rows="8" style="width:100%"></textarea>
    <button id="character-build">Validate and build</button>
    <pre id="character-errors" style="white-space:pre-wrap;color:#f99"></pre>
    <label>Clip</label><select id="character-clip"></select>
    <label><input id="character-play" type="checkbox" checked> Play</label>
    <label>Time (seconds)</label><input id="character-time" type="range" min="0" max="1" step="0.01" value="0">
    <label>Review view</label><select id="character-view">
      <option value="three-quarter">Three-quarter</option><option value="front">Front (+Z)</option>
      <option value="side">Side (+X)</option><option value="back">Back (-Z)</option>
    </select><label>Part (or click model)</label><select id="character-part"></select>
    <label>Socket</label><select id="character-socket"></select>
    <button id="character-equip">Attach rune sword to selected socket</button>
    <label>Explode inspection</label><input id="character-explode" type="range" min="0" max="1.5" step="0.05" value="0">
    <pre id="character-inspect" style="white-space:pre-wrap"></pre><p id="character-events"></p>
    <p id="character-contract"></p>`;
  const textarea = content.querySelector<HTMLTextAreaElement>('#character-json')!;
  const errors = content.querySelector<HTMLElement>('#character-errors')!;
  const clips = content.querySelector<HTMLSelectElement>('#character-clip')!;
  const play = content.querySelector<HTMLInputElement>('#character-play')!;
  const time = content.querySelector<HTMLInputElement>('#character-time')!;
  const review = content.querySelector<HTMLSelectElement>('#character-view')!;
  const stage = createVoxelStage(scene, camera, { viewHeight: 1.8, pixelHeight: 540, fillIntensity: .9 });
  // Face-forward neutral review lighting, not the darker environment default.
  stage.key.direction.set(-.6, -1, -.8); stage.key.position.set(6, 10, 8);
  stage.fill.diffuse.set(.9, .95, 1); stage.fill.groundColor.set(.25, .28, .3);
  content.querySelector<HTMLSelectElement>('#character-resolution')!.onchange = event => stage.setPixelHeight(Number((event.target as HTMLSelectElement).value));
  let rig: ReturnType<typeof createCharacterAssetRig> | undefined;
  let equipment: ReturnType<typeof createCharacterAssetRig> | undefined;
  let asset: Extract<ReturnType<typeof compileCharacterAsset>, { ok: true }>['asset'] | undefined;
  let explodeCentres = new Map<string, number[]>();
  const partSelect = content.querySelector<HTMLSelectElement>('#character-part')!;
  const socketSelect = content.querySelector<HTMLSelectElement>('#character-socket')!;
  const explode = content.querySelector<HTMLInputElement>('#character-explode')!;
  const eventsLabel = content.querySelector<HTMLElement>('#character-events')!;
  let requestVersion = 0;
  let durations = new Map<string, { duration: number; loop: boolean }>();
  let disposed = false, elapsed = 0;
  let reviewDiameter = 1.4;
  function fitView() {
    const engine = scene.getEngine();
    const aspect = engine.getRenderWidth(true) / Math.max(1, engine.getRenderHeight(true));
    stage.setViewHeight(Math.max(1.8, reviewDiameter * 1.2 / Math.min(1, aspect)));
  }
  const fitObserver = scene.getEngine().onResizeObservable.add(fitView);
  const abort = new AbortController();
  const previous = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone() };
  camera.target = Vector3.Zero(); camera.radius = 5; camera.beta = 1.1;
  const setView = () => {
    camera.alpha = ({ front: Math.PI / 2, side: 0, back: -Math.PI / 2, 'three-quarter': Math.PI / 4 })[review.value]!;
    camera.beta = review.value === 'three-quarter' ? 1.1 : Math.PI / 2;
  };
  setView(); review.onchange = setView;
  function inspect() {
    const part = asset?.recipe.parts.find(part => part.id === partSelect.value);
    const socket = asset?.recipe.sockets.find(socket => socket.id === socketSelect.value);
    content.querySelector('#character-inspect')!.textContent = JSON.stringify({ part, socket }, null, 2);
  }
  function rebuild() {
    errors.textContent = '';
    const parsed = loadCharacterRecipe(textarea.value);
    const result = parsed.ok ? compileCharacterAsset(parsed.recipe) : parsed;
    if (!result.ok) { errors.textContent = result.errors.map(issue => `${issue.path}: ${issue.message}`).join('\n'); return; }
    // Preserve the previous good preview on invalid input.
    equipment?.dispose(); equipment = undefined; rig?.dispose();
    asset = result.asset;
    explodeCentres = new Map(asset.recipe.parts.map(part => {
      const source = findPart(asset!.character.root, part.id);
      return [part.id, source.voxels.length ? [0, 1, 2].map(axis => source.voxels.reduce((sum, v) => sum + [v.x, v.y, v.z][axis]!, 0) / source.voxels.length) : part.pivot];
    }));
    rig = createCharacterAssetRig(scene, result.asset);
    rig.root.computeWorldMatrix(true);
    const bounds = rig.root.getHierarchyBoundingVectors(true);
    reviewDiameter = bounds.max.subtract(bounds.min).length(); fitView();
    const meshes = collectRigMeshes(rig.root);
    for (const mesh of meshes) { stage.addMesh(mesh); mesh.isPickable = true; }
    // Every named socket is inspectable; no special Tower weapon/socket names.
    for (const [id, socket] of rig.sockets) {
      const marker = MeshBuilder.CreateBox(`character-socket:${id}`, { size: .7 }, scene);
      marker.parent = socket;
      const markerMat = new StandardMaterial(`character-socket-material:${id}`, scene);
      markerMat.emissiveColor = new Color3(0.15, 0.8, 0.6); marker.material = markerMat;
      marker.onDisposeObservable.addOnce(() => markerMat.dispose());
    }
    clips.replaceChildren(new Option('Rest pose', ''), ...result.asset.recipe.clips.map(clip => new Option(clip.id, clip.id)));
    clips.value = result.asset.recipe.clips[0]?.id ?? '';
    if (clips.value) rig.play(clips.value);
    partSelect.replaceChildren(...asset.recipe.parts.map(part => new Option(part.id, part.id)));
    socketSelect.replaceChildren(...asset.recipe.sockets.map(socket => new Option(socket.id, socket.id)));
    explode.value = '0'; inspect();
    durations = new Map(result.asset.recipe.clips.map(clip => [clip.id, { duration: clip.duration, loop: clip.loop }]));
    elapsed = 0; time.value = '0';
    time.max = String(result.asset.recipe.clips.find(clip => clip.id === clips.value)?.duration ?? 1);
    content.querySelector('#character-contract')!.textContent = 'Review targets (not auto-approved): ' + result.asset.recipe.quality.criticalFeatures.join('; ');
    onStats(meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0), result.asset.metrics.voxels, `character v1 / ${meshes.length} parts`);
    document.body.dataset.characterReady = result.asset.recipe.id;
  }
  content.querySelector<HTMLButtonElement>('#character-build')!.onclick = rebuild;
  clips.onchange = () => {
    elapsed = 0; time.value = '0'; time.max = String(durations.get(clips.value)?.duration ?? 1);
    if (clips.value) rig?.play(clips.value, { fadeSeconds: .15 }); else rig?.stop();
  };
  partSelect.onchange = inspect; socketSelect.onchange = inspect;
  explode.oninput = () => { play.checked = false; };
  const pointerObserver = scene.onPointerObservable.add(event => {
    if (event.type !== PointerEventTypes.POINTERPICK) return;
    const mesh = event.pickInfo?.pickedMesh;
    const part = mesh?.parent?.name;
    if (asset?.recipe.parts.some(candidate => candidate.id === part)) { partSelect.value = part!; inspect(); }
  });
  time.oninput = () => { play.checked = false; elapsed = Number(time.value); };
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (!rig) return;
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, .1);
    if (play.checked && Number(explode.value) === 0 && clips.value) {
      elapsed += dt; const events = rig.advance(dt);
      if (events.length) eventsLabel.textContent = events.map(event => `${event.type}: ${event.id ?? event.clip}`).join('; ');
    } else if (clips.value) rig.sampleClip(clips.value, elapsed);
    // Explode offsets only visual part layout; pivots/sockets are not a physics simulation.
    const amount = Number(explode.value);
    for (const definition of asset?.recipe.parts ?? []) {
      const node = rig.parts.get(definition.id)!;
      const centre = explodeCentres.get(definition.id)!;
      for (const mesh of node.getChildMeshes(true)) mesh.position.set(
        -definition.pivot[0] + (centre[0]! - asset!.character.root.pivot[0]) * amount,
        -definition.pivot[1] + (centre[1]! - asset!.character.root.pivot[1]) * amount,
        -definition.pivot[2] + (centre[2]! - asset!.character.root.pivot[2]) * amount,
      );
    }
    const clip = durations.get(clips.value);
    if (play.checked && clip) time.value = String(clip.loop ? elapsed % clip.duration : Math.min(elapsed, clip.duration));
  });
  function loadFixture(id: string) {
  const version = ++requestVersion;
  void fetch(`/characters/${id}.json`, { signal: abort.signal }).then(response => {
    if (!response.ok) throw new Error(`Character fixture HTTP ${response.status}`);
    return response.text();
  }).then(json => { if (!disposed && version === requestVersion) { textarea.value = json; rebuild(); } })
    .catch(error => { if (!disposed) errors.textContent = String(error); });
  }
  content.querySelector<HTMLSelectElement>('#character-fixture')!.onchange = event => loadFixture((event.target as HTMLSelectElement).value);
  content.querySelector<HTMLButtonElement>('#character-equip')!.onclick = async () => {
    const owner = rig, socket = socketSelect.value;
    if (!owner || !socket) return;
    try {
      const response = await fetch('/characters/rune-sword.json', { signal: abort.signal });
      const parsed = loadCharacterRecipe(await response.text());
      const compiled = parsed.ok ? compileCharacterAsset(parsed.recipe) : parsed;
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
      if (disposed || rig !== owner) return;
      equipment?.dispose(); equipment = createCharacterAssetRig(scene, compiled.asset);
      owner.attach(socket, equipment.root, 10, equipment.sockets.get('grip'));
      for (const mesh of collectRigMeshes(equipment.root)) stage.addMesh(mesh);
      document.body.dataset.equipmentReady = compiled.asset.recipe.id;
    } catch (error) { if (!disposed) errors.textContent = String(error); }
  };
  loadFixture('warden');
  return { dispose() {
    if (disposed) return;
    disposed = true; abort.abort(); scene.onBeforeRenderObservable.remove(observer); scene.onPointerObservable.remove(pointerObserver);
    scene.getEngine().onResizeObservable.remove(fitObserver);
    equipment?.dispose(); rig?.dispose(); stage.dispose(); delete document.body.dataset.characterReady; delete document.body.dataset.equipmentReady;
    camera.alpha = previous.alpha; camera.beta = previous.beta; camera.radius = previous.radius; camera.target = previous.target;
  } };
}

function findPart(part: import('@voxkera/voxel-core').PartNode, id: string): import('@voxkera/voxel-core').PartNode {
  if (part.name === id) return part;
  for (const child of part.children) { const found = findPartOrNull(child, id); if (found) return found; }
  throw new Error(`Missing part ${id}`);
}
function findPartOrNull(part: import('@voxkera/voxel-core').PartNode, id: string): import('@voxkera/voxel-core').PartNode | null {
  if (part.name === id) return part;
  for (const child of part.children) { const found = findPartOrNull(child, id); if (found) return found; }
  return null;
}
