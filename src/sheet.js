// 第三角法 作図用紙のレイアウトと描画（SVG）。アプリの読み取りもこのレイアウトを使う。
// 座標はすべて用紙左上からの mm。A4・B4・A3 は縦横比がほぼ同じなので、A4 基準の配置を倍率 s で拡大する。
// 用紙の種類は左上マーカーの下の 6 つの小さな四角（ビット）で表す:
//   bit0-1 = 用紙（0:A4, 1:B4, 2:A3）  bit2-5 = 方眼の1マスの大きさ（mm、3〜15）
const PAPERS = [
  ['A4', 297, 210],
  ['B4', 364, 257],
  ['A3', 420, 297],
];
const PITCH_MIN = 3,
  PITCH_MAX = 15,
  NBITS = 6;
const FID_A4 = [
  [8, 8],
  [279, 8],
  [279, 192],
  [8, 192],
]; // 四隅マーカーの左上（A4基準、時計回り、左上だけ白抜き）
const FID_SIZE = 10;
const BIT_A4 = i => [11, 22 + 6 * i, 4]; // ビットの左上と一辺（A4基準）

// 方眼の線の間隔（mm）。8mm 以上のマスは半マスの補助線も引く
function gridStep(pitch) {
  return pitch >= 8 ? pitch / 2 : pitch;
}

function encode(paperIdx, pitch) {
  return (paperIdx & 3) | ((pitch & 15) << 2);
}

function layout(code) {
  const paperIdx = code & 3,
    pitch = (code >> 2) & 15;
  if (!PAPERS[paperIdx] || pitch < PITCH_MIN || pitch > PITCH_MAX) return null;
  const [paper, W, H] = PAPERS[paperIdx],
    s = W / 297;
  const fl = v => Math.floor((v * s) / pitch) * pitch;
  const left = Math.round(25 * s),
    top = Math.round(22 * s),
    gap = Math.round(5 * s);
  const w1 = fl(110),
    h1 = fl(80),
    h2 = fl(85),
    w2 = fl(105),
    fy = top + h1 + gap,
    sx = left + w1 + gap;
  return {
    code,
    paperIdx,
    paper,
    pitch,
    W,
    H,
    s,
    regions: {
      top: [left, top, left + w1, top + h1],
      front: [left, fy, left + w1, fy + h2],
      side: [sx, fy, sx + w2, fy + h2],
    },
    marker: [252 * s, 85 * s, 36 * s],
  };
}

