// 三面図の輪郭（塗りつぶしたマスク）から、なめらかな立体を作る。
// 各図の輪郭を多角形にして押し出し、3つを交差させる（CSG）。斜面や円柱・穴もそのまま形になる。
import * as THREE from 'three';
import { Brush, Evaluator, INTERSECTION } from 'three-bvh-csg';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

// view = { mask: Uint8Array, w, h, pxPerMm, x0, y0 (マスク左上の mm 座標), snap: { u, ox, oy } | null }

// マスクの境界（画素の辺）をたどって閉じた輪郭にする。塗りが進行方向の右側になる向き
function traceLoops(mask, w, h) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];
  const next = new Map(); // "x,y" -> [[x2,y2], ...]
  const add = (x1, y1, x2, y2) => {
    const k = x1 + ',' + y1;
    if (!next.has(k)) next.set(k, []);
    next.get(k).push([x2, y2]);
  };
  for (let y = 0; y <= h; y++)
    for (let x = 0; x < w; x++) {
      const a = at(x, y - 1),
        b = at(x, y);
      if (a && !b)
        add(x + 1, y, x, y); // 上が塗り → 右から左へ
      else if (!a && b) add(x, y, x + 1, y); // 下が塗り → 左から右へ
    }
  for (let x = 0; x <= w; x++)
    for (let y = 0; y < h; y++) {
      const l = at(x - 1, y),
        r = at(x, y);
      if (l && !r) add(x, y, x, y + 1);
      else if (!l && r) add(x, y + 1, x, y);
    }
  const loops = [];
  for (const [k, list] of next) {
    while (list.length) {
      const [sx, sy] = k.split(',').map(Number);
      const loop = [[sx, sy]];
      let [cx, cy] = list.pop(),
        guard = 0;
      while ((cx !== sx || cy !== sy) && guard++ < 1e7) {
        loop.push([cx, cy]);
        const l2 = next.get(cx + ',' + cy);
        if (!l2 || !l2.length) break;
        const p = l2.pop();
        cx = p[0];
        cy = p[1];
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

const area = p => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i],
      b = p[(i + 1) % p.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};
function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// ---------- 円・円弧の当てはめ ----------
// 輪郭のうち、同じ向きに少しずつ曲がり続ける部分に円を当てはめ、細かい点の円弧に置きかえる。
// 円弧の内側の点には .arc = true の印をつけ、方眼合わせや間引きの対象から外す。
const turnAt = (a, b, c) => {
  const t = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  return Math.atan2(Math.sin(t), Math.cos(t));
};
function dpIdx(pts, i0, i1, tol, out) {
  // pts[i0..i1]（開いた折れ線）を間引いた添字（i0 を含み i1 を含まない）
  const [x1, y1] = pts[i0],
    [x2, y2] = pts[i1],
    L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
  let idx = -1,
    md = 0;
  for (let i = i0 + 1; i < i1; i++) {
    const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L;
    if (d > md) {
      md = d;
      idx = i;
    }
  }
  if (idx < 0 || md <= tol) {
    out.push(i0);
    return;
  }
  dpIdx(pts, i0, idx, tol, out);
  dpIdx(pts, idx, i1, tol, out);
}
function closedIdx(pts, tol) {
  let far = 0,
    fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const ext = [...pts, pts[0]],
    out = [];
  dpIdx(ext, 0, far, tol, out);
  dpIdx(ext, far, pts.length, tol, out);
  return out;
}
function fitCircle(P) {
  // 最小二乗（Kåsa）
  let mx = 0,
    my = 0;
  for (const p of P) {
    mx += p[0];
    my += p[1];
  }
  mx /= P.length;
  my /= P.length;
  let suu = 0,
    svv = 0,
    suv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0;
  for (const p of P) {
    const u = p[0] - mx,
      v = p[1] - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const A = (suuu + suvv) / 2,
    B = (svvv + svuu) / 2;
  const uc = (A * svv - B * suv) / det,
    vc = (B * suu - A * suv) / det,
    cx = mx + uc,
    cy = my + vc;
  let r = 0;
  for (const p of P) r += Math.hypot(p[0] - cx, p[1] - cy);
  r /= P.length;
  let ss = 0,
    mxd = 0;
  for (const p of P) {
    const d = Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r);
    ss += d * d;
    mxd = Math.max(mxd, d);
  }
  return { cx, cy, r, rms: Math.sqrt(ss / P.length), max: mxd };
}
const sweepOf = (c, a, b, dir) => {
  let d = Math.atan2(b[1] - c.cy, b[0] - c.cx) - Math.atan2(a[1] - c.cy, a[0] - c.cx);
  while (dir > 0 && d <= 0) d += 2 * Math.PI;
  while (dir < 0 && d >= 0) d -= 2 * Math.PI;
  return Math.abs(d);
};
const STEP = Math.PI / 36; // 円弧は 5° ごとの点にする
function arcPoints(c, a, b, dir, full) {
  // a→b を中心 c のまわりに dir 向きで（a, b は含まない）
  const a0 = Math.atan2(a[1] - c.cy, a[0] - c.cx);
  let d = Math.atan2(b[1] - c.cy, b[0] - c.cx) - a0;
  if (full) d = dir * 2 * Math.PI;
  else {
    while (dir > 0 && d <= 0) d += 2 * Math.PI;
    while (dir < 0 && d >= 0) d -= 2 * Math.PI;
  }
  const n = Math.max(2, Math.ceil(Math.abs(d) / STEP)),
    out = [];
  for (let k = 1; k < n; k++) {
    const t = a0 + (d * k) / n,
      q = [c.cx + c.r * Math.cos(t), c.cy + c.r * Math.sin(t)];
    q.arc = true;
    out.push(q);
  }
  return out;
}
// L: 閉じた輪郭（mm）, tol: 直線部分の間引き（mm）, fineTol: 曲がりを調べる細かさ（mm）, minR: これより小さい円は角とみなす
function outlineWithArcs(L, tol, fineTol, minR) {
  const n = L.length,
    plain = () => closedIdx(L, tol).map(i => L[i]);
  if (n < 16) return plain();
  const F = closedIdx(L, fineTol),
    m = F.length;
  if (m < 4) return plain();
  const turn = F.map((fi, k) => turnAt(L[F[(k - 1 + m) % m]], L[fi], L[F[(k + 1) % m]]));
  const MAXT = (50 * Math.PI) / 180,
    MINT = (2 * Math.PI) / 180;
  const smooth = t => Math.abs(t) <= MAXT;
  const ok = c => c && c.r >= minR && c.rms <= Math.max(0.25, 0.008 * c.r) && c.max <= Math.max(0.7, 0.02 * c.r); // 手描きのゆれ（0.2〜0.6mm）は許す
  const rawRange = (a, b) => {
    const P = [];
    for (let i = a; ; i = (i + 1) % n) {
      P.push(L[i]);
      if (i === b) break;
    }
    return P;
  };
  // 全体が円（穴や円柱）: 輪郭全体に円がよく当てはまれば円にする
  const tot = turn.reduce((x, y) => x + y, 0);
  if (Math.abs(Math.abs(tot) - 2 * Math.PI) < 0.5) {
    const c = fitCircle(L);
    if (ok(c)) {
      const a = [c.cx + c.r, c.cy];
      const pts = [a, ...arcPoints(c, a, a, Math.sign(tot), true)];
      pts.forEach(q => (q.arc = true));
      return pts;
    }
  }
  // 曲がり続ける区間をさがす（F の添字の範囲 [i, j]、i と j は区間の両端の点）
  let start = turn.findIndex(t => !smooth(t));
  if (start < 0) start = 0;
  const arcs = []; // { i, j (F の添字、start からの相対), c, dir }
  let k = 0;
  while (k < m) {
    const sg = Math.sign(turn[(start + k + 1) % m]);
    let e = k + 1; // e: 区間の終わりの点（内側の点は k+1..e-1）
    while (
      e < m &&
      smooth(turn[(start + e) % m]) &&
      (Math.sign(turn[(start + e) % m]) === sg || Math.abs(turn[(start + e) % m]) < MINT) &&
      sg !== 0
    )
      e++;
    let done = false;
    if (sg !== 0 && e - k >= 3) {
      // 区間の両端を最大2辺ずつ削りながら当てはまる円をさがす
      for (let trim = 0; trim <= 4 && !done; trim++)
        for (let a = 0; a <= trim && !done; a++) {
          const i = k + a,
            j = e - (trim - a);
          if (j - i < 3) continue;
          let tot = 0;
          for (let q = i + 1; q < j; q++) tot += turn[(start + q) % m];
          if (Math.abs(tot) < (40 * Math.PI) / 180) continue;
          const c = fitCircle(rawRange(F[(start + i) % m], F[(start + j) % m]));
          // 円弧の開き角が小さいもの（少しふくらんだ直線）は直線のまま
          const pa = L[F[(start + i) % m]],
            pb = L[F[(start + j) % m]];
          if (ok(c) && sweepOf(c, pa, pb, sg) >= (35 * Math.PI) / 180) {
            arcs.push({ i, j, c, dir: sg });
            k = j;
            done = true;
          }
        }
    }
    if (!done) k++;
  }
  if (!arcs.length) return plain();
  // 組み立て: 円弧以外は粗く間引いた直線、円弧は細かい点
  const out = [],
    proj = (p, c) => {
      const d = Math.hypot(p[0] - c.cx, p[1] - c.cy) || 1;
      return [c.cx + ((p[0] - c.cx) * c.r) / d, c.cy + ((p[1] - c.cy) * c.r) / d];
    };
  const rawAt = q => F[(start + q) % m];
  for (let t = 0; t < arcs.length; t++) {
    const A = arcs[t],
      B = arcs[(t + 1) % arcs.length];
    const pa = proj(L[rawAt(A.i)], A.c),
      pb = proj(L[rawAt(A.j)], A.c);
    out.push(pa, ...arcPoints(A.c, pa, pb, A.dir, false), pb);
    // A の終わりから B の始まりまでの直線部分
    const s = rawAt(A.j),
      e = rawAt(B.i),
      chain = rawRange(s, e);
    if (chain.length > 2) {
      const idx = [];
      dpIdx(chain, 0, chain.length - 1, tol, idx);
      idx.slice(1).forEach(i => out.push(chain[i]));
    }
  }
  return out;
}

function snapPoly(p, { u, ox, oy }) {
  const n = p.length,
    tx = new Array(n).fill(null),
    ty = new Array(n).fill(null);
  const gx = x => ox + Math.round((x - ox) / u) * u,
    gy = y => oy + Math.round((y - oy) / u) * u;
  for (let i = 0; i < n; i++) {
    const a = p[i],
      b = p[(i + 1) % n],
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      L = Math.hypot(dx, dy);
    if (L < 1.2 * u || a.arc || b.arc) continue;
    if (Math.abs(dx) <= Math.max(0.25 * u, 0.1 * L)) {
      // ほぼ縦の辺: 両端の x を平均して方眼の線に
      const m = (a[0] + b[0]) / 2,
        g = gx(m);
      if (Math.abs(g - m) < 0.4 * u) {
        tx[i] = g;
        tx[(i + 1) % n] = g;
      }
    } else if (Math.abs(dy) <= Math.max(0.25 * u, 0.1 * L)) {
      const m = (a[1] + b[1]) / 2,
        g = gy(m);
      if (Math.abs(g - m) < 0.4 * u) {
        ty[i] = g;
        ty[(i + 1) % n] = g;
      }
    } else if (L >= 1.5 * u) {
      // 斜めの線: 両端が方眼の点に近ければ合わせる
      for (const k of [i, (i + 1) % n]) {
        const q = p[k],
          X = gx(q[0]),
          Y = gy(q[1]);
        if (Math.hypot(X - q[0], Y - q[1]) < 0.4 * u) {
          if (tx[k] === null) tx[k] = X;
          if (ty[k] === null) ty[k] = Y;
        }
      }
    }
  }
  return p.map((q, i) => {
    const r = [tx[i] ?? q[0], ty[i] ?? q[1]];
    if (q.arc) r.arc = true;
    return r;
  });
}

function erode(mask, w, h, r) {
  // 線の太さの半分だけ内側へ（輪郭を線の中心に近づける）
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
  const tmp = new Uint8Array(w * h),
    out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const xx = x + k;
        v = xx < 0 || xx >= w ? 1 : inv[y * w + xx];
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r && !v; k++) {
        const yy = y + k;
        v = yy < 0 || yy >= h ? 1 : tmp[yy * w + x];
      }
      out[y * w + x] = v ? 0 : 1;
    }
  return out;
}

