// 図の輪郭から「内側を塗ったシルエット」を作る。普通の紙（作図用紙でない）では三面図の場所もここで探す。
//
// シルエット: { s: Uint8Array（1 = 内側）, W, H, ox, oy（元画像での左上） }
import { components, dilate, floodOutside } from './image.js';

// 3つの図を見つけ、配置から正面・平面・側面を決める（第三角法: 平面図が上、右側面図が右）
export function findViews(ink, w, h) {
  const r = Math.max(3, Math.round(Math.min(w, h) / 120));
  const dm = dilate(ink, w, h, r);
  const { lab, comps } = components(dm, w, h);
  const cand = comps
    .filter(c => !c.border && c.bw > w * 0.04 && c.bh > h * 0.04)
    .sort((a, b) => b.bw * b.bh - a.bw * a.bh)
    .slice(0, 3);
  if (cand.length < 3)
    throw new Error(
      '図が3つ見つかりませんでした（見つかった数: ' +
        cand.length +
        '）。明るい場所で、図面全体が写るように撮ってください。',
    );
  const cx = c => (c.x0 + c.x1) / 2,
    cy = c => (c.y0 + c.y1) / 2;
  // 平面図 = 一番上、残りのうち左が正面図、右が側面図
  const byY = [...cand].sort((a, b) => cy(a) - cy(b));
  const top = byY[0];
  const rest = byY.slice(1).sort((a, b) => cx(a) - cx(b));
  const front = rest[0],
    side = rest[1];
  return { front, top, side, lab, dm, r };
}

// 連結成分 comp（r 画素膨張済みの線）の内側を塗りつぶしたシルエット（外側から塗って反転）
export function silhouette(comp, lab, dm, w, r) {
  const pad = 2,
    bw = comp.bw + pad * 2,
    bh = comp.bh + pad * 2;
  const on = new Uint8Array(bw * bh);
  for (let y = 0; y < comp.bh; y++)
    for (let x = 0; x < comp.bw; x++) {
      const p = (comp.y0 + y) * w + comp.x0 + x;
      if (lab[p] === comp.id) on[(y + pad) * bw + x + pad] = 1;
    }
  const out = floodOutside(on, bw, bh);
  // 膨張した分（r）を内側に戻すため、外側領域を r だけ膨張させてから反転
  const outD = dilate(out, bw, bh, r);
  const sil = new Uint8Array(bw * bh);
  let x0 = bw,
    y0 = bh,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const v = outD[y * bw + x] ? 0 : 1;
      sil[y * bw + x] = v;
      if (v) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) throw new Error('輪郭が閉じていない図があります。線のすき間をつないでください。');
  // 中身の境界で切り出し
  const W = x1 - x0 + 1,
    H = y1 - y0 + 1,
    s = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s[y * W + x] = sil[(y + y0) * bw + x + x0];
  return { s, W, H, ox: comp.x0 - pad + x0, oy: comp.y0 - pad + y0 };
}

// シルエットを nx × ny のグリッドに標本化
export function sampleGrid(sil, nx, ny) {
  const g = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = Math.min(sil.W - 1, Math.floor(((i + 0.5) / nx) * sil.W)),
        y = Math.min(sil.H - 1, Math.floor(((j + 0.5) / ny) * sil.H));
      g[j * nx + i] = sil.s[y * sil.W + x];
    }
  return g;
}

// シルエットを solid.js の buildSolid に渡す形（view）にする。普通の紙では実寸がわからないので 1px = 1 単位
export function freehandView(sil) {
  return { mask: sil.s, w: sil.W, h: sil.H, pxPerMm: 1, x0: 0, y0: 0, snap: null };
}
