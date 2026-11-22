// ファイルの保存と印刷
import { Sheet } from './sheet.js';

// Blob をファイルとして保存する（Claude の Artifact 内では downloads 機能を使う）
export async function saveBlob(blob, filename) {
  try {
    const dl = window.claude?.use ? await window.claude.use('downloads') : null;
    if (dl) {
      await dl.save({ filename, data: blob });
      return;
    }
  } catch (e) {
    if (e && e.code !== 'unavailable') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// 用紙を 200dpi の PNG にする（マーカー画像は埋め込む）
export async function sheetPng(paperIdx, pitch, density) {
  const [paper, W, H] = Sheet.PAPERS[paperIdx];
  const mk = await fetch('ardata/oka-marker.png').then(r => r.blob());
  const mkUrl = await new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(mk);
  });
  const svg = Sheet.svg(paperIdx, pitch, mkUrl, density);
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const k = 200 / 25.4,
    c = document.createElement('canvas');
  c.width = Math.round(W * k);
  c.height = Math.round(H * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, 'image/png'));
  return { blob, filename: `作図用紙_${paper}_${pitch}mm.png` };
}

// body に cls を付けて印刷する（印刷用の CSS が cls ごとに印刷する部分を決める）。
// 印刷が終わったら外す。CSS は @media print の中だけなので、付いたままでも画面には影響しない。
// （以前は 1 秒後にも外していたが、印刷が非同期のスマホ・タブレットでは印刷前に外れてしまうことがあった）
const PRINT_CLASSES = ['print-sheet', 'print-marker'];
export function printAs(cls) {
  document.body.classList.remove(...PRINT_CLASSES);
  document.body.classList.add(cls);
  window.addEventListener('afterprint', () => document.body.classList.remove(cls), { once: true });
  window.print();
}
