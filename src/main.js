// 画面の動き（ボタン・入力と、読み取り → 立体化 → 表示 の流れ）。
// 計算そのものは各モジュールにある:
//   sheet.js 用紙 / sheet-reader.js 作図用紙の読み取り / silhouette.js 普通の紙の読み取り
//   editor.js 編集画面 / reconstruct.js 立体化 / marker-ar.js マーカーAR
import { Sheet } from './sheet.js';
import { DrawingEditor, outlineFromCells } from './editor.js';
import { adaptiveInk, loadToGray } from './image.js';
import { findViews, freehandView, sampleGrid, silhouette } from './silhouette.js';
import { readSheet } from './sheet-reader.js';
import { dimensionWarnings, reconstruct, sizeText } from './reconstruct.js';
import { drawMask, drawOverlay, drawPolys } from './preview.js';
import { startMarkerAR, stopMarkerAR } from './marker-ar.js';
import { sampleDrawing } from './sample.js';
import { printAs, saveBlob, sheetPng } from './save.js';

const $ = id => document.getElementById(id);
let srcImg = null,
  lastGlb = null;

// ---------- 1. 用紙を出す ----------
for (let p = Sheet.PITCH_MIN; p <= Sheet.PITCH_MAX; p++)
  $('sheetPitch').insertAdjacentHTML('beforeend', `<option value="${p}"${p === 5 ? ' selected' : ''}>${p}mm</option>`);
const sheetSettings = () => ({
  paperIdx: +$('sheetPaper').value,
  pitch: +$('sheetPitch').value,
  density: $('sheetDensity').value,
});
const currentLayout = () => {
  const { paperIdx, pitch } = sheetSettings();
  return Sheet.layout(Sheet.encode(paperIdx, pitch));
};

function renderSheet() {
  const { paperIdx, pitch, density } = sheetSettings(),
    [, W, H] = Sheet.PAPERS[paperIdx];
  $('sheetSvgWrap').innerHTML = Sheet.svg(paperIdx, pitch, 'ardata/oka-marker.png', density);
  // 用紙の大きさに合わせた印刷設定
  let st = $('pageSize');
  if (!st) {
    st = document.createElement('style');
    st.id = 'pageSize';
    document.head.appendChild(st);
  }
  st.textContent = `@page{size:${W}mm ${H}mm;margin:0}@media print{body.print-sheet,body.print-sheet main,body.print-sheet #stepSheet,body.print-sheet #sheetSvgWrap{margin:0!important;padding:0!important;width:${W}mm;height:${H}mm;overflow:hidden}body.print-sheet #sheetSvgWrap svg{width:${W}mm!important;height:${H}mm!important}body.print-sheet #arView{display:none!important}}`;
}
const currentSheetPng = () => {
  const { paperIdx, pitch, density } = sheetSettings();
  return sheetPng(paperIdx, pitch, density);
};
$('sheetPaper').onchange = renderSheet;
$('sheetPitch').onchange = renderSheet;
$('sheetDensity').onchange = renderSheet;
renderSheet();
$('printSheet').onclick = () => printAs('print-sheet');
$('pngSheet').onclick = async () => {
  const { blob, filename } = await currentSheetPng();
  await saveBlob(blob, filename);
};

// ---------- 2. 図面を読みこむ ----------
function loadFile(f) {
  if (!f) return;
  const img = new Image(),
    url = URL.createObjectURL(f);
  img.onload = () => {
    URL.revokeObjectURL(url);
    srcImg = img;
    run();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    $('stepDetect').hidden = false;
    $('detectStatus').textContent = 'この画像は読みこめませんでした。JPEG か PNG の画像を選んでください。';
  };
  img.src = url;
}
// 同じファイルをもう一度選んでも読みこめるように、選んだあとは空にする
const onPick = e => {
  loadFile(e.target.files[0]);
  e.target.value = '';
};
$('cam').onchange = onPick;
$('file').onchange = onPick;
document.addEventListener('paste', e => {
  const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (it) loadFile(it.getAsFile());
});
$('sample').onclick = async () => {
  srcImg = await sampleDrawing();
  run();
};
$('thr').onchange = run;
$('res').onchange = run;

