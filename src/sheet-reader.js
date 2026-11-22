// 作図用紙（四隅マーカー付き方眼紙）の写真を読み取る。
// 1. 四隅の■を探して用紙を真上から見た画像に補正する（A4 基準 297×210mm を 1mm = PX 画素）
// 2. 左上の小さな四角（ビット）から用紙の種類とマスの大きさを読む
// 3. 3つの枠それぞれで方眼を消し、線を拾ってシルエットにする
// 配置は sheet.js（印刷する用紙と同じ計算）。座標は用紙左上からの mm。
import { Sheet } from './sheet.js';
import { adaptiveInk, components, dilate, otsu } from './image.js';
import { silhouette } from './silhouette.js';
import { freeEdges, vectorize } from './line-reader.js';

const PX = 4; // 補正後の画像は A4 基準 1mm = 4px
const FID_C = Sheet.FID_A4.map(([x, y]) => [x + Sheet.FID_SIZE / 2, y + Sheet.FID_SIZE / 2]); // 四隅マーカー中心（A4基準、時計回り）

// 四隅の黒い正方形を探す。見つからなければ null
function findFiducials(g, w, h) {
  const t = otsu(g),
    dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) dark[i] = g[i] < Math.min(t, 110) ? 1 : 0;
  const { comps } = components(dark, w, h);
  const mn = Math.min(w, h) / 90,
    mx = Math.min(w, h) / 7;
  const cand = comps
    .filter(
      c =>
        c.bw >= mn &&
        c.bh >= mn &&
        c.bw <= mx &&
        c.bh <= mx &&
        c.bw / c.bh > 0.6 &&
        c.bw / c.bh < 1.67 &&
        c.n / (c.bw * c.bh) > 0.6,
    )
    .map(c => ({ ...c, cx: (c.x0 + c.x1 + 1) / 2, cy: (c.y0 + c.y1 + 1) / 2, fill: c.n / (c.bw * c.bh) }));
  if (cand.length < 4) return null;
  const pick = f => cand.reduce((a, b) => (f(b) > f(a) ? b : a));
  const q = [pick(c => -(c.cx + c.cy)), pick(c => c.cx - c.cy), pick(c => c.cx + c.cy), pick(c => -(c.cx - c.cy))]; // TL,TR,BR,BL
  if (new Set(q).size < 4) return null;
  const sizes = q.map(c => Math.sqrt(c.bw * c.bh));
  if (Math.max(...sizes) / Math.min(...sizes) > 2.5) return null;
  // 四角形として十分な大きさか
  const area =
    Math.abs(
      q.reduce((a, c, i) => {
        const d = q[(i + 1) % 4];
        return a + c.cx * d.cy - d.cx * c.cy;
      }, 0),
    ) / 2;
  if (area < w * h * 0.12) return null;
  // 白抜きのマーカー（いちばん塗りが少ない）を左上にして向きを決める
  let k = 0;
  q.forEach((c, i) => {
    if (c.fill < q[k].fill) k = i;
  });
  if (q[k].fill > 0.92) k = 0;
  return [0, 1, 2, 3].map(i => q[(i + k) % 4]);
}

function solveLinear(A, b) {
  const n = b.length,
    M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++)
      if (r !== c) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function homography(src, dst) {
  // src[i]=[u,v] → dst[i]=[x,y]
  const A = [],
    b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i],
      [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  return [...solveLinear(A, b), 1];
}

