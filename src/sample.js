// 見本の図面: L字ブロック（手描き風のゆらぎ付き）。普通の紙に描いた図面として読みこむ
export function sampleDrawing() {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 900;
  const x = c.getContext('2d');
  x.fillStyle = '#fbfaf6';
  x.fillRect(0, 0, 1200, 900);
  x.strokeStyle = '#222';
  x.lineWidth = 4;
  x.lineCap = 'round';
  const L = (pts, dash) => {
    x.setLineDash(dash ? [14, 10] : []);
    x.beginPath();
    pts.forEach(([a, b], i) => {
      const j = () => (Math.random() - 0.5) * 3;
      i ? x.lineTo(a + j(), b + j()) : x.moveTo(a + j(), b + j());
    });
    x.stroke();
  };
  // 寸法: 幅240 高さ200 奥行160。左半分(幅120)だけ高さ200、右半分は高さ80
  const fx = 150,
    fy = 450; // 正面図 左上
  L([
    [fx, fy],
    [fx + 120, fy],
    [fx + 120, fy + 120],
    [fx + 240, fy + 120],
    [fx + 240, fy + 200],
    [fx, fy + 200],
    [fx, fy],
  ]);
  const ty = 200; // 平面図 左上（高さ160）
  L([
    [fx, ty],
    [fx + 240, ty],
    [fx + 240, ty + 160],
    [fx, ty + 160],
    [fx, ty],
  ]);
  L([
    [fx + 120, ty],
    [fx + 120, ty + 160],
  ]);
  const sx = 500; // 右側面図 左上（幅160）
  L([
    [sx, fy],
    [sx + 160, fy],
    [sx + 160, fy + 200],
    [sx, fy + 200],
    [sx, fy],
  ]);
  L([
    [sx, fy + 120],
    [sx + 160, fy + 120],
  ]);
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = c.toDataURL();
  });
}
