import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { Scene } from '@babylonjs/core/scene.js';

const vertex = `attribute vec3 position; attribute vec2 uv;
uniform mat4 worldViewProjection; varying vec2 vUV;
void main(){vUV=uv;gl_Position=worldViewProjection*vec4(position,1.0);}`;
const fragment = `precision highp float; varying vec2 vUV;
uniform float time; uniform float fade; uniform float mode; uniform vec3 tint;
void main(){
 vec2 p=vUV*2.0-1.0; float r=length(p); float a=atan(p.y,p.x);
 float edge=1.0-smoothstep(.96,1.0,r);
 float rim=1.0-smoothstep(.015,.055,abs(r-.91));
 float wave=pow(max(0.0,1.0-abs(fract(r*4.0-time*1.6)*2.0-1.0)),10.0);
 float spokes=pow(abs(cos(a*6.0)),30.0)*(1.0-smoothstep(.2,.88,r));
 float alpha=(rim*.8+wave*.28+spokes*.38+.07)*edge*fade;
 if(mode>.5&&mode<1.5){alpha+=pow(max(0.0,1.0-r),2.0)*fade*.9;}
 if(mode>1.5){alpha=(.7+.3*sin(vUV.y*23.0+time*18.0+sin(vUV.x*18.0)))*fade;}
 if(alpha<.015)discard;
 gl_FragColor=vec4(tint*(1.0+wave*.6),alpha);
}`;

export interface AreaEffectSpec {
  id: string;
  kind: 'meteor' | 'freeze' | 'gold';
  center: { x: number; y: number; z: number };
  radius: number;
  duration: number;
}
interface LiveEffect { spec: AreaEffectSpec; age: number; meshes: Mesh[]; material: ShaderMaterial; fire?: ShaderMaterial; ice?: ShaderMaterial }
export interface AreaEffectSurface { cellSize: number; heightAt: (x:number,z:number)=>number }