// 用紙を真上から見た画像に補正（A4基準 297×210mm を PX 倍）
function warpSheet(rgba, w, h, fids) {
  const H = homography(
    FID_C,
    fids.map(c => [c.cx, c.cy]),
  );
  const OW = 297 * PX,
    OH = 210 * PX,
    red = new Float32Array(OW * OH),
    gray = new Float32Array(OW * OH),
    rgbOut = new Uint8ClampedArray(OW * OH * 4);
  for (let y = 0; y < OH; y++)
    for (let x = 0; x < OW; x++) {
      const u = (x + 0.5) / PX,
        v = (y + 0.5) / PX,
        d = H[6] * u + H[7] * v + H[8];
      const sx = (H[0] * u + H[1] * v + H[2]) / d - 0.5,
        sy = (H[3] * u + H[4] * v + H[5]) / d - 0.5;
      const x0 = Math.max(0, Math.min(w - 2, Math.floor(sx))),
        y0 = Math.max(0, Math.min(h - 2, Math.floor(sy)));
      const fx = Math.max(0, Math.min(1, sx - x0)),
        fy = Math.max(0, Math.min(1, sy - y0)),
        o = y * OW + x;
      const px = ch => {
        const i = (y0 * w + x0) * 4 + ch,
          j = i + w * 4;
        return (rgba[i] * (1 - fx) + rgba[i + 4] * fx) * (1 - fy) + (rgba[j] * (1 - fx) + rgba[j + 4] * fx) * fy;
      };
      const r = px(0),
        g = px(1),
        b = px(2);
      red[o] = r;
      gray[o] = 0.299 * r + 0.587 * g + 0.114 * b;
      rgbOut[o * 4] = r;
      rgbOut[o * 4 + 1] = g;
      rgbOut[o * 4 + 2] = b;
      rgbOut[o * 4 + 3] = 255;
    }
  return { red, gray, rgbOut, OW, OH };
}

// 左上マーカー下の小さな四角から用紙の種類とマスの大きさを読む
function readSheetCode(gray, OW) {
  const mean = (cx, cy, r) => {
    let s = 0,
      n = 0;
    for (let y = Math.round((cy - r) * PX); y < (cy + r) * PX; y++)
      for (let x = Math.round((cx - r) * PX); x < (cx + r) * PX; x++) {
        s += gray[y * OW + x];
        n++;
      }
    return s / n;
  };
  const black = mean(9.2, 13, 0.6),
    white = mean(13, 13, 1.2),
    mid = (black + white) / 2;
  let code = 0;
  for (let i = 0; i < Sheet.NBITS; i++) {
    const [x, y, b] = Sheet.BIT_A4(i);
    if (mean(x + b / 2, y + b / 2, b * 0.25) < mid) code |= 1 << i;
  }
  return code;
}

// 方眼の線を紙の明るさに持ち上げて消す（線ごとの中央値を基準にするので、線の上に描いた鉛筆は残る）
function flattenGrid(crop, cw, ch, cx0, cy0, R0x, R0y, L) {
  const step = (Sheet.gridStep(L.pitch) / L.s) * PX,
    hw = Math.max(1.5, (0.6 / L.s) * PX);
  const median = a => {
    const b = Float32Array.from(a).sort();
    return b[b.length >> 1];
  };
  const paper = median(crop.filter((_, i) => i % 7 === 0));
  const onLine = (v, r0) => {
    const d = (((v - r0) % step) + step) % step;
    return Math.min(d, step - d) <= hw;
  };
  for (let x = 0; x < cw; x++)
    if (onLine(cx0 + x + 0.5, R0x)) {
      const col = new Float32Array(ch);
      for (let y = 0; y < ch; y++) col[y] = crop[y * cw + x];
      const d = paper - median(col);
      if (d > 0) for (let y = 0; y < ch; y++) crop[y * cw + x] += d;
    }
  for (let y = 0; y < ch; y++)
    if (onLine(cy0 + y + 0.5, R0y)) {
      const d = paper - median(crop.subarray(y * cw, (y + 1) * cw));
      if (d > 0) for (let x = 0; x < cw; x++) crop[y * cw + x] += d;
    }
}

