const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

const chrome = process.env.TOWER_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] || 'http://127.0.0.1:5173/?demo=rts&map=rts-2p-crossroads';
const port = 9300 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'tower-rts-smoke-'));

const child = spawn(chrome, [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`,
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--hide-scrollbars',
  '--window-size=1600,900',
  url
], { stdio: 'ignore', windowsHide: true });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(fn, timeoutMs = 15_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try { return await fn(); } catch (error) { lastError = error; await delay(100); }
  }
  throw lastError ?? new Error('Timed out');
}

async function connect() {
  const targets = await retry(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) throw new Error(`CDP target list returned ${response.status}`);
    const list = await response.json();
    const target = list.find((entry) => entry.type === 'page');
    if (!target) throw new Error('No page target');
    return target;
  });

  const socket = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params?.exceptionDetails ?? {};
      runtimeErrors.push({
        text: details.text ?? 'Unknown runtime error',
        description: details.exception?.description ?? null,
        value: details.exception?.value ?? null,
        url: details.url ?? null,
        line: details.lineNumber ?? null,
        column: details.columnNumber ?? null
      });
    }
    if (!message.id) return;
    const promise = pending.get(message.id);
    if (!promise) return;
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(message.error.message));
    else promise.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send, runtimeErrors };
}

async function main() {
  const { socket, send, runtimeErrors } = await connect();
  await send('Runtime.enable');
  await send('Page.enable');

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const click = async (x, y, button = 'left') => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'right' ? 2 : 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
  };
  const quest = () => evaluate(`[...document.querySelectorAll('.quest-panel li')].map((node) => node.classList.contains('done'))`);

  await retry(async () => {
    const ready = await evaluate(`document.readyState === 'complete' && document.querySelector('.rts-canvas')?.clientWidth > 1000 && document.querySelectorAll('.quest-panel li').length === 4`);
    if (!ready) throw new Error('RTS view is not ready');
    return true;
  }, 20_000);
  // DOM readiness is earlier than Babylon/WebGL material compilation in the
  // software-rendered CI browser. Wait for the first complete gameplay frame.
  await delay(12_000);
  const workerPoint = await evaluate(`(() => {
    const component = document.querySelector('.rts-layout')?.__vueParentComponent;
    const rawScene = component?.exposed?.scene;
    const scene = rawScene?.value ?? rawScene;
    const mesh = scene?.meshes?.find((item) => item.name.startsWith('unit-pick-unit-'));
    if (!mesh || !scene.activeCamera) return null;
    mesh.computeWorldMatrix(true);
    const Vector = mesh.position.constructor;
    const Matrix = mesh.getWorldMatrix().constructor;
    const engine = scene.getEngine();
    const viewport = scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const projected = Vector.Project(mesh.getAbsolutePosition(), Matrix.Identity(), scene.getTransformMatrix(), viewport);
    const rect = document.querySelector('.rts-canvas').getBoundingClientRect();
    return {
      x: rect.left + projected.x * rect.width / engine.getRenderWidth(),
      y: rect.top + projected.y * rect.height / engine.getRenderHeight()
    };
  })()`);
  if (!workerPoint) throw new Error('Could not project a worker hit-box to the screen');
  await click(workerPoint.x, workerPoint.y);
  await delay(100);
  const selected = await evaluate(`Boolean(document.querySelector('.selection-summary'))`);
  if (!selected) throw new Error('Could not select a worker through the canvas');
  const selectionText = await evaluate(`document.querySelector('.selection-summary')?.textContent ?? ''`);
  if (!selectionText.includes('Рабочий')) throw new Error(`Selection dossier does not identify the unit; ${selectionText}`);
  let steps = await quest();
  if (!steps[0]) throw new Error('Mining quest did not register worker selection');
  console.log('  ✓ worker selected with a single click on the rendered hit-box');

  let stoneOrdered = false;
  const stoneProjection = await evaluate(`(() => {
    const component = document.querySelector('.rts-layout')?.__vueParentComponent;
    const rawScene = component?.exposed?.scene;
    const scene = rawScene?.value ?? rawScene;
    const mesh = scene?.meshes?.find((item) => item.name === 'rn-inst-rn-2p-s0-pick');
    if (!mesh || !scene.activeCamera) return { point: null, diagnostic: { hasScene: Boolean(scene), hasMesh: Boolean(mesh) } };
    mesh.computeWorldMatrix(true);
    const Vector = mesh.position.constructor;
    const Matrix = mesh.getWorldMatrix().constructor;
    const engine = scene.getEngine();
    const viewport = scene.activeCamera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const projected = Vector.Project(mesh.getAbsolutePosition(), Matrix.Identity(), scene.getTransformMatrix(), viewport);
    const rect = document.querySelector('.rts-canvas').getBoundingClientRect();
    const guessX = projected.x * rect.width / engine.getRenderWidth();
    const guessY = projected.y * rect.height / engine.getRenderHeight();
    return {
      point: { x: rect.left + guessX, y: rect.top + guessY },
      diagnostic: {
        guessX,
        guessY,
        engineWidth: engine.getRenderWidth(),
        engineHeight: engine.getRenderHeight(),
        meshName: mesh.name,
        isPickable: mesh.isPickable,
        isVisible: mesh.isVisible,
        visibility: mesh.visibility,
        enabled: mesh.isEnabled()
      }
    };
  })()`);
  const stonePoint = stoneProjection?.point;
  if (!stonePoint) throw new Error(`Could not project the local stone node to the screen; ${JSON.stringify(stoneProjection?.diagnostic)}`);
  console.log(`  projected stone node at ${stonePoint.x.toFixed(1)}, ${stonePoint.y.toFixed(1)}`);
  const stoneCandidates = [[stonePoint.x, stonePoint.y]];
  for (const [x, y] of stoneCandidates) {
    await click(x, y, 'right');
    await delay(20);
    steps = await quest();
    if (steps[1]) { stoneOrdered = true; break; }
  }
  if (!stoneOrdered) {
    const unitOrders = await evaluate(`(() => {
      const component = document.querySelector('.rts-layout')?.__vueParentComponent;
      const rawSim = component?.exposed?.sim;
      const sim = rawSim?.value ?? rawSim;
      return sim?.state?.defenderUnits?.map((unit) => ({ id: unit.id, gatherNodeId: unit.gatherNodeId, state: unit.workerState })) ?? [];
    })()`);
    const pickState = await evaluate(`(() => {
      const component = document.querySelector('.rts-layout')?.__vueParentComponent;
      const rawScene = component?.exposed?.scene;
      const scene = rawScene?.value ?? rawScene;
      const pick = scene?.pick(scene.pointerX, scene.pointerY, (mesh) => mesh.name.startsWith('rn-inst-'));
      return { pointerX: scene?.pointerX, pointerY: scene?.pointerY, mesh: pick?.pickedMesh?.name ?? null };
    })()`);
    throw new Error(`Could not issue a gather order to the stone node; pointer ${JSON.stringify(pickState)}; worker state ${JSON.stringify(unitOrders)}`);
  }
  const gatherFeedback = await evaluate(`({
    alert: document.querySelector('.game-alert')?.textContent ?? '',
    markers: (() => {
      const component = document.querySelector('.rts-layout')?.__vueParentComponent;
      const rawScene = component?.exposed?.scene;
      const scene = rawScene?.value ?? rawScene;
      return scene?.meshes?.filter((mesh) => mesh.metadata?.commandMarker === 'gather').length ?? 0;
    })()
  })`);
  if (!gatherFeedback.alert.includes('Приказ подтверждён') || gatherFeedback.markers < 1) {
    throw new Error(`Gather order has no visible confirmation; ${JSON.stringify(gatherFeedback)}`);
  }
  console.log('  ✓ right-click assigned the selected worker to stone');

  const mineCenter = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.command')].find((node) => node.textContent.includes('Шахта'));
    if (!button || button.disabled) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!mineCenter) throw new Error('Mine command is missing or disabled');
  await click(mineCenter.x, mineCenter.y);
  const buildMode = await evaluate(`Boolean(document.querySelector('.rts-mode-banner'))`);
  if (!buildMode) throw new Error('Mine command did not enter placement mode');

  let mineBuilt = false;
  const buildCandidates = [[600, 500]];
  for (const [x, y] of buildCandidates) {
    await click(x, y);
    await delay(25);
    steps = await quest();
    if (steps[2]) { mineBuilt = true; break; }
  }
  if (!mineBuilt) {
    const buildState = await evaluate(`(() => {
      const component = document.querySelector('.rts-layout')?.__vueParentComponent;
      const rawSim = component?.exposed?.sim;
      const sim = rawSim?.value ?? rawSim;
      const rawScene = component?.exposed?.scene;
      const scene = rawScene?.value ?? rawScene;
      return {
        buildings: sim?.state?.productionBuildings ?? [],
        resources: sim?.state?.resources ?? null,
        alert: document.querySelector('.game-alert')?.textContent ?? null,
        placementMode: Boolean(document.querySelector('.rts-mode-banner')),
        pointer: scene ? { x: scene.pointerX, y: scene.pointerY } : null,
        hasTerrainHeightmap: Boolean(scene?.getMeshByName('ground')?.metadata?.terrainHeightmap)
      };
    })()`);
    buildState.runtimeErrors = runtimeErrors;
    throw new Error(`Mine was not built on any valid visible terrain cell; ${JSON.stringify(buildState)}`);
  }
  console.log('  ✓ mine command placed a production building on the terrain');

  const sawmillCenter = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.command')].find((node) => node.textContent.includes('Лесопилка'));
    if (!button || button.disabled) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!sawmillCenter) throw new Error('Sawmill command is missing or disabled');
  await click(sawmillCenter.x, sawmillCenter.y);
  let sawmillBuilt = false;
  for (let y = 360; y <= 680 && !sawmillBuilt; y += 64) {
    for (let x = 300; x <= 980 && !sawmillBuilt; x += 68) {
      await click(x, y);
      await delay(20);
      sawmillBuilt = await evaluate(`(() => {
        const component = document.querySelector('.rts-layout')?.__vueParentComponent;
        const rawSim = component?.exposed?.sim;
        const sim = rawSim?.value ?? rawSim;
        return Boolean(sim?.state?.productionBuildings?.some((building) => building.typeId === 'sawmill'));
      })()`);
    }
  }
  if (!sawmillBuilt) throw new Error('Sawmill could not be placed on visible valid terrain');
  console.log('  ✓ sawmill command placed a production building on the terrain');

  if (process.env.TOWER_RTS_SMOKE_SCREENSHOT) {
    await delay(300);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(process.env.TOWER_RTS_SMOKE_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    console.log(`  ✓ screenshot saved to ${process.env.TOWER_RTS_SMOKE_SCREENSHOT}`);
  }

  if (process.env.TOWER_RTS_ENEMY_SCREENSHOT) {
    const enemyFocus = await evaluate(`(() => {
      const minimap = document.querySelector('.minimap');
      if (!minimap) return null;
      const rect = minimap.getBoundingClientRect();
      return { x: rect.left + rect.width * 0.875, y: rect.top + rect.height * 0.875 };
    })()`);
    if (!enemyFocus) throw new Error('Minimap is unavailable for the enemy-fortress capture');
    await click(enemyFocus.x, enemyFocus.y);
    await delay(500);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(process.env.TOWER_RTS_ENEMY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
    console.log(`  ✓ enemy-fortress screenshot saved to ${process.env.TOWER_RTS_ENEMY_SCREENSHOT}`);
  }

  const cullingBefore = await evaluate(`(() => {
    const component = document.querySelector('.rts-layout')?.__vueParentComponent;
    const rawScene = component?.exposed?.scene;
    const scene = rawScene?.value ?? rawScene;
    const meshes = scene?.meshes?.filter((mesh) => mesh.metadata?.rigKind === 'enemy') ?? [];
    const active = new Set(scene?.getActiveMeshes()?.data ?? []);
    return {
      total: meshes.length,
      protected: meshes.filter((mesh) => mesh.alwaysSelectAsActiveMesh && mesh.doNotSyncBoundingInfo === false).length,
      active: meshes.filter((mesh) => active.has(mesh)).length,
      orthoWidth: scene?.activeCamera ? scene.activeCamera.orthoRight - scene.activeCamera.orthoLeft : null
    };
  })()`);
  if (cullingBefore.total === 0 || cullingBefore.protected !== cullingBefore.total) {
    throw new Error(`Enemy rig bounds are not zoom-safe; ${JSON.stringify(cullingBefore)}`);
  }
  const enemyTownHall = await evaluate(`(() => {
    const component = document.querySelector('.rts-layout')?.__vueParentComponent;
    const rawScene = component?.exposed?.scene;
    const scene = rawScene?.value ?? rawScene;
    const meshes = scene?.meshes?.filter((mesh) => mesh.metadata?.rigRole === 'town-hall') ?? [];
    return { count: meshes.length, vertices: meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0) };
  })()`);
  if (enemyTownHall.count < 1 || enemyTownHall.vertices < 100) {
    throw new Error(`AI objective is not rendered as a fortress; ${JSON.stringify(enemyTownHall)}`);
  }
  console.log(`  ✓ AI objective uses a dedicated fortress mesh (${enemyTownHall.vertices} vertices)`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 800, y: 450, deltaX: 0, deltaY: -720 });
  await delay(500);
  const cullingAfter = await evaluate(`(() => {
    const component = document.querySelector('.rts-layout')?.__vueParentComponent;
    const rawScene = component?.exposed?.scene;
    const scene = rawScene?.value ?? rawScene;
    const meshes = scene?.meshes?.filter((mesh) => mesh.metadata?.rigKind === 'enemy') ?? [];
    const active = new Set(scene?.getActiveMeshes()?.data ?? []);
    return {
      total: meshes.length,
      active: meshes.filter((mesh) => active.has(mesh)).length,
      orthoWidth: scene?.activeCamera ? scene.activeCamera.orthoRight - scene.activeCamera.orthoLeft : null
    };
  })()`);
  if (!(cullingAfter.orthoWidth < cullingBefore.orthoWidth) || cullingAfter.active !== cullingAfter.total) {
    throw new Error(`Enemy rigs disappeared after zoom-in; before=${JSON.stringify(cullingBefore)} after=${JSON.stringify(cullingAfter)}`);
  }
  console.log(`  ✓ ${cullingAfter.total} enemy rig meshes stay active after zoom-in`);

  const worldTasks = await evaluate(`(() => {
    const component=document.querySelector('.rts-layout')?.__vueParentComponent;
    const raw=component?.exposed?.sim, sim=raw?.value??raw;
    return {count:sim?.state.worldSites?.length??0,buttons:document.querySelectorAll('.world-objectives button').length};
  })()`);
  if(worldTasks.count!==2 || worldTasks.buttons!==2) throw new Error('World activity objectives are missing');
  await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:700,y:430,deltaX:0,deltaY:320});
  const siteButton=await evaluate(`(() => {
    const button=document.querySelector('.world-objectives button');button?.scrollIntoView({block:'center'});
    const rect=button?.getBoundingClientRect();return rect?{x:rect.left+rect.width/2,y:rect.top+rect.height/2}:null;
  })()`);
  await click(siteButton.x,siteButton.y);
  await delay(500);
  if(process.env.TOWER_RTS_WORLD_SCREENSHOT) {
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    writeFileSync(process.env.TOWER_RTS_WORLD_SCREENSHOT,Buffer.from(shot.data,'base64'));
  }
  const ritesTab=await evaluate(`(() => {
    const button=[...document.querySelectorAll('.book-tabs button')].find(node=>node.textContent.includes('Ритуалы'));
    button?.scrollIntoView({block:'center'});const rect=button?.getBoundingClientRect();
    return rect?{x:rect.left+rect.width/2,y:rect.top+rect.height/2}:null;
  })()`);
  if(!ritesTab) throw new Error('Rites tab unavailable');
  await click(ritesTab.x,ritesTab.y);
  for(const spellName of ['Метеор','Стужа']) {
    const buttonPoint=await evaluate(`(() => {
      const button=[...document.querySelectorAll('.command')].find(node=>node.textContent.includes('${spellName}'));
      button?.scrollIntoView({block:'center'});const rect=button?.getBoundingClientRect();
      return rect&&!button.disabled?{x:rect.left+rect.width/2,y:rect.top+rect.height/2}:null;
    })()`);
    if(!buttonPoint) throw new Error('Spell command unavailable: '+spellName);
    await click(buttonPoint.x,buttonPoint.y);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:550,y:350});
    await delay(50);
    const circle=await evaluate(`(() => {
      const component=document.querySelector('.rts-layout')?.__vueParentComponent;
      const raw=component?.exposed?.scene,scene=raw?.value??raw;
      const ring=scene?.getMeshByName('spell-radius-preview');
      return ring?{enabled:ring.isEnabled(),scale:ring.scaling.x,rotation:ring.rotation.x}:null;
    })()`);
    if(!circle?.enabled || circle.scale<=1 || circle.rotation!==0) throw new Error('Spell still uses a point/square preview: '+JSON.stringify(circle));
    await click(550,350);
    const prefix=spellName==='Метеор'?'meteor-projectile-':'frost-shard-';
    await retry(async()=>{
      const present=await evaluate(`(() => {
        const component=document.querySelector('.rts-layout')?.__vueParentComponent;
        const raw=component?.exposed?.scene,scene=raw?.value??raw;
        return Boolean(scene?.meshes.some(mesh=>mesh.name.startsWith('${prefix}') && mesh.isEnabled()));
      })()`);
      if(!present) throw new Error('Spell meshes missing: '+spellName);
      return true;
    },4000);
    if(spellName==='Метеор' && process.env.TOWER_RTS_SPELL_SCREENSHOT) {
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      writeFileSync(process.env.TOWER_RTS_SPELL_SCREENSHOT,Buffer.from(shot.data,'base64'));
    }
    if(spellName==='Стужа' && process.env.TOWER_RTS_FROST_SCREENSHOT) {
      const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      writeFileSync(process.env.TOWER_RTS_FROST_SCREENSHOT,Buffer.from(shot.data,'base64'));
    }
  }
  const shaderState=await evaluate(`(() => {
    const component=document.querySelector('.rts-layout')?.__vueParentComponent;
    const raw=component?.exposed?.scene,scene=raw?.value??raw;
    const meshes=scene?.meshes.filter(mesh=>mesh.name.startsWith('spell-area-') || mesh.name.startsWith('frost-shard-'))??[];
    return meshes.map(mesh=>({name:mesh.name,ready:mesh.material?.isReady(mesh)}));
  })()`);
  if(!shaderState.length || shaderState.some(mesh=>!mesh.ready)) throw new Error('Spell shader compilation failed: '+JSON.stringify(shaderState));
  console.log('  ✓ World objectives, circular spell previews, falling meteor and frost shaders work through real canvas input');

  await send('Emulation.setDeviceMetricsOverride', { width: 1008, height: 650, deviceScaleFactor: 1, mobile: false });
  await delay(400);
  const responsive = await evaluate(`(() => {
    const doc = document.documentElement;
    const stage = document.querySelector('.rts-stage')?.getBoundingClientRect();
    const groups = document.querySelector('.ctrl-groups')?.getBoundingClientRect();
    const selection = document.querySelector('.selection-summary')?.getBoundingClientRect();
    const economy = document.querySelector('.economy-bar')?.getBoundingClientRect();
    return {
      viewport: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      stage: stage ? { left: stage.left, right: stage.right, width: stage.width } : null,
      groups: groups ? { left: groups.left, right: groups.right, top: groups.top } : null,
      selection: selection ? { left: selection.left, right: selection.right, width: selection.width } : null,
      economyHeight: economy?.height ?? null
    };
  })()`);
  const groupsInside = responsive.stage && responsive.groups
    && responsive.groups.left >= responsive.stage.left - 1
    && responsive.groups.right <= responsive.stage.right + 1;
  const selectionInside = responsive.stage && responsive.selection
    && responsive.selection.left >= responsive.stage.left - 1
    && responsive.selection.right <= responsive.stage.right + 1;
  if (responsive.scrollWidth > responsive.viewport + 1 || !groupsInside || !selectionInside || responsive.economyHeight > 90) {
    throw new Error(`RTS HUD overflows at 1008px; ${JSON.stringify(responsive)}`);
  }
  console.log('  ✓ HUD remains inside the 1008px viewport without stale overlays');

  const backButton = await evaluate(`(() => {
    const button = document.querySelector('.hud-corner.top-right .ctrl-btn.ghost');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!backButton) throw new Error('RTS back button is unavailable');
  await click(backButton.x, backButton.y);
  await retry(async () => {
    const ready = await evaluate(`document.querySelectorAll('.rts-lobby .map-card').length === 3`);
    if (!ready) throw new Error('RTS lobby did not open');
    return true;
  });
  const lobbyLayout = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.rts-lobby .map-card')].map((card) => card.getBoundingClientRect());
    const doc = document.documentElement;
    const active = document.querySelector('.rts-lobby .map-card.active');
    const primary = document.querySelector('.rts-lobby .btn.primary');
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      cardsOutside: cards.filter((rect) => rect.left < -1 || rect.right > doc.clientWidth + 1).length,
      activeBorder: active ? getComputedStyle(active).borderLeftColor : '',
      primaryBackground: primary ? getComputedStyle(primary).backgroundColor : ''
    };
  })()`);
  if (lobbyLayout.overflow > 1 || lobbyLayout.cardsOutside > 0 || lobbyLayout.primaryBackground.includes('37, 99, 235')) {
    throw new Error(`RTS lobby retained the clipped blue layout; ${JSON.stringify(lobbyLayout)}`);
  }
  if (process.env.TOWER_RTS_LOBBY_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(process.env.TOWER_RTS_LOBBY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }

  const coopNav = await evaluate(`(() => {
    const button = [...document.querySelectorAll('.nav-button')].find((node) => node.textContent.includes('Co-op'));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!coopNav) throw new Error('Co-op navigation button is unavailable');
  await click(coopNav.x, coopNav.y);
  await retry(async () => {
    const ready = await evaluate(`Boolean(document.querySelector('.coop-lobby .card'))`);
    if (!ready) throw new Error('Co-op lobby did not open');
    return true;
  });
  const coopLayout = await evaluate(`(() => {
    const doc = document.documentElement;
    const card = document.querySelector('.coop-lobby .card')?.getBoundingClientRect();
    const primary = document.querySelector('.coop-lobby .btn.primary');
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      card: card ? { left: card.left, right: card.right } : null,
      primaryBackground: primary ? getComputedStyle(primary).backgroundColor : ''
    };
  })()`);
  if (coopLayout.overflow > 1 || !coopLayout.card || coopLayout.card.left < -1 || coopLayout.card.right > 1009 || coopLayout.primaryBackground.includes('37, 99, 235')) {
    throw new Error(`Co-op lobby retained the clipped blue layout; ${JSON.stringify(coopLayout)}`);
  }
  if (process.env.TOWER_COOP_LOBBY_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(process.env.TOWER_COOP_LOBBY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  console.log('  ✓ RTS and co-op lobbies use the responsive dark-fantasy layout');

  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });
  await delay(150);
  const logout = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.app-header-right .btn.ghost')];
    const button = buttons.find((node) => node.textContent.includes('Выйти'));
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!logout) throw new Error('Logout button is unavailable for the welcome-screen smoke');
  await click(logout.x, logout.y);
  await retry(async () => {
    const ready = await evaluate(`Boolean(document.querySelector('.auth-shell .auth-prologue'))`);
    if (!ready) throw new Error('Welcome screen did not open after logout');
    return true;
  });
  await delay(500);
  const welcome = await evaluate(`(() => {
    const doc = document.documentElement;
    const shell = document.querySelector('.auth-shell');
    const card = document.querySelector('.auth-card');
    const activeTab = document.querySelector('.auth-tabs .active');
    const guest = document.querySelector('.auth-btn.guest');
    const shellStyle = shell ? getComputedStyle(shell) : null;
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      title: document.querySelector('.auth-prologue h1')?.textContent ?? '',
      shellRadius: shellStyle?.borderRadius ?? '',
      cardBackground: card ? getComputedStyle(card).backgroundColor : '',
      tabBackground: activeTab ? getComputedStyle(activeTab).backgroundColor : '',
      guestBackground: guest ? getComputedStyle(guest).backgroundColor : ''
    };
  })()`);
  if (welcome.overflow > 1 || !welcome.title.includes('Тёмная') || welcome.shellRadius !== '0px'
      || welcome.cardBackground.includes('255, 255, 255') || welcome.tabBackground.includes('37, 99, 235')) {
    throw new Error(`Welcome screen retained the legacy white/blue layout; ${JSON.stringify(welcome)}`);
  }
  if (process.env.TOWER_LOGIN_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(process.env.TOWER_LOGIN_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 760, deviceScaleFactor: 1, mobile: false });
  await delay(250);
  const mobileWelcome = await evaluate(`(() => {
    const doc = document.documentElement;
    const shell = document.querySelector('.auth-shell')?.getBoundingClientRect();
    return { overflow: doc.scrollWidth - doc.clientWidth, shell: shell ? { left: shell.left, right: shell.right } : null };
  })()`);
  if (mobileWelcome.overflow > 1 || !mobileWelcome.shell || mobileWelcome.shell.left < -1 || mobileWelcome.shell.right > 391) {
    throw new Error(`Welcome screen overflows at 390px; ${JSON.stringify(mobileWelcome)}`);
  }
  console.log('  ✓ welcome screen uses the responsive fortress-gate layout');
  console.log('✅ RTS browser interaction smoke passed');
  socket.close();
}

main()
  .catch((error) => {
    console.error(`❌ RTS browser interaction smoke failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    child.kill();
    await delay(250);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); } catch { /* Chrome can briefly retain the profile lock. */ }
  });
