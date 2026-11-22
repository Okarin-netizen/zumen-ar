// 読み取り結果の表示（シルエット・輪郭・写真に図の範囲を重ねたもの）

// シルエット（{ s, W, H }）を白黒で描く
export function drawMask(cv, sil) {
  cv.width = sil.W;
  cv.height = sil.H;
  const ctx = cv.getContext('2d'),
    im = ctx.createImageData(sil.W, sil.H);
  for (let i = 0; i < sil.W * sil.H; i++) {
    const v = sil.s[i] ? 40 : 245;
    im.data[4 * i] = im.data[4 * i + 1] = im.data[4 * i + 2] = v;
    im.data[4 * i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
}

// 立体化に使った輪郭（多角形・円弧）を表示する
export function drawPolys(cv, groups) {
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
  const pad = 0.08 * Math.max(x1 - x0, y1 - y0),
    sc = 240 / Math.max(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
  cv.width = Math.round((x1 - x0 + 2 * pad) * sc);
  cv.height = Math.round((y1 - y0 + 2 * pad) * sc);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#f5f5f5';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.beginPath();
  const path = p => p.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo']((x - x0 + pad) * sc, (y - y0 + pad) * sc));
  for (const g of groups) {
    path(g.outer);
    ctx.closePath();
    for (const h of g.holes) {
      path(h);
      ctx.closePath();
    }
  }
  ctx.fillStyle = '#282828';
  ctx.fill('evenodd');
}

// 写真（または補正した用紙の画像）に、見つけた3つの図の範囲を色の枠で重ねる
// boxes: [[x, y, w, h, CSS変数名, ラベル（なくてもよい）], ...]
export function drawOverlay(cv, image, boxes, { lineWidth, font } = {}) {
  const css = getComputedStyle(document.documentElement);
  cv.width = image.width;
  cv.height = image.height;
  const ctx = cv.getContext('2d');
  if (image instanceof ImageData) ctx.putImageData(image, 0, 0);
  else ctx.drawImage(image, 0, 0);
  for (const [x, y, w, h, color, label] of boxes) {
    ctx.strokeStyle = css.getPropertyValue(color).trim();
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x, y, w, h);
    if (label) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = font;
      ctx.fillText(label, x, y - 6);
    }
  }
}