// マスク → mm 座標の多角形（外周と穴）
export function viewPolygons(view) {
  const { w, h, pxPerMm, x0, y0, snap } = view;
  const mask = view.erodePx ? erode(view.mask, w, h, view.erodePx) : view.mask;
  const tol = view.tolMm ? view.tolMm : Math.max(1.2 / pxPerMm, snap ? 0.45 : 0.25); // 手描きのゆれを 0.45mm まで吸収
  const fineTol = view.tolMm ? Math.max(view.tolMm, 1.5 / pxPerMm) : Math.max(1 / pxPerMm, 0.2);
  const minR = snap ? Math.max(2, 0.8 * snap.u) : 1; // 手描きの角の丸まりは円弧にしない
  const raw = traceLoops(mask, w, h)
    .map(l =>
      outlineWithArcs(
        l.map(([x, y]) => [x0 + x / pxPerMm, y0 + y / pxPerMm]),
        tol,
        fineTol,
        minR,
      ),
    )
    .filter(p => p.length >= 3);
  // 方眼に沿った直線（縦・横・45°）だけを方眼に合わせる。円弧の点（.arc）はそのまま
  // 合わせたあと、近すぎる点をまとめ、一直線上の点を省く（小さなギザギザやねじれを消す）
  const tidy = (p, d) => {
    const q = [];
    for (const v of p) {
      const l = q[q.length - 1];
      const dd = l ? Math.hypot(v[0] - l[0], v[1] - l[1]) : Infinity;
      if (dd > 1e-6 && (v.arc || (l && l.arc) || dd > d)) q.push(v);
    }
    while (
      q.length > 2 &&
      !q[q.length - 1].arc &&
      Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]) <= d
    )
      q.pop();
    return q;
  };
  const dropCollinear = (p, d) => {
    let q = p.slice(),
      changed = true;
    while (changed && q.length > 3) {
      changed = false;
      for (let i = 0; i < q.length && q.length > 3; i++) {
        const a = q[(i - 1 + q.length) % q.length],
          b = q[i],
          c = q[(i + 1) % q.length];
        if (b.arc) continue;
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1e-9;
        if (Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / L <= d) {
          q.splice(i, 1);
          i--;
          changed = true;
        }
      }
    }
    return q;
  };
  const snapped = p => {
    // 方眼合わせ → 小さなギザギザを省く → もう一度方眼合わせ（省いたあとの辺も合わせる）
    const q = dropCollinear(
      tidy(snapPoly(dropCollinear(tidy(p, 0.35 * snap.u), Math.min(0.6, 0.3 * snap.u)), snap), 0.01),
      0.3,
    );
    return dropCollinear(tidy(snapPoly(q, snap), 0.01), 0.05);
  };
  const polys = raw
    .map(p => (snap ? snapped(p) : p))
    .map(p =>
      p.filter((q, i) => {
        const r = p[(i + 1) % p.length];
        return Math.hypot(q[0] - r[0], q[1] - r[1]) > 1e-6;
      }),
    )
    .filter(p => p.length >= 3 && Math.abs(area(p)) > 0.05);
  // 画像座標（y下向き）で面積が正 = 時計回り表示 = 外周（塗りが右側になる向きで追跡したため）
  const outers = polys.filter(p => area(p) > 0),
    holes = polys.filter(p => area(p) < 0);
  return outers.map(o => ({ outer: o, holes: holes.filter(hh => inside(hh[0], o)) }));
}

