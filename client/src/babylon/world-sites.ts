import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { GridData, RtsWorldSite } from '@tower/shared';
import { sampleHeight } from '@voxkera/engine-terrain';

/** Readable landmarks for optional objectives; their state belongs to the simulation. */
export class WorldSiteRenderer {
  private views = new Map<string,{root:TransformNode; flag:Mesh; material:StandardMaterial; ring:Mesh}>();
  constructor(private scene: Scene, private grid: GridData, private heightmap: number[][]) {}
  sync(sites: RtsWorldSite[]): void {
    for(const site of sites) {
      let view = this.views.get(site.id);
      if(!view) {
        const root = new TransformNode(`world-site-${site.id}`,this.scene);
        root.position.set((site.col+.5-this.grid.cols/2)*this.grid.cellSize,
          sampleHeight(this.heightmap,this.grid,site.col,site.row,true),(site.row+.5-this.grid.rows/2)*this.grid.cellSize);
        root.scaling.setAll(this.grid.cellSize);
        const material = new StandardMaterial(`site-${site.id}-mat`,this.scene);
        material.diffuseColor = new Color3(.38,.29,.19); material.specularColor.set(0,0,0);
        const box = (name:string,w:number,h:number,d:number,x:number,y:number,z:number):Mesh => {
          const mesh = MeshBuilder.CreateBox(`${site.id}-${name}`,{width:w,height:h,depth:d},this.scene);
          mesh.parent=root;mesh.position.set(x,y,z);mesh.material=material;mesh.isPickable=false;return mesh;
        };
        if(site.kind==='supplies') {
          box('cart',1.6,.22,.85,0,.4,0);
          box('crate-a',.65,.65,.6,-.38,.8,0); box('crate-b',.6,.45,.6,.4,.7,0);
          for(const x of [-.6,.6]) for(const z of [-.48,.48]) box('wheel',.34,.4,.14,x,.22,z);
        } else {
          for(let i=0;i<3;i++) box(`stone-${i}`,1.25-i*.2,.35,1.25-i*.2,0,.18+i*.35,0);
          box('signal-pole',.17,2.5,.17,0,1.5,0);
        }
        const flag = box('banner',.75,.55,.06,.4,site.kind==='beacon'?2.4:1.4,0);
        const flagMaterial = new StandardMaterial(`site-${site.id}-banner`,this.scene);
        flag.material=flagMaterial;
        const ring = MeshBuilder.CreateTorus(`site-${site.id}-capture`,{diameter:4.6,thickness:.035,tessellation:48},this.scene);
        ring.parent=root;ring.position.y=.07;ring.material=flagMaterial;ring.isPickable=false;
        view={root,flag,material,ring};this.views.set(site.id,view);
      }
      const mat=view.flag.material as StandardMaterial;
      mat.diffuseColor.set(site.secured?.2:.6,site.secured?.55:.3,site.secured?.38:.14);
      mat.emissiveColor.copyFrom(mat.diffuseColor).scaleInPlace(.65);
      view.ring.visibility=site.secured?.2:.5+site.progress*.5;
    }
  }
  dispose():void {
    for(const view of this.views.values()) {view.root.dispose(false);view.material.dispose();view.flag.material?.dispose();}
    this.views.clear();
  }
}
