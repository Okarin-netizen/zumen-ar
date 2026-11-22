// 図の写真から、編集画面で使う線（半マス単位の線分）を取りだす。
// 線分は { x1, y1, x2, y2, t }（座標は枠の左上を原点とする半マス単位、t は 'solid' / 'hidden'）。
import { viewPolygons } from './solid.js';

// 輪郭のうち、方眼の点どうしを結ぶ縦・横・45°の線で表せない部分（任意の角度の斜め線や円など）を線分として返す
export function freeEdges(view, rect, u) {
  const out = [];
  for (const g of viewPolygons(view))
    for (const poly of [g.outer, ...g.holes])
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i],
          b = poly[(i + 1) % poly.length];
        const p = [(a[0] - rect[0]) / u, (a[1] - rect[1]) / u],
          q = [(b[0] - rect[0]) / u, (b[1] - rect[1]) / u];
        const onNode = v => Math.abs(v[0] - Math.round(v[0])) < 1e-6 && Math.abs(v[1] - Math.round(v[1])) < 1e-6;
        const dx = q[0] - p[0],
          dy = q[1] - p[1];
        if (
          onNode(p) &&
          onNode(q) &&
          (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 1e-6)
        )
          continue;
        const r = v => Math.round(v * 100) / 100;
        out.push({ x1: r(p[0]), y1: r(p[1]), x2: r(q[0]), y2: r(q[1]), t: 'solid' });
      }
  return out;
}

// 方眼に沿って引かれた線を拾う（半マスの辺ごとにインクの割合を調べ、まっすぐ続く部分をまとめる）
export function vectorize(ink, cw, ch, ox, oy, cell, nw, nh) {
  const has = (x, y) => {
    x = Math.round(x);
    y = Math.round(y);
    return x >= 0 && y >= 0 && x < cw && y < ch && ink[y * cw + x];
  };
  const cov = (i1, j1, i2, j2) => {
    let h = 0;
    for (let t = 1; t <= 7; t++) {
      const f = t / 8;
      if (has(ox + (i1 + (i2 - i1) * f) * cell, oy + (j1 + (j2 - j1) * f) * cell)) h++;
    }
    return h / 7;
  };
  const segs = [];
  const runs = (n, m, edge, mk) => {
    for (let a = 0; a <= m; a++) {
      let start = -1,
        sum = 0;
      for (let b = 0; b <= n; b++) {
        const c = b < n ? edge(a, b) : 0;
        if (c >= 0.3) {
          if (start < 0) start = b;
        } else if (start >= 0) {
          // 交わる線や角のにじみで端の辺が少しだけ塗られることがあるので、端の薄い辺は落とす
          let s0 = start,
            e0 = b;
          while (s0 < e0 && edge(a, s0) < 0.75) s0++;
          while (e0 > s0 && edge(a, e0 - 1) < 0.75) e0--;
          let sum = 0;
          for (let q = start; q < b; q++) sum += edge(a, q);
          const len = b - start,
            avg = sum / len;
          if (avg >= 0.8 && e0 > s0) segs.push(mk(a, s0, e0, 'solid'));
          else if (len >= 3 && avg >= 0.35 && avg < 0.8) segs.push(mk(a, start, b, 'hidden'));
          start = -1;
        }
      }
    }
  };
  runs(
    nw,
    nh,
    (j, i) => cov(i, j, i + 1, j),
    (j, s, e, t) => ({ x1: s, y1: j, x2: e, y2: j, t }),
  );
  runs(
    nh,
    nw,
    (i, j) => cov(i, j, i, j + 1),
    (i, s, e, t) => ({ x1: i, y1: s, x2: i, y2: e, t }),
  );
  // 斜めの線（45°）。1マスの対角を候補にし、同じ向きに2マス以上続くものだけを線とする
  // （角のにじみや、方眼から少しずれた縦横の線を斜め線とまちがえないため）
  const ink2 = (i1, j1, i2, j2) => cov(i1, j1, i2, j2) >= 0.95;
  const center = (i, j) => has(ox + (i + 0.5) * cell, oy + (j + 0.5) * cell);
  const mainD = new Set(),
    antiD = new Set();
  for (let j = 0; j < nh; j++)
    for (let i = 0; i < nw; i++) {
      if (!center(i, j)) continue;
      if (
        cov(i, j, i + 1, j + 1) >= 0.85 &&
        !(ink2(i, j, i, j + 1) && ink2(i, j + 1, i + 1, j + 1)) &&
        !(ink2(i, j, i + 1, j) && ink2(i + 1, j, i + 1, j + 1))
      )
        mainD.add(i + ',' + j);
      if (
        cov(i + 1, j, i, j + 1) >= 0.85 &&
        !(ink2(i, j, i + 1, j) && ink2(i, j, i, j + 1)) &&
        !(ink2(i + 1, j, i + 1, j + 1) && ink2(i, j + 1, i + 1, j + 1))
      )
        antiD.add(i + ',' + j);
    }
  for (const [set, di] of [
    [mainD, 1],
    [antiD, -1],
  ]) {
    for (const key of set) {
      const [i, j] = key.split(',').map(Number);
      if (set.has(i - di + ',' + (j - 1))) continue; // 鎖の先頭だけから始める
      let n = 1;
      while (set.has(i + di * n + ',' + (j + n))) n++;
      if (n < 2) continue;
      segs.push(
        di > 0
          ? { x1: i, y1: j, x2: i + n, y2: j + n, t: 'solid' }
          : { x1: i + 1, y1: j, x2: i + 1 - n, y2: j + n, t: 'solid' },
      );
    }
  }
  return cleanSegs(segs);
}

// 手描きのはみ出しを整える: 他の線に届いていない端が1つ手前で他の線に乗っていれば縮め、片方が浮いた1目盛りの短い線は消す
export function cleanSegs(segs) {
  const onSeg = (x, y, g) => {
    const dx = g.x2 - g.x1,
      dy = g.y2 - g.y1,
      l = Math.max(Math.abs(dx), Math.abs(dy));
    for (let t = 0; t <= l; t++) if (g.x1 + (dx / l) * t === x && g.y1 + (dy / l) * t === y) return true;
    return false;
  };
  const touches = (x, y, self) => segs.some(g => g !== self && onSeg(x, y, g));
  for (const g of segs) {
    if (g.x1 !== g.x2 && g.y1 !== g.y2) continue;
    const len = Math.abs(g.x2 - g.x1) + Math.abs(g.y2 - g.y1);
    if (len < 2) continue;
    const sx = Math.sign(g.x2 - g.x1),
      sy = Math.sign(g.y2 - g.y1);
    if (!touches(g.x1, g.y1, g) && touches(g.x1 + sx, g.y1 + sy, g)) {
      g.x1 += sx;
      g.y1 += sy;
    }
    if (!touches(g.x2, g.y2, g) && touches(g.x2 - sx, g.y2 - sy, g)) {
      g.x2 -= sx;
      g.y2 -= sy;
    }
  }
  return segs.filter(
    g =>
      Math.max(Math.abs(g.x2 - g.x1), Math.abs(g.y2 - g.y1)) > 1 || (touches(g.x1, g.y1, g) && touches(g.x2, g.y2, g)),
  );
}