function bbox(groups) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const g of groups)
    for (const [x, y] of g.outer) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

// (a, b) 平面の形を c 方向に押し出し、行列 m で (X, Y, Z) に置く
function prism(groups, toAB, L, m) {
  const shapes = groups.map(g => {
    const s = new THREE.Shape(g.outer.map(p => new THREE.Vector2(...toAB(p))));
    s.holes = g.holes.map(hh => new THREE.Path(hh.map(p => new THREE.Vector2(...toAB(p)))));
    return s;
  });
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: L, bevelEnabled: false, curveSegments: 1 });
  geo.applyMatrix4(m);
  geo.deleteAttribute('uv');
  return geo;
}

export function buildSolid({ front, top, side }) {
  const F = viewPolygons(front),
    T = viewPolygons(top),
    S = viewPolygons(side);
  if (!F.length || !T.length || !S.length) throw new Error('輪郭を作れない図があります。');
  const bf = bbox(F),
    bt = bbox(T),
    bs = bbox(S);
  // 座標: X=幅（右）, Y=高さ（上）, Z=手前が正。奥行き Dp は手前の面から奥へ正
  const Wd = Math.max(bf.w, bt.w),
    Hd = Math.max(bf.h, bs.h),
    Dd = Math.max(bt.h, bs.w),
    m = 2;
  const mat = rows => new THREE.Matrix4().set(...rows.flat());
  // 正面図: X = x - x0, Y = y1 - y（反転すると向きが変わるので a=X, b=Y で押し出し方向を +Z に）
  const gF = prism(
    F,
    ([x, y]) => [x - bf.x0, bf.y1 - y],
    Dd + 2 * m,
    mat([
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, -(Dd + m)],
      [0, 0, 0, 1],
    ]),
  );
  // 平面図: X = x - x0, Dp = y1 - y（下端が手前）。a=X, b=Dp, c→Y、Z = -Dp
  const gT = prism(
    T,
    ([x, y]) => [x - bt.x0, bt.y1 - y],
    Hd + 2 * m,
    mat([
      [1, 0, 0, 0],
      [0, 0, 1, -m],
      [0, -1, 0, 0],
      [0, 0, 0, 1],
    ]),
  );
  // 右側面図: Dp = x - x0（左端が手前）, Y = y1 - y。a=Dp, b=Y, c→X、Z = -Dp
  const gS = prism(
    S,
    ([x, y]) => [x - bs.x0, bs.y1 - y],
    Wd + 2 * m,
    mat([
      [0, 0, 1, -m],
      [0, 1, 0, 0],
      [-1, 0, 0, 0],
      [0, 0, 0, 1],
    ]),
  );
  for (const g of [gF, gT, gS]) if (signedVolume(g) < 0) flip(g); // 念のため向きをそろえる
  const ev = new Evaluator();
  ev.attributes = ['position', 'normal'];
  ev.useGroups = false;
  const r1 = ev.evaluate(new Brush(gF), new Brush(gT), INTERSECTION);
  const r2 = ev.evaluate(r1, new Brush(gS), INTERSECTION);
  const geo = r2.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!isFinite(bb.min.x) || bb.max.x - bb.min.x <= 0) throw new Error('三面図から立体を作れませんでした。');
  const vol = signedVolume(geo);
  return {
    geo,
    size: { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z },
    volume: vol,
    polys: { F, T, S },
  };
}

