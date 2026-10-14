/** Render-only locomotion: stable gait between fixed simulation ticks. */
export interface RigMotion {
  x: number; z: number; targetX: number; targetZ: number;
  speed: number; facing: number; phase: number;
}
export function createRigMotion(x: number, z: number): RigMotion {
  return { x, z, targetX: x, targetZ: z, speed: 0, facing: 0, phase: 0 };
}
export function advanceRigMotion(state: RigMotion, x: number, z: number, dt: number, stride = 1): RigMotion {
  if (!(dt > 0)) return state;
  const frame = Math.min(dt, .1);
  const dx = x - state.targetX, dz = z - state.targetZ;
  const traveled = Math.hypot(dx, dz);
  const blend = 1 - Math.exp(-14 * frame);
  state.speed += (Math.min(12 * stride, traveled / frame) - state.speed) * blend;
  if (traveled > 1e-5) {
    const angle = Math.atan2(dx, dz);
    const delta = Math.atan2(Math.sin(angle - state.facing), Math.cos(angle - state.facing));
    state.facing += delta * (1 - Math.exp(-18 * frame));
  }
  // Short positional interpolation; teleporting does not sweep across the whole map.
  if (Math.hypot(x - state.x, z - state.z) > stride * 4) { state.x = x; state.z = z; }
  else { state.x += (x - state.x) * blend; state.z += (z - state.z) * blend; }
  state.phase += state.speed * frame / Math.max(.01, stride) * Math.PI * 2;
  state.targetX = x; state.targetZ = z;
  return state;
}