// 枠の中の図を読み、方眼（半マス単位）に合わせたシルエットにする
function readRegion(red, OW, rect, L, thr, name) {
  const s = L.s,
    cell = (L.pitch / 2 / s) * PX; // 半マスの大きさ（補正画像の px）
  const R0x = (rect[0] / s) * PX,
    R0y = (rect[1] / s) * PX,
    inset = Math.round(1.2 * PX);
  const cx0 = Math.round(R0x) + inset,
    cy0 = Math.round(R0y) + inset;
  const cw = Math.round((rect[2] / s) * PX) - inset - cx0,
    chh = Math.round((rect[3] / s) * PX) - inset - cy0;
  const crop = new Float32Array(cw * chh);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = red[(cy0 + y) * OW + cx0 + x];
  flattenGrid(crop, cw, chh, cx0, cy0, R0x, R0y, L);
  const ink = adaptiveInk(crop, cw, chh, thr);
  const nw = Math.round((rect[2] - rect[0]) / (L.pitch / 2)),
    nh = Math.round((rect[3] - rect[1]) / (L.pitch / 2));
  const segs = vectorize(dilate(ink, cw, chh, 2), cw, chh, R0x - cx0, R0y - cy0, cell, nw, nh);
  const r = 3,
    dm = dilate(ink, cw, chh, r);
  const { lab, comps } = components(dm, cw, chh);
  const big = comps.filter(c => c.bw > 3 * PX && c.bh > 3 * PX).sort((a, b) => b.bw * b.bh - a.bw * a.bh);
  if (!big.length) {
    const e = new Error(name + 'の枠に図が見つかりませんでした。線を濃くはっきりかいてください。');
    e.segs = segs;
    throw e;
  }
  const sil = silhouette(big[0], lab, dm, cw, r);
  const ax0 = cx0 + sil.ox,
    ay0 = cy0 + sil.oy;
  const gi0 = Math.round((ax0 - R0x) / cell),
    gi1 = Math.max(gi0 + 1, Math.round((ax0 + sil.W - R0x) / cell));
  const gj0 = Math.round((ay0 - R0y) / cell),
    gj1 = Math.max(gj0 + 1, Math.round((ay0 + sil.H - R0y) / cell));
  const n = gi1 - gi0,
    m = gj1 - gj0,
    g = new Uint8Array(n * m);
  for (let j = 0; j < m; j++)
    for (let i = 0; i < n; i++) {
      const x = Math.floor(R0x + (gi0 + i + 0.5) * cell - ax0),
        y = Math.floor(R0y + (gj0 + j + 0.5) * cell - ay0);
      g[j * n + i] = x >= 0 && y >= 0 && x < sil.W && y < sil.H ? sil.s[y * sil.W + x] : 0;
    }
  // なめらかな立体用のマスク（実寸 mm に対応づけ）と、方眼に乗らない斜め線・曲線の取りこみ
  const ppm = PX / s,
    view = {
      mask: sil.s,
      w: sil.W,
      h: sil.H,
      pxPerMm: ppm,
      x0: ax0 / ppm,
      y0: ay0 / ppm,
      erodePx: Math.max(1, Math.round(0.3 * ppm)),
      snap: { u: L.pitch / 2, ox: rect[0], oy: rect[1] },
    };
  const free = freeEdges(view, rect, L.pitch / 2);
  return {
    s: g,
    W: n,
    H: m,
    box: [R0x + gi0 * cell, R0y + gj0 * cell, n * cell, m * cell],
    segs: [...segs, ...free],
    view,
  };
}

// 写真 img（loadToGray の結果）を作図用紙として読む。四隅の■が見つからなければ null。
// 戻り値: { W（補正画像）, L（レイアウト）, code, segs（編集画面用の線）, errors（図が見つからない枠の説明）, F, T, S（シルエット）, views }
// 図が見つからない枠があっても、拾えた線は segs に入れて返す（編集画面で直せるように）。
export function readSheet(img, thr) {
  const { g, w, h, canvas } = img;
  const fids = findFiducials(g, w, h);
  if (!fids) return null;
  const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const W = warpSheet(rgba, w, h, fids);
  const code = readSheetCode(W.gray, W.OW),
    L = Sheet.layout(code);
  if (!L)
    throw new Error('作図用紙の種類を読み取れませんでした。左上の小さな四角がはっきり写るように撮り直してください。');
  const segs = {},
    res = {},
    errors = [];
  for (const [k, v, n] of [
    ['F', 'front', '正面図'],
    ['T', 'top', '平面図'],
    ['S', 'side', '右側面図'],
  ]) {
    try {
      res[k] = readRegion(W.red, W.OW, L.regions[v], L, thr, n);
      segs[v] = res[k].segs;
    } catch (e) {
      segs[v] = e.segs || [];
      errors.push(e.message);
    }
  }
  const views = errors.length ? null : { front: res.F.view, top: res.T.view, side: res.S.view };
  return { W, L, code, segs, errors, F: res.F, T: res.T, S: res.S, views };
}
