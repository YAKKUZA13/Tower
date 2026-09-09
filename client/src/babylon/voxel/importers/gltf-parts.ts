/**
 * Blockbench glTF → CharacterDef (Фаза P3, research §5.3; M6 D6/D8 — точная вокселезация).
 *
 * Грузит glTF через SceneLoader.ImportMeshAsync (babylonjs-loaders), обходит node-tree:
 * каждый TransformNode/Mesh с детьми → PartNode (pivot из node position). Воксели парта —
 * ТОЧНАЯ solid voxelization меша (Akenine-Möll triangle-box overlap + column-fill, M6) вместо
 * box-аппроксимации AABB: корректный силуэт Blockbench-модели. Blockbench-конвенция:
 * bone = PartNode, per-cube pivot = node origin.
 */
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { type Scene } from '@babylonjs/core/scene.js';
import type { Voxel } from '../voxel-builder';
import type { CharacterDef, PartNode } from '../voxel-parts';
import { box3 } from '../voxel-builder';
import { solidVoxelize } from '../voxel-solid-voxelization';

/** Размер вокселя при solid voxelization glTF-меша (в модельных единицах glTF). */
const GLTF_VOXEL_SIZE = 0.12;
/** Максимум вокселей в парте (защита от раздувания риге). */
const PART_VOXEL_MAX = 400;
/** Fallback box-разрешение, если solidVoxelize ничего не дал. */
const BOX_APPROX_RES = 4;

interface ImportResult {
  def: CharacterDef;
  /** Все корневые ноды glTF (для отладки). */
  roots: TransformNode[];
}

/**
 * importGltfParts: грузит glTF по URI, строит CharacterDef из node-tree.
 * @param uri путь/URL glTF (относительно baseURL сцены)
 * @param scene Babylon-сцена
 *
 * ВАЖНО: ImportMeshAsync добаляет glTF-меши/ноды (body/eyes/weapon/Armature...)
 * ПРЯМО в переданную сцену. Раньше они там и оставались — видимыми в origin →
 * десятки «мусорных» meшей стекались в (0,0,0) и портили кадр. Теперь после
 * построения CharacterDef все загруженные корневые ноты dispose'ятся — в сцене
 * не остаётся ничего лишнего (CharacterDef несёт только данные вокселей).
 */
export async function importGltfParts(uri: string, scene: Scene): Promise<CharacterDef> {
  const result = await SceneLoader.ImportMeshAsync('', '', uri, scene);
  // result.meshes — AbstractMesh[]; фильтруем до Mesh для box-аппроксимации
  const meshes = result.meshes.filter((m): m is Mesh => m instanceof Mesh);
  const { def, roots } = buildDefFromNodes(meshes, result.transformNodes);
  // Освободить всё, что ImportMeshAsync добавил в сцену (меши + transform-ноды),
  // чтобы glTF-геометрия не утекала видимыми мешами в origin.
  disposeImportedRoots(roots, meshes);
  return def;
}

/** Dispose корневых нод glTF (transformNodes) и любых meшей без родителя. */
function disposeImportedRoots(roots: TransformNode[], meshes: Mesh[]): void {
  const seen = new Set<unknown>();
  const stack: TransformNode[] = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const c of n.getChildren()) stack.push(c as TransformNode);
  }
  // также захватываем «осиротевшие» меши, не попавшие в roots (transform NULL и т.п.)
  for (const m of meshes) {
    if (!seen.has(m)) {
      seen.add(m);
      stack.push(m);
    }
  }
  // dispose повторно безопасен: дочерние уже освобождены через cascade
  for (const n of stack) {
    try {
      if (n instanceof Mesh) n.dispose(false, true);
      else n.dispose();
    } catch {
      /* узел мог быть освобождён как дочерний — игнорируем */
    }
  }
}

/**
 * Синхронный построитель CharacterDef из готовых нод/мешей (для тестов и
 * предзагруженных glTF). Обходит корневые ноды → PartNode-дерево.
 */
export function buildDefFromNodes(meshes: AbstractMesh[], transformNodes: TransformNode[]): ImportResult {
  // соберём всё ноды (meshes + transformNodes), найдём корни (без родителя или с root-родителем)
  const allNodes: TransformNode[] = [...transformNodes, ...meshes];
  const childSet = new Set<TransformNode>();
  for (const n of allNodes) for (const c of n.getChildren()) childSet.add(c as TransformNode);
  const roots = allNodes.filter((n) => !n.parent || !childSet.has(n));

  // рекурсивно строим PartNode-дерево
  const childParts: PartNode[] = [];
  for (const root of roots) {
    const p = buildPartFromNode(root);
    if (p) childParts.push(p);
  }
  // если ничего нет — один пустой парт
  const rootPart: PartNode = childParts.length === 1
    ? childParts[0]!
    : { name: 'root', pivot: [0, 0, 0], voxels: [], children: childParts };
  return { def: { name: 'gltf-import', root: rootPart }, roots };
}

/** Строит PartNode из Babylon-ноды (mesh или transform). M6: точная solid voxelization меша. */
function buildPartFromNode(node: TransformNode): PartNode | null {
  const name = node.name || 'part';
  const pivot: [number, number, number] = [node.position.x, node.position.y, node.position.z];
  const voxels: Voxel[] = [];
  if (node instanceof Mesh && node.getTotalVertices() > 0) {
    node.refreshBoundingInfo();
    // M6: точная solid voxelization (positions/indices локального меша).
    const positions = node.getVerticesData(VertexBuffer.PositionKind) as number[] | null;
    const indices = node.getIndices() as number[] | null;
    if (positions && indices && positions.length > 0 && indices.length > 0) {
      const sv = solidVoxelize(positions, indices, {
        voxelSize: GLTF_VOXEL_SIZE,
        color: [0.42, 0.42, 0.46]
      });
      // центрируем воксели вокруг pivot-начала парта (solidVoxelize возвращает в mesh-local координатах)
      // ограничиваем размер (защита рига)
      voxels.push(...(sv.length > PART_VOXEL_MAX ? sv.slice(0, PART_VOXEL_MAX) : sv));
    }
    // fallback: box-аппроксимация AABB если solidVoxelize пуст (вырожденный меш)
    if (voxels.length === 0) {
      const bb = node.getBoundingInfo().boundingBox;
      const w = Math.max(1, Math.round((bb.maximum.x - bb.minimum.x) * BOX_APPROX_RES));
      const h = Math.max(1, Math.round((bb.maximum.y - bb.minimum.y) * BOX_APPROX_RES));
      const d = Math.max(1, Math.round((bb.maximum.z - bb.minimum.z) * BOX_APPROX_RES));
      box3(voxels, 0, Math.min(w, 3) - 1, 0, Math.min(h, 3) - 1, 0, Math.min(d, 3) - 1, [0.42, 0.42, 0.46]);
    }
  }
  // дочерние ноды
  const children: PartNode[] = [];
  for (const c of node.getChildren()) {
    const cp = buildPartFromNode(c as TransformNode);
    if (cp) children.push(cp);
  }
  return { name, pivot, voxels, children };
}