// 方眼の線のこさ（参考: サンカク３Dメーカー）。こい＝白黒印刷で薄くなるとき用
const DENSITY = { light: ['#f4b6b6', '#fbe3e3'], normal: ['#ee9e9e', '#f8d4d4'], dark: ['#e07c7c', '#f0b0b0'] };
function svg(paperIdx, pitch, markerHref, density = 'normal') {
  const [cMajor, cMinor] = DENSITY[density] || DENSITY.normal;
  const L = layout(encode(paperIdx, pitch));
  const { W, H, s } = L,
    out = [];
  const f = v => +v.toFixed(3);
  const font = `font-family="'Hiragino Sans','Noto Sans JP','IPAGothic','Yu Gothic',sans-serif"`;
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`,
  );
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  const names = { top: '平面図', front: '正面図', side: '右側面図' };
  for (const [k, [x0, y0, x1, y1]] of Object.entries(L.regions)) {
    // 方眼はドロップアウトカラー（薄い赤。読み取りでは赤チャンネルを使うので消える）
    const step = gridStep(pitch),
      half = step !== pitch;
    for (let i = 0, v = x0; v <= x1 + 1e-6; i++, v = x0 + i * step) {
      const major = !half || i % 2 === 0;
      out.push(
        `<line x1="${f(v)}" y1="${y0}" x2="${f(v)}" y2="${y1}" stroke="${major ? cMajor : cMinor}" stroke-width="${major ? 0.3 : 0.18}"/>`,
      );
    }
    for (let i = 0, v = y0; v <= y1 + 1e-6; i++, v = y0 + i * step) {
      const major = !half || i % 2 === 0;
      out.push(
        `<line x1="${x0}" y1="${f(v)}" x2="${x1}" y2="${f(v)}" stroke="${major ? cMajor : cMinor}" stroke-width="${major ? 0.3 : 0.18}"/>`,
      );
    }
    out.push(
      `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#e07272" stroke-width="0.5"/>`,
    );
    out.push(
      `<text x="${f(x0 + 0.5 * s)}" y="${f(y0 - 1.2 * s)}" font-size="${f(3.2 * s)}" fill="#e58080" ${font}>${names[k]}</text>`,
    );
  }
  FID_A4.forEach(([x, y], i) => {
    const fs = FID_SIZE * s;
    out.push(`<rect x="${f(x * s)}" y="${f(y * s)}" width="${f(fs)}" height="${f(fs)}" fill="#000"/>`);
    if (i === 0)
      out.push(
        `<rect x="${f(x * s + fs / 4)}" y="${f(y * s + fs / 4)}" width="${f(fs / 2)}" height="${f(fs / 2)}" fill="#fff"/>`,
      );
  });
  for (let i = 0; i < NBITS; i++) {
    const [x, y, b] = BIT_A4(i),
      on = (L.code >> i) & 1;
    out.push(
      `<rect x="${f(x * s)}" y="${f(y * s)}" width="${f(b * s)}" height="${f(b * s)}" fill="${on ? '#000' : '#fff'}" stroke="#000" stroke-width="0.25"/>`,
    );
  }
  const R = L.regions,
    t = (x, y, size, str, fill = '#000', anchor = 'start') =>
      out.push(
        `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" fill="${fill}" text-anchor="${anchor}" ${font}>${str}</text>`,
      );
  t(R.top[0], 16.5 * s, 5 * s, '第三角法 作図用紙');
  t(R.top[0] + 62 * s, 16.5 * s, 3.2 * s, `${L.paper}・1マス${pitch}mm`, '#666');
  t(R.side[0] + 5 * s, 16.5 * s, 3.5 * s, '　　年　　組　　番　名前');
  out.push(
    `<line x1="${f(R.side[0] + 5 * s)}" y1="${f(18 * s)}" x2="${R.side[2]}" y2="${f(18 * s)}" stroke="#000" stroke-width="0.3"/>`,
  );
  const lines = [
    'かき方',
    '・平面図、正面図、右側面図を それぞれの枠に1つずつかく',
    '・鉛筆は濃く、線はつなげて 輪郭を閉じる',
    `・方眼の線に合わせてかくと 寸法が正確になる（1マス${pitch}mm）`,
    '・平面図と正面図の幅、正面図と右側面図の高さをそろえる',
    '・寸法や文字は 枠の外にかく',
    '',
    '撮影のしかた',
    '・用紙全体と 四隅の■がすべて写るように',
    '・影が入らない明るい場所で、真上から',
    '',
    '右のマーカーにカメラを向けると、立体がARで表示されます',
  ];
  lines.forEach((str, i) => str && t(R.side[0] + 2 * s, R.top[1] + (6 + i * 5.6) * s, 3.2 * s, str, '#404040'));
  const [mx, my, ms] = L.marker;
  out.push(
    `<image x="${f(mx)}" y="${f(my)}" width="${f(ms)}" height="${f(ms)}" href="${markerHref}" xlink:href="${markerHref}" preserveAspectRatio="none"/>`,
  );
  t(mx + ms / 2, my + ms + 5 * s, 2.8 * s, 'ARマーカー', '#555', 'middle');
  out.push('</svg>');
  return out.join('\n');
}

export const Sheet = {
  DENSITY,
  PAPERS,
  PITCH_MIN,
  PITCH_MAX,
  NBITS,
  FID_A4,
  FID_SIZE,
  BIT_A4,
  encode,
  layout,
  gridStep,
  svg,
};
