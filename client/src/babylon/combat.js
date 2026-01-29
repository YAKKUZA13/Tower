import { MeshBuilder, StandardMaterial, Color3, Vector3 } from 'babylonjs';

export function findTarget(mobs, origin, rangeWorld) {
  let best = null;
  let bestDist = Infinity;
  for (const m of mobs) {
    const d = Vector3.Distance(origin, m.mesh.position);
    if (d <= rangeWorld && d < bestDist && m.hp > 0) {
      best = m;
      bestDist = d;
    }
  }
  return best;
}

export function spawnProjectile(scene, fromPos, targetMob, speed = 6, onHit) {
  const proj = MeshBuilder.CreateSphere(`proj-${crypto.randomUUID()}`, { diameter: 0.2 }, scene);
  const mat = new StandardMaterial(`projMat-${proj.name}`, scene);
  mat.diffuseColor = new Color3(1, 0.9, 0.2);
  proj.material = mat;
  proj.position = fromPos.clone();
  proj.isPickable = false;

  let alive = true;

  function update(deltaSeconds) {
    if (!alive) return;
    if (!targetMob || targetMob.hp <= 0) { dispose(); return; }
    const to = targetMob.mesh.position;
    const dir = to.subtract(proj.position);
    const dist = dir.length();
    if (dist < 0.3) {
      if (onHit) onHit(targetMob);
      dispose();
      return;
    }
    dir.normalize();
    proj.position = proj.position.add(dir.scale(speed * deltaSeconds));
  }

  function dispose() {
    if (!alive) return;
    alive = false;
    proj.dispose();
  }

  return { mesh: proj, update, dispose };
}

