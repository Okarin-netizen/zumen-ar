// ボクセル彫刻: 三面のシルエットを押し出して交差させ、小さな立方体の集まりで立体を作る。
// なめらかな立体（solid.js）が作れないときの予備と、三面図の寸法チェックに使う。
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { sampleGrid } from './silhouette.js';

// 三面のシルエットを押し出して交差（ボクセル彫刻）
export function carve(F, T, S, res) {
  // 寸法: 幅X = 正面図の幅 ≒ 平面図の幅, 高さY = 正面図の高さ ≒ 側面図の高さ, 奥行Z = 平面図の高さ ≒ 側面図の幅
  const X = (F.W + T.W) / 2,
    Y = (F.H + S.H) / 2,
    Z = (T.H + S.W) / 2;
  const u = Math.max(X, Y, Z) / res;
  const nx = Math.max(1, Math.round(X / u)),
    ny = Math.max(1, Math.round(Y / u)),
    nz = Math.max(1, Math.round(Z / u));
  const f = sampleGrid(F, nx, ny),
    t = sampleGrid(T, nx, nz),
    s = sampleGrid(S, nz, ny);
  const vox = new Uint8Array(nx * ny * nz);
  let count = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        // 正面図: (i, 上からj)。平面図: 下端が手前(k=0)なので行 = nz-1-k。右側面図: 左端が手前なので列 = k
        const v = f[j * nx + i] && t[(nz - 1 - k) * nx + i] && s[j * nz + k];
        if (v) {
          vox[(k * ny + j) * nx + i] = 1;
          count++;
        }
      }
  return { vox, nx, ny, nz, count, u, X, Y, Z };
}

// 露出面だけのメッシュ（Y上向き、底面を原点に）
export function voxelsToGeometry({ vox, nx, ny, nz }, size = 0.2) {
  const at = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && vox[(k * ny + j) * nx + i];
  const s = size / Math.max(nx, ny, nz),
    pos = [],
    nrm = [];
  const faces = [
    [
      [-1, 0, 0],
      [
        [0, 0, 0],
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
      ],
    ],
    [
      [1, 0, 0],
      [
        [1, 0, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 0, 1],
      ],
    ],
    [
      [0, -1, 0],
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ],
    ],
    [
      [0, 1, 0],
      [
        [0, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
        [1, 1, 0],
      ],
    ],
    [
      [0, 0, -1],
      [
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 0, 0],
      ],
    ],
    [
      [0, 0, 1],
      [
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
      ],
    ],
  ];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!at(i, j, k)) continue;
        // 画像のjは上から → 3DのYは下から
        const yb = ny - 1 - j;
        for (const [n, q] of faces) {
          const nj = j - n[1]; // Y反転
          if (at(i + n[0], nj, k + n[2])) continue;
          const P = q.map(([a, b, c]) => [(i + a - nx / 2) * s, (yb + b) * s, (nz / 2 - (k + c)) * s]);
          // Zを反転したので向きを保つため頂点順を反転
          for (const idx of [0, 2, 1, 0, 3, 2]) {
            pos.push(...P[idx]);
            nrm.push(n[0], n[1], -n[2]);
          }
        }
      }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return mergeVertices(geo);
}
