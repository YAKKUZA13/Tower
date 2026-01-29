import { MeshBuilder, StandardMaterial, Color3, Vector3 } from 'babylonjs';
import { gridToWorld } from './createScene.js';

export function createMob(scene, grid, mobSpec, waypoints) {
  const radius = Math.min(grid.cellSize * 0.35, 0.8);
  const height = Math.max(0.8, radius * 2);
  const mesh = MeshBuilder.CreateSphere(`mob-${crypto.randomUUID()}`, { diameter: radius * 2 }, scene);
  const mat = new StandardMaterial(`mobMat-${mesh.name}`, scene);
  mat.diffuseColor = new Color3(0.9, 0.2, 0.2);
  mesh.material = mat;
  mesh.isPickable = false;

  const maxHp = Math.max(1, mobSpec.hp || 10);
  let hp = maxHp;
  const speed = Math.max(0.01, mobSpec.speed || 1); // cells per second equivalent
  let seg = 0;
  let t = 0;

  const start = waypoints[0];
  const next = waypoints[1] || waypoints[0];
  const startPos = gridToWorld(grid, start.col, start.row);
  const nextPos = gridToWorld(grid, next.col, next.row);
  mesh.position = new Vector3(startPos.x, height / 2, startPos.z);

  // hp bar (simple box above)
  const barBg = MeshBuilder.CreateBox(`hpbg-${mesh.name}`, { width: grid.cellSize * 0.8, height: 0.05, depth: 0.05 }, scene);
  barBg.isPickable = false;
  const barBgMat = new StandardMaterial(`hpbgMat-${mesh.name}`, scene);
  barBgMat.diffuseColor = new Color3(0.1, 0.1, 0.1);
  barBg.material = barBgMat;
  barBg.parent = mesh;
  barBg.position = new Vector3(0, height * 0.75, 0);

  const bar = MeshBuilder.CreateBox(`hp-${mesh.name}`, { width: grid.cellSize * 0.8, height: 0.05, depth: 0.05 }, scene);
  bar.isPickable = false;
  const barMat = new StandardMaterial(`hpMat-${mesh.name}`, scene);
  barMat.diffuseColor = new Color3(0.2, 0.8, 0.2);
  bar.material = barMat;
  bar.parent = mesh;
  bar.position = new Vector3(0, height * 0.75, 0);

  function setHp(newHp) {
    hp = Math.max(0, Math.min(maxHp, newHp));
    const ratio = hp / maxHp;
    bar.scaling.x = Math.max(0.001, ratio);
    bar.position.x = -(barBg.scaling.x * barBg.getBoundingInfo().boundingBox.extendSize.x) * (1 - ratio) / 2;
  }

  function reachedEnd() {
    return seg >= waypoints.length - 1 && t >= 1;
  }

  function update(deltaSeconds) {
    if (reachedEnd()) return;
    const from = waypoints[seg];
    const to = waypoints[seg + 1] || waypoints[seg];
    const fromPos = gridToWorld(grid, from.col, from.row);
    const toPos = gridToWorld(grid, to.col, to.row);

    const distCells = Math.abs(to.col - from.col) + Math.abs(to.row - from.row);
    const segDuration = Math.max(0.0001, distCells / speed);
    t += deltaSeconds / segDuration;
    if (t >= 1) {
      seg += 1;
      t = 0;
      if (seg >= waypoints.length - 1) {
        // snap to last
        const p = gridToWorld(grid, to.col, to.row);
        mesh.position = new Vector3(p.x, height / 2, p.z);
        return;
      }
    }
    const curFrom = gridToWorld(grid, (waypoints[seg] || from).col, (waypoints[seg] || from).row);
    const curTo = gridToWorld(grid, (waypoints[seg + 1] || to).col, (waypoints[seg + 1] || to).row);
    const pos = Vector3.Lerp(new Vector3(curFrom.x, height / 2, curFrom.z), new Vector3(curTo.x, height / 2, curTo.z), t);
    mesh.position = pos;
  }

  function dispose() {
    [mesh, bar, barBg].forEach(m => m && m.dispose());
  }

  return {
    mesh,
    get hp() { return hp; },
    get maxHp() { return maxHp; },
    setHp,
    speed,
    update,
    reachedEnd,
    dispose
  };
}