// 写真を読み取って立体にする。作図用紙なら方眼に合わせて、そうでなければ図の配置から読み取る
async function run() {
  if (!srcImg) return;
  const ds = $('detectStatus');
  $('stepDetect').hidden = false;
  ds.textContent = '解析中…';
  try {
    const sheet = readSheet(loadToGray(srcImg, 2000), Math.max(30, +$('thr').value));
    if (sheet) return await runSheet(sheet);
    await runFreehand();
  } catch (e) {
    ds.textContent = e.message;
    window.__result = { ok: false, error: e.message };
  }
}

async function runSheet(sheet) {
  loadEditorFromSheet(sheet.L, sheet.W, sheet.segs); // 図が見つからない枠があっても、拾えた線は編集画面に出す
  if (sheet.errors.length)
    throw new Error(sheet.errors.join(' ') + ' 下の「図面を直す」で線を足してから立体にできます。');
  const { F, T, S, W } = sheet;
  drawOverlay(
    $('overlay'),
    new ImageData(W.rgbOut, W.OW, W.OH),
    [
      [...F.box, '--front'],
      [...T.box, '--top'],
      [...S.box, '--side'],
    ],
    { lineWidth: 4 },
  );
  await finish(F, T, S, { sheet, unitMm: sheet.L.pitch / 2, views: sheet.views });
}

async function runFreehand() {
  const { g, w, h, canvas } = loadToGray(srcImg);
  const ink = adaptiveInk(g, w, h, +$('thr').value);
  const v = findViews(ink, w, h);
  drawOverlay(
    $('overlay'),
    canvas,
    [
      [v.front, '--front', '正面'],
      [v.top, '--top', '平面'],
      [v.side, '--side', '側面'],
    ].map(([c, col, name]) => [c.x0, c.y0, c.bw, c.bh, col, name]),
    { lineWidth: Math.max(3, w / 300), font: `bold ${Math.round(w / 40)}px sans-serif` },
  );
  const F = silhouette(v.front, v.lab, v.dm, w, v.r),
    T = silhouette(v.top, v.lab, v.dm, w, v.r),
    S = silhouette(v.side, v.lab, v.dm, w, v.r);
  loadEditorFromSilhouettes(F, T, S);
  await finish(F, T, S, { views: { front: freehandView(F), top: freehandView(T), side: freehandView(S) } });
}

// ---------- 3. 立体にする ----------
// opt: { sheet, unitMm（半マスの mm。作図用紙・編集画面のとき）, views, label, statusEl, source }
async function finish(F, T, S, opt = {}) {
  const { sheet, unitMm: unit } = opt;
  drawMask($('vFront'), F);
  drawMask($('vTop'), T);
  drawMask($('vSide'), S);
  const warn = dimensionWarnings(F, T, S, unit);
  const head = opt.label || (sheet ? `作図用紙（${sheet.L.paper}・方眼${sheet.L.pitch}mm）として読み取りました。` : '');
  (opt.statusEl || $('detectStatus')).textContent =
    head + (warn.length ? '注意: ' + warn.join('、') + '。平均をとって復元します。' : '三面図の寸法はそろっています。');

  const { C, solid, glb } = await reconstruct(F, T, S, { views: opt.views, unit, res: +$('res').value });
  if (solid) {
    drawPolys($('vFront'), solid.polys.F);
    drawPolys($('vTop'), solid.polys.T);
    drawPolys($('vSide'), solid.polys.S);
  }
  lastGlb = glb;
  const mv = $('mv');
  if (mv.src) URL.revokeObjectURL(mv.src);
  mv.src = URL.createObjectURL(lastGlb);
  $('stepModel').hidden = false;
  $('modelStatus').textContent = sizeText(C, solid, unit);

  const r1 = v => Math.round(v * 10) / 10;
  window.__result = {
    nx: C.nx,
    ny: C.ny,
    nz: C.nz,
    count: C.count,
    warn,
    ok: true,
    sheet: sheet ? { paper: sheet.L.paper, pitch: sheet.L.pitch, code: sheet.code } : null,
    source: opt.source || 'scan',
    solid: solid
      ? { x: r1(solid.size.x), y: r1(solid.size.y), z: r1(solid.size.z), volume: Math.round(solid.volume) }
      : null,
  };
}

