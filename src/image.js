// 画像処理の基本部品（グレースケール化・二値化・膨張・連結成分・塗りつぶし）。
// 画像は 1 次元の配列（y * w + x）で持つ。0/1 の配列を「マスク」と呼ぶ。

// 画像を最大 maxSide px に縮めてグレースケールにする
export function loadToGray(img, maxSide = 1400) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * s),
    h = Math.round(img.height * s);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2];
  return { g, w, h, canvas: c };
}

// 積分画像による適応しきい値（照明ムラに強い）。まわりの平均より thr 以上暗い画素を 1 にする
export function adaptiveInk(g, w, h, thr) {
  const ii = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
    }
  }
  const r = Math.max(8, Math.round(Math.min(w, h) / 30));
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r),
        x1 = Math.min(w, x + r + 1),
        y0 = Math.max(0, y - r),
        y1 = Math.min(h, y + r + 1);
      const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      ink[y * w + x] = g[y * w + x] < mean - thr ? 1 : 0;
    }
  return ink;
}

// 大津の方法による二値化のしきい値
export function otsu(g) {
  const hist = new Float64Array(256);
  for (const v of g) hist[Math.max(0, Math.min(255, v | 0))]++;
  let sum = 0,
    n = g.length;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0,
    wB = 0,
    best = 0,
    t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB,
      mF = (sum - sB) / wF,
      v = wB * wF * (mB - mF) ** 2;
    if (v > best) {
      best = v;
      t = i;
    }
  }
  return t;
}

// マスクを r 画素ふくらませる（正方形の範囲。横→縦の順に処理）
export function dilate(m, w, h, r) {
  const tmp = new Uint8Array(w * h),
    out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) {
      if (m[y * w + x]) last = x;
      if (x - last <= r) tmp[y * w + x] = 1;
    }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (m[y * w + x]) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      if (y - last <= r) out[y * w + x] = 1;
    }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

// 4 近傍の連結成分。lab は画素ごとの成分番号（1 から）、comps は成分ごとの画素数と外接矩形
export function components(m, w, h) {
  const lab = new Int32Array(w * h),
    comps = [],
    st = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue;
    const id = comps.length + 1;
    let n = 0,
      x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0,
      border = false;
    st.push(i);
    lab[i] = id;
    while (st.length) {
      const p = st.pop(),
        x = p % w,
        y = (p / w) | 0;
      n++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
        if (m[q] && !lab[q]) {
          lab[q] = id;
          st.push(q);
        }
      }
    }
    comps.push({ id, n, x0, y0, x1, y1, border, bw: x1 - x0 + 1, bh: y1 - y0 + 1 });
  }
  return { lab, comps };
}

// 左上の画素から、壁（wall が 1 の画素）を通らずに 4 近傍でたどれる「外側」を 1 にして返す
export function floodOutside(wall, w, h) {
  const out = new Uint8Array(w * h),
    st = [0];
  out[0] = 1;
  while (st.length) {
    const p = st.pop(),
      x = p % w;
    for (const q of [p - 1, p + 1, p - w, p + w]) {
      if (q < 0 || q >= w * h) continue;
      if ((q === p - 1 && x === 0) || (q === p + 1 && x === w - 1)) continue;
      if (!wall[q] && !out[q]) {
        out[q] = 1;
        st.push(q);
      }
    }
  }
  return out;
}