export function signedVolume(geo) {
  const p = geo.attributes.position,
    idx = geo.index;
  let v = 0;
  const n = idx ? idx.count : p.count,
    get = i => (idx ? idx.getX(i) : i);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, get(i));
    b.fromBufferAttribute(p, get(i + 1));
    c.fromBufferAttribute(p, get(i + 2));
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}
function flip(geo) {
  if (geo.index) {
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
    geo.index.needsUpdate = true;
  } else {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        const t = p.array[(i + 1) * 3 + k];
        p.array[(i + 1) * 3 + k] = p.array[(i + 2) * 3 + k];
        p.array[(i + 2) * 3 + k] = t;
      }
    }
    p.needsUpdate = true;
  }
  const nrm = geo.attributes.normal;
  if (nrm) {
    for (let i = 0; i < nrm.array.length; i++) nrm.array[i] = -nrm.array[i];
    nrm.needsUpdate = true;
  }
}

// 立体を表示用に置く（底面を y=0、水平方向は中央、最大寸法 size メートル）
export function placeForDisplay(geo, size = 0.2) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const s = size / Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale(s, s, s);
  // 曲面はなめらかに、角（30°より大きく折れるところ）はくっきり見えるように法線をつける
  const g = geo.index ? geo.toNonIndexed() : geo;
  return toCreasedNormals(g, Math.PI / 6);
}