$('arBtn').onclick = () => {
  const mv = $('mv');
  if (mv.canActivateAR) mv.activateAR();
  else
    $('modelStatus').textContent =
      'この端末ではARが使えません。iPad/iPhone の Safari か、Android の Chrome で開いてください。';
};
$('spin').onclick = () => {
  const mv = $('mv'),
    on = !mv.hasAttribute('auto-rotate');
  mv.toggleAttribute('auto-rotate', on);
  $('spin').classList.toggle('primary', on);
};
$('dl').onclick = () => lastGlb && saveBlob(lastGlb, 'zumen.glb');

// ---------- 図面の編集画面 ----------
const editor = new DrawingEditor($('editCanvas'), {
  onChange: () => {
    $('editStatus').textContent = '';
  },
});
editor.setLayout(currentLayout());

// 作図用紙の写真から: 補正した写真を下に敷き、読み取った線を出す
function loadEditorFromSheet(L, W, segs) {
  const bg = document.createElement('canvas');
  bg.width = W.OW;
  bg.height = W.OH;
  bg.getContext('2d').putImageData(new ImageData(W.rgbOut, W.OW, W.OH), 0, 0);
  editor.setLayout(L, bg);
  editor.setSegments(segs);
}
// 作図用紙でない画像のとき: 読み取った輪郭を半マス単位に直して、いまの用紙設定の枠に置く
function loadEditorFromSilhouettes(F, T, S) {
  const L = currentLayout(),
    X = (F.W + T.W) / 2,
    Y = (F.H + S.H) / 2,
    Z = (T.H + S.W) / 2,
    u = Math.max(X, Y, Z) / 16;
  const nx = Math.max(1, Math.round(X / u)),
    ny = Math.max(1, Math.round(Y / u)),
    nz = Math.max(1, Math.round(Z / u));
  const g = (sil, a, b) => ({ s: sampleGrid(sil, a, b), W: a, H: b });
  editor.setLayout(L, null);
  editor.setSegments({
    front: outlineFromCells(g(F, nx, ny), 2, 2),
    top: outlineFromCells(g(T, nx, nz), 2, 2),
    side: outlineFromCells(g(S, nz, ny), 2, 2),
  });
}

document.querySelectorAll('#editTools [data-tool]').forEach(
  b =>
    (b.onclick = () => {
      editor.setTool(b.dataset.tool);
      document.querySelectorAll('#editTools [data-tool]').forEach(x => x.classList.toggle('primary', x === b));
    }),
);
$('editUndo').onclick = () => editor.undo();
$('editClear').onclick = () => {
  editor.setLayout(currentLayout(), null);
  editor.clear();
};
$('editBg').onchange = e => {
  editor.showBg = e.target.checked;
  editor.render();
};
$('editBuild').onclick = async () => {
  const st = $('editStatus');
  try {
    const v = editor.toSilhouettes();
    await finish(v.front, v.top, v.side, {
      views: { front: v.front.view, top: v.top.view, side: v.side.view },
      unitMm: editor.u,
      label: '編集した図面から立体を作りました。',
      statusEl: st,
      source: 'editor',
    });
    $('stepModel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    st.textContent = e.message;
    window.__result = { ok: false, error: e.message, source: 'editor' };
  }
};

// ---------- マーカーAR ----------
$('markerBtn').onclick = () => lastGlb && startMarkerAR(lastGlb);
$('arClose').onclick = stopMarkerAR;
$('printMarker').onclick = () => printAs('print-marker');

// 動作確認用（自動テストから使う）
window.__editor = editor;
window.__sheet = { renderSheet, sheetPng: currentSheetPng };
window.__debug = { run };
