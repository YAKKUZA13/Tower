import { Effect } from 'babylonjs';

/** Регистрирует vertex/fragment GLSL шейдеры GPU-дисплейсмента террейна (один раз). */
export function ensureTerrainShaders(): void {
  if (Effect.ShadersStore.terrainVertexShader) return;
  Effect.ShadersStore.terrainVertexShader = `
    precision highp float;
    attribute vec3 position;
    uniform mat4 worldViewProjection;
    uniform vec2 groundSize;
    uniform vec2 heightmapSize;
    uniform vec2 heightStep;
    uniform sampler2D heightmapSampler;
    uniform float heightMin;
    uniform float heightMax;
    varying vec3 vNormal;
    varying float vHeight;

    vec2 worldToUv(vec2 worldXZ) {
      return clamp(worldXZ / groundSize + 0.5, vec2(0.0), vec2(1.0));
    }

    float sampleHeight(vec2 uv) {
      float h = texture2D(heightmapSampler, uv).r;
      return mix(heightMin, heightMax, h);
    }

    vec3 computeNormal(vec2 uv) {
      vec2 texel = vec2(1.0) / heightmapSize;
      float hL = sampleHeight(uv - vec2(texel.x, 0.0));
      float hR = sampleHeight(uv + vec2(texel.x, 0.0));
      float hD = sampleHeight(uv - vec2(0.0, texel.y));
      float hU = sampleHeight(uv + vec2(0.0, texel.y));
      float dhdx = (hR - hL) / max(0.001, 2.0 * heightStep.x);
      float dhdz = (hU - hD) / max(0.001, 2.0 * heightStep.y);
      return normalize(vec3(-dhdx, 1.0, -dhdz));
    }

    void main() {
      vec2 uv = worldToUv(position.xz);
      float h = sampleHeight(uv);
      vec3 displaced = vec3(position.x, h, position.z);
      vNormal = computeNormal(uv);
      vHeight = h;
      gl_Position = worldViewProjection * vec4(displaced, 1.0);
    }
  `;
  Effect.ShadersStore.terrainFragmentShader = `
    precision highp float;
    uniform vec3 lightDir;
    uniform vec3 lightSky;
    uniform vec3 lightGround;
    uniform float lightIntensity;
    uniform float heightMin;
    uniform float heightMax;
    varying vec3 vNormal;
    varying float vHeight;

    vec3 heightToColor(float height, float minH, float maxH) {
      float range = max(1e-3, maxH - minH);
      float t = clamp((height - minH) / range, 0.0, 1.0);
      if (t < 0.25) {
        float k = t / 0.25;
        return vec3(mix(0.10, 0.15, k), mix(0.12, 0.22, k), mix(0.08, 0.12, k));
      }
      if (t < 0.55) {
        float k = (t - 0.25) / 0.30;
        return vec3(mix(0.15, 0.35, k), mix(0.22, 0.65, k), mix(0.12, 0.30, k));
      }
      if (t < 0.8) {
        float k = (t - 0.55) / 0.25;
        return vec3(mix(0.35, 0.55, k), mix(0.40, 0.55, k), mix(0.30, 0.55, k));
      }
      float k = (t - 0.8) / 0.2;
      return vec3(mix(0.55, 0.9, k), mix(0.55, 0.9, k), mix(0.55, 0.95, k));
    }

    void main() {
      vec3 n = normalize(vNormal);
      vec3 l = normalize(lightDir);
      float hemi = dot(n, l) * 0.5 + 0.5;
      vec3 lightColor = mix(lightGround, lightSky, hemi);
      vec3 base = heightToColor(vHeight, heightMin, heightMax);
      gl_FragColor = vec4(base * lightColor * lightIntensity, 1.0);
    }
  `;
}
