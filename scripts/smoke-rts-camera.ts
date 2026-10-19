import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { Scene } from '@babylonjs/core/scene.js';
import { rtsCameraBasis, rtsCameraGroundOffset } from '../client/src/babylon/rtscam';

const engine = new NullEngine();
const scene = new Scene(engine);
const camera = new ArcRotateCamera('camera', 0, Math.PI / 5, 80, Vector3.Zero(), scene);
camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
camera.orthoLeft = -16;
camera.orthoRight = 16;
camera.orthoTop = 10;
camera.orthoBottom = -10;
const viewport = new Viewport(0, 0, 1600, 1000);
const project = (position: Vector3) => Vector3.Project(position, Matrix.Identity(), camera.getTransformationMatrix(), viewport);

try {
  for (let step = 0; step < 8; step++) {
    const yaw = -Math.PI / 4 + step * Math.PI / 4;
    camera.alpha = yaw;
    camera.getViewMatrix(true);
    camera.getProjectionMatrix(true);
    const origin = project(Vector3.Zero());
    const basis = rtsCameraBasis(yaw);
    const right = project(new Vector3(basis.rightX, 0, basis.rightZ));
    const forward = project(new Vector3(basis.forwardX, 0, basis.forwardZ));
    assert(right.x > origin.x && Math.abs(right.y - origin.y) < 1e-4, `screen-right movement at yaw ${yaw}: ${right.toString()}`);
    assert(forward.y < origin.y && Math.abs(forward.x - origin.x) < 1e-4, `screen-up movement at yaw ${yaw}: ${forward.toString()}`);
    for (const beta of [Math.PI / 6, Math.PI / 5, Math.PI / 3]) {
      camera.beta = beta;
      camera.target.set(0, 0, 0);
      camera.orthoLeft = -16;
      camera.orthoRight = 16;
      camera.orthoTop = 10;
      camera.orthoBottom = -10;
      camera.getViewMatrix(true);
      camera.getProjectionMatrix(true);
      const offset = rtsCameraGroundOffset(yaw, beta, 20, 1.6, 0.45, -0.3);
      const point = new Vector3(offset.x, 0, offset.z);
      const before = project(point);
      assert(Math.abs(before.x - 1160) < 1e-3 && Math.abs(before.y - 350) < 1e-3, 'ground offset matches the actual projection');
      const shift = rtsCameraGroundOffset(yaw, beta, 20 - 12, 1.6, 0.45, -0.3);
      camera.target.set(shift.x, 0, shift.z);
      camera.orthoLeft = -9.6;
      camera.orthoRight = 9.6;
      camera.orthoTop = 6;
      camera.orthoBottom = -6;
      camera.getViewMatrix(true);
      camera.getProjectionMatrix(true);
      const after = project(point);
      assert(Math.hypot(after.x - before.x, after.y - before.y) < 1e-3, `zoom keeps the cursor anchor at yaw ${yaw}, beta ${beta}`);
    }
    camera.target.set(0, 0, 0);
  }
  console.log('✓ Camera movement follows the rendered screen axes at all eight rotations');
  console.log('✓ Cursor zoom preserves its ground anchor at eight rotations and three viewing angles');
} finally {
  scene.dispose();
  engine.dispose();
}
