// 三面図（シルエット 3 つ）から立体を作り、GLB にする。
//   1. 三面図の寸法がそろっているか調べる（dimensionWarnings）
//   2. 輪郭を押し出して交差させた、なめらかな立体を作る（solid.js）
//   3. うまくいかなければボクセルで作る（voxel.js）
//
// F, T, S: 正面図・平面図・右側面図のシルエット { s, W, H }。
//   作図用紙・編集画面では W, H は半マスの数、普通の紙では画素数。
// views: solid.js の buildSolid に渡す { front, top, side }（実寸 mm に対応づけたマスク）
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildSolid, placeForDisplay } from './solid.js';
import { carve, voxelsToGeometry } from './voxel.js';

// 三面図の寸法のずれを文章で返す。unit（半マスの mm）があれば半マス単位で厳密に、なければ 15% までのずれを許す
export function dimensionWarnings(F, T, S, unit) {
  const warn = [];
  if (unit) {
    if (F.W !== T.W) warn.push(`正面図と平面図の幅がちがいます（${F.W / 2}マスと${T.W / 2}マス）`);
    if (F.H !== S.H) warn.push(`正面図と右側面図の高さがちがいます（${F.H / 2}マスと${S.H / 2}マス）`);
    if (T.H !== S.W) warn.push(`平面図の奥行きと右側面図の幅がちがいます（${T.H / 2}マスと${S.W / 2}マス）`);
  } else {
    const rel = (a, b) => Math.abs(a - b) / Math.max(a, b);
    if (rel(F.W, T.W) > 0.15) warn.push('正面図と平面図の幅がずれています');
    if (rel(F.H, S.H) > 0.15) warn.push('正面図と側面図の高さがずれています');
    if (rel(T.H, S.W) > 0.15) warn.push('平面図の奥行きと側面図の幅がずれています');
  }
  return warn;
}

// 立体を作る。戻り値 { C（ボクセルの結果）, solid（なめらかな立体。作れなければ null）, glb（Blob） }
// res: 普通の紙のときのボクセルの細かさ（いちばん長い辺の分割数）
export async function reconstruct(F, T, S, { views, unit, res }) {
  const C = carve(F, T, S, unit ? Math.max(F.W, F.H, T.H, S.W) : res);
  if (!C.count) throw new Error('三面図から立体を作れませんでした。');
  let geo = null,
    solid = null;
  if (views) {
    try {
      solid = buildSolid(views);
      geo = placeForDisplay(solid.geo);
    } catch (e) {
      console.warn('CSG failed, falling back to voxels', e);
      solid = null;
    }
  }
  if (!geo) geo = voxelsToGeometry(C);
  return { C, solid, glb: await toGlb(geo) };
}

// 立体の大きさの説明文
export function sizeText(C, solid, unit) {
  const r1 = v => Math.round(v * 10) / 10;
  if (unit && solid)
    return `図面上の大きさ: 幅 ${r1(solid.size.x)}mm × 高さ ${r1(solid.size.y)}mm × 奥行き ${r1(solid.size.z)}mm`;
  if (unit)
    return `図面上の大きさ: 幅 ${C.nx * unit}mm × 高さ ${C.ny * unit}mm × 奥行き ${C.nz * unit}mm（${unit}mm 単位）`;
  return `グリッド ${C.nx}×${C.ny}×${C.nz}、ブロック ${C.count} 個。`;
}

async function toGlb(geo) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.7, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  const scene = new THREE.Scene();
  scene.add(mesh);
  return new Promise((res, rej) =>
    new GLTFExporter().parse(scene, r => res(new Blob([r], { type: 'model/gltf-binary' })), rej, { binary: true }),
  );
}