/** Shader-based effects with explicit lifetimes: no untracked observers, timers or particles. */
export class AreaEffectRenderer {
  private readonly effects = new Map<string, LiveEffect>();
  constructor(private scene: Scene, private surface?: AreaEffectSurface) {
    Effect.ShadersStore['towerAreaVertexShader'] = vertex;
    Effect.ShadersStore['towerAreaFragmentShader'] = fragment;
  }
  private createSurface(spec:AreaEffectSpec):Mesh {
    if(!this.surface) return MeshBuilder.CreateGround(`spell-area-${spec.id}`,{width:spec.radius*2,height:spec.radius*2},this.scene);
    const mesh=new Mesh(`spell-area-${spec.id}`,this.scene), data=new VertexData();
    const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
    const step=this.surface.cellSize;
    const minX=Math.floor((spec.center.x-spec.radius)/step)*step, minZ=Math.floor((spec.center.z-spec.radius)/step)*step;
    for(let z=minZ;z<spec.center.z+spec.radius;z+=step) for(let x=minX;x<spec.center.x+spec.radius;x+=step) {
      const y=this.surface.heightAt(x+step/2,z+step/2)-spec.center.y;
      const index=positions.length/3;
      for(const [px,pz] of [[x,z],[x+step,z],[x+step,z+step],[x,z+step]]) {
        positions.push(px!-spec.center.x,y,pz!-spec.center.z);
        uvs.push((px!-spec.center.x)/(2*spec.radius)+.5,(pz!-spec.center.z)/(2*spec.radius)+.5);
      }
      indices.push(index,index+2,index+1,index,index+3,index+2);
    }
    data.positions=positions;data.uvs=uvs;data.indices=indices;data.applyToMesh(mesh);
    return mesh;
  }
  private material(name: string, tint: Color3, mode: number): ShaderMaterial {
    const material = new ShaderMaterial(name, this.scene, { vertex: 'towerArea', fragment: 'towerArea' }, {
      attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'fade', 'mode', 'tint'],
      needAlphaBlending: true
    });
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.setColor3('tint', tint); material.setFloat('mode', mode);
    material.setFloat('time', 0); material.setFloat('fade', 1);
    return material;
  }
  spawn(spec: AreaEffectSpec): void {
    if (this.effects.has(spec.id)) return;
    const tint = spec.kind === 'freeze' ? new Color3(.38,.8,1) : spec.kind === 'gold' ? new Color3(1,.78,.25) : new Color3(1,.3,.06);
    const material = this.material(`area-${spec.id}`, tint, 0);
    const disk = this.createSurface(spec);
    disk.position.set(spec.center.x, spec.center.y+.09, spec.center.z);
    disk.material = material; disk.isPickable = false;
    const meshes: Mesh[] = [disk];
    let fire: ShaderMaterial | undefined;
    let ice: ShaderMaterial | undefined;
    if (spec.kind === 'meteor') {
      fire = this.material(`meteor-fire-${spec.id}`, new Color3(1,.55,.09), 2);
      const meteor = MeshBuilder.CreateSphere(`meteor-projectile-${spec.id}`, { diameter: Math.max(.5,spec.radius*.35), segments: 6 }, this.scene);
      const tail = MeshBuilder.CreateCylinder(`meteor-tail-${spec.id}`, { height: spec.radius*1.8, diameterBottom: spec.radius*.28, diameterTop: 0, tessellation: 8 }, this.scene);
      meteor.material = fire; tail.material = fire;
      meteor.isPickable = false; tail.isPickable = false;
      meshes.push(meteor, tail);
    } else if (spec.kind === 'freeze') {
      ice=this.material(`frost-crystal-${spec.id}`,tint,3);
      for (let i=0;i<12;i++) {
        const shard = MeshBuilder.CreateCylinder(`frost-shard-${spec.id}-${i}`, { height: .65, diameterBottom: .25, diameterTop: 0, tessellation: 4 }, this.scene);
        const angle = i*Math.PI*2/12, radius = spec.radius*(.55+(i%3)*.12);
        shard.position.set(spec.center.x+Math.cos(angle)*radius, spec.center.y+.3, spec.center.z+Math.sin(angle)*radius);
        shard.material = ice; shard.isPickable = false;
        meshes.push(shard);
      }
    }
    this.effects.set(spec.id,{spec,age:0,meshes,material,fire,ice});
    this.updateEffect(this.effects.get(spec.id)!);
  }
  private updateEffect(effect: LiveEffect): void {
    const { spec, age, meshes, material, fire } = effect;
    const fade = Math.min(1, Math.max(0,(spec.duration-age)/.6));
    material.setFloat('time',age); material.setFloat('fade',fade);
    effect.ice?.setFloat('time',age);effect.ice?.setFloat('fade',fade);
    if (fire) {
      fire.setFloat('time',age); fire.setFloat('fade',fade);
      const flight = Math.min(1,age/.7);
      const height = (1-flight*flight)*Math.max(7,spec.radius*3);
      meshes[1]!.position.set(spec.center.x+(1-flight)*spec.radius*.6,spec.center.y+height+.3,spec.center.z);
      meshes[2]!.position.copyFrom(meshes[1]!.position);
      meshes[2]!.position.y += spec.radius*.7;
      meshes[1]!.setEnabled(age<.7); meshes[2]!.setEnabled(age<.7);
      material.setFloat('mode',age<.7 ? 0 : 1);
      meshes[0]!.scaling.setAll(1);
    }
  }
  update(dt: number): void {
    for (const [id,effect] of this.effects) {
      effect.age += Math.max(0,dt);
      if(effect.age>=effect.spec.duration) { this.release(effect); this.effects.delete(id); }
      else this.updateEffect(effect);
    }
  }
  private release(effect: LiveEffect): void {
    for(const mesh of effect.meshes) mesh.dispose();
    effect.material.dispose(); effect.fire?.dispose(); effect.ice?.dispose();
  }
  dispose(): void { for(const effect of this.effects.values()) this.release(effect); this.effects.clear(); }
}
