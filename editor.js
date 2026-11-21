// 三面図の編集画面（第三角法の配置の方眼に、実線・かくれ線を引く／消す）
// 線は各図の枠の左上を原点とした「半マス」単位の格子点どうしを結ぶ線分として持つ。
(function (global) {
  const VIEWS = ['top', 'front', 'side'];
  const NAMES = { top: '平面図', front: '正面図', side: '右側面図' };

  class DrawingEditor {
    constructor(canvas, opts = {}) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.onChange = opts.onChange || (() => {});
      this.tool = 'solid'; this.showBg = true; this.bg = null;
      this.views = { top: [], front: [], side: [] };
      this.undoStack = []; this.drag = null; this.hover = null;
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointerdown', e => this._down(e));
      canvas.addEventListener('pointermove', e => this._move(e));
      canvas.addEventListener('pointerup', e => this._up(e));
      canvas.addEventListener('pointercancel', () => { this.drag = null; this.render(); });
      canvas.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.render(); } });
      new ResizeObserver(() => this.render()).observe(canvas);
    }

    // L は Sheet.layout() の結果。bg は用紙を真上から見た画像（A4基準 297×210mm に対応する canvas）
    setLayout(L, bg = null) {
      this.L = L; this.u = L.pitch / 2; this.bg = bg;
      const R = L.regions, m = 3;
      this.box = [R.top[0] - m, R.top[1] - 2 * m, R.side[2] + m, R.front[3] + m]; // 表示範囲（mm）
      this.size = {}; for (const v of VIEWS) { const [x0, y0, x1, y1] = R[v]; this.size[v] = [Math.round((x1 - x0) / this.u), Math.round((y1 - y0) / this.u)]; }
      this.render();
    }

    setSegments(views) { this._push(); this.views = { top: [], front: [], side: [], ...views }; this.render(); this.onChange(); }
    clear() { this._push(); this.views = { top: [], front: [], side: [] }; this.render(); this.onChange(); }
    undo() { if (!this.undoStack.length) return; this.views = JSON.parse(this.undoStack.pop()); this.render(); this.onChange(); }
    setTool(t) { this.tool = t; this.arcPending = null; if (t === 'solid' || t === 'hidden') this.lineType = t; this.render(); }
    get lineType() { return this._lt || 'solid'; }
    set lineType(v) { this._lt = v; }
    segmentCount() { return VIEWS.reduce((a, v) => a + this.views[v].length, 0); }
    _push() { this.undoStack.push(JSON.stringify(this.views)); if (this.undoStack.length > 100) this.undoStack.shift(); }

    // 画面座標 → mm
    _mm(e) {
      const r = this.cv.getBoundingClientRect(), [bx0, by0, bx1, by1] = this.box;
      return [bx0 + (e.clientX - r.left) / r.width * (bx1 - bx0), by0 + (e.clientY - r.top) / r.height * (by1 - by0)];
    }
    // mm → いちばん近い図の格子点
    _snap([x, y], view = null) {
      const R = this.L.regions, u = this.u;
      const cands = view ? [view] : VIEWS.filter(v => { const [x0, y0, x1, y1] = R[v]; return x >= x0 - u && x <= x1 + u && y >= y0 - u && y <= y1 + u; });
      if (!cands.length) return null;
      const v = cands[0], [x0, y0] = R[v], [nw, nh] = this.size[v];
      return { v, i: Math.max(0, Math.min(nw, Math.round((x - x0) / u))), j: Math.max(0, Math.min(nh, Math.round((y - y0) / u))) };
    }
    _eraseAt(p) {
      const s = this._snapRaw(p); if (!s) return false;
      const segs = this.views[s.v], before = segs.length;
      this.views[s.v] = segs.filter(g => distToItem(s.fi, s.fj, g) > 0.45);
      return this.views[s.v].length !== before;
    }
    _snapRaw([x, y]) { // 消しゴム用：格子点に丸めない
      const n = this._snap([x, y]); if (!n) return null;
      const [x0, y0] = this.L.regions[n.v]; return { v: n.v, fi: (x - x0) / this.u, fj: (y - y0) / this.u };
    }

    _down(e) {
      if (!this.L) return; this.cv.setPointerCapture(e.pointerId);
      const p = this._mm(e);
      if (this.tool === 'erase') { this._push(); this.drag = { erase: true, changed: this._eraseAt(p) }; this.render(); return; }
      if (this.tool === 'arc' && this.arcPending) { // 円弧の3点目（終わりの向き）
        const q = this._snap(p, this.arcPending.v), A = this.arcPending;
        if (q && (q.i !== A.c.i || q.j !== A.c.j)) {
          const a0 = Math.atan2(A.s.j - A.c.j, A.s.i - A.c.i), a1 = Math.atan2(q.j - A.c.j, q.i - A.c.i);
          let sweep = a1 - a0; while (sweep <= -Math.PI) sweep += 2 * Math.PI; while (sweep > Math.PI) sweep -= 2 * Math.PI;
          if (Math.abs(sweep) > 1e-6) { this._push(); this.views[A.v].push({ k: 'arc', cx: A.c.i, cy: A.c.j, r: Math.hypot(A.s.i - A.c.i, A.s.j - A.c.j), a0, sweep, t: A.t }); this.onChange(); }
        }
        this.arcPending = null; this.render(); return;
      }
      const a = this._snap(p); if (!a) return;
      this.drag = { a, b: a };
      this.render();
    }
    _move(e) {
      if (!this.L) return;
      const p = this._mm(e);
      if (this.drag?.erase) { if (this._eraseAt(p)) this.drag.changed = true; this.hover = this._snap(p); this.render(); return; }
      if (this.drag) { const b = this._snap(p, this.drag.a.v); if (b) this.drag.b = b; }
      this.hover = this._snap(p); this.render();
    }
    _up() {
      const d = this.drag; this.drag = null;
      if (!d) return;
      if (d.erase) { if (!d.changed) this.undoStack.pop(); else this.onChange(); this.render(); return; }
      const { a, b } = d, t = this.lineType;
      if ((this.tool === 'circle' || this.tool === 'arc') && (a.i !== b.i || a.j !== b.j)) {
        if (this.tool === 'circle') { this._push(); this.views[a.v].push({ k: 'circle', cx: a.i, cy: a.j, r: Math.hypot(b.i - a.i, b.j - a.j), t }); this.onChange(); }
        else this.arcPending = { v: a.v, c: a, s: b, t };
        this.render(); return;
      }
      if (a.i !== b.i || a.j !== b.j) {
        this._push();
        const segs = this.views[a.v];
        const same = segs.findIndex(g => (g.x1 === a.i && g.y1 === a.j && g.x2 === b.i && g.y2 === b.j) || (g.x1 === b.i && g.y1 === b.j && g.x2 === a.i && g.y2 === a.j));
        if (same >= 0) segs.splice(same, 1);
        segs.push({ x1: a.i, y1: a.j, x2: b.i, y2: b.j, t });
        this.onChange();
      }
      this.render();
    }

    render() {
      if (!this.L) return;
      const cv = this.cv, dpr = window.devicePixelRatio || 1, [bx0, by0, bx1, by1] = this.box;
      const cssW = cv.clientWidth || 600, cssH = cssW * (by1 - by0) / (bx1 - bx0);
      cv.style.height = cssH + 'px';
      if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); }
      const k = cv.width / (bx1 - bx0), ctx = this.ctx, X = x => (x - bx0) * k, Y = y => (y - by0) * k;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      if (this.bg && this.showBg) { // 写真（A4基準の補正画像）を実寸に合わせて薄く敷く
        ctx.globalAlpha = 0.35; const s = this.L.s;
        ctx.drawImage(this.bg, X(0), Y(0), 297 * s * k, 210 * s * k); ctx.globalAlpha = 1;
      }
      const R = this.L.regions, u = this.u;
      for (const v of VIEWS) {
        const [x0, y0, x1, y1] = R[v], [nw, nh] = this.size[v];
        for (let i = 0; i <= nw; i++) { ctx.strokeStyle = i % 2 ? '#fbe3e3' : '#f1b3b3'; ctx.lineWidth = 1; line(ctx, X(x0 + i * u), Y(y0), X(x0 + i * u), Y(y1)); }
        for (let j = 0; j <= nh; j++) { ctx.strokeStyle = j % 2 ? '#fbe3e3' : '#f1b3b3'; ctx.lineWidth = 1; line(ctx, X(x0), Y(y0 + j * u), X(x1), Y(y0 + j * u)); }
        ctx.strokeStyle = '#e07272'; ctx.lineWidth = 1.5; ctx.strokeRect(X(x0), Y(y0), (x1 - x0) * k, (y1 - y0) * k);
        ctx.fillStyle = '#d06060'; ctx.font = `${Math.max(11, 3.2 * k)}px sans-serif`; ctx.fillText(NAMES[v], X(x0) + 4, Y(y0) - 4);
      }
      // 投影の補助線（第三角法では平面図と正面図は縦に、正面図と右側面図は横にそろう）
      const h = this.drag?.b || this.hover;
      if (h && this.tool !== 'erase') {
        const [x0, y0] = R[h.v], hx = X(x0 + h.i * u), hy = Y(y0 + h.j * u);
        ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(47,111,222,.55)'; ctx.lineWidth = 1;
        if (h.v !== 'side') line(ctx, hx, Y(R.top[1]), hx, Y(R.front[3]));
        if (h.v !== 'top') line(ctx, X(R.front[0]), hy, X(R.side[2]), hy);
        ctx.restore();
      }
      const lw = Math.max(2, 0.55 * k);
      for (const v of VIEWS) {
        const [x0, y0] = R[v];
        for (const g of this.views[v]) {
          ctx.save(); ctx.strokeStyle = '#1d1d1b'; ctx.lineWidth = g.t === 'hidden' ? lw * 0.8 : lw; ctx.lineCap = 'round';
          if (g.t === 'hidden') ctx.setLineDash([1.8 * k, 1.2 * k]);
          drawItem(ctx, g, X(x0), Y(y0), u * k); ctx.restore();
        }
      }
      if (this.drag && !this.drag.erase) {
        const { a, b } = this.drag, [x0, y0] = R[a.v];
        ctx.save(); ctx.strokeStyle = '#2f6fde'; ctx.lineWidth = lw; ctx.lineCap = 'round'; if (this.lineType === 'hidden') ctx.setLineDash([1.8 * k, 1.2 * k]);
        const r = Math.hypot(b.i - a.i, b.j - a.j);
        if (this.tool === 'circle') drawItem(ctx, { k: 'circle', cx: a.i, cy: a.j, r }, X(x0), Y(y0), u * k);
        else line(ctx, X(x0 + a.i * u), Y(y0 + a.j * u), X(x0 + b.i * u), Y(y0 + b.j * u));
        if (this.tool === 'circle' || this.tool === 'arc') { ctx.fillStyle = '#2f6fde'; ctx.beginPath(); ctx.arc(X(x0 + a.i * u), Y(y0 + a.j * u), 3, 0, 7); ctx.fill(); }
        ctx.restore();
      }
      if (this.arcPending) { // 円弧: 中心と始点が決まったあと、終わりの向きをプレビュー
        const A = this.arcPending, [x0, y0] = R[A.v], q = this.hover && this.hover.v === A.v ? this.hover : A.s;
        const a0 = Math.atan2(A.s.j - A.c.j, A.s.i - A.c.i), a1 = Math.atan2(q.j - A.c.j, q.i - A.c.i);
        let sweep = a1 - a0; while (sweep <= -Math.PI) sweep += 2 * Math.PI; while (sweep > Math.PI) sweep -= 2 * Math.PI;
        ctx.save(); ctx.strokeStyle = '#2f6fde'; ctx.lineWidth = lw;
        drawItem(ctx, { k: 'arc', cx: A.c.i, cy: A.c.j, r: Math.hypot(A.s.i - A.c.i, A.s.j - A.c.j), a0, sweep }, X(x0), Y(y0), u * k);
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1; line(ctx, X(x0 + A.c.i * u), Y(y0 + A.c.j * u), X(x0 + q.i * u), Y(y0 + q.j * u)); ctx.restore();
      }
      if (h) {
        const [x0, y0] = R[h.v]; ctx.fillStyle = this.tool === 'erase' ? 'rgba(224,85,58,.35)' : '#2f6fde';
        ctx.beginPath(); ctx.arc(X(x0 + h.i * u), Y(y0 + h.j * u), this.tool === 'erase' ? 0.45 * u * k : Math.max(3, 0.5 * k), 0, Math.PI * 2); ctx.fill();
      }
    }

    // 図の線を塗りつぶし用に描き、外側を塗って内側を求める
    _raster(v, K) {
      const [nw, nh] = this.size[v], pad = 2, W = nw * K + pad * 2 + 1, H = nh * K + pad * 2 + 1;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.strokeStyle = '#000'; x.lineWidth = 2; x.lineCap = 'round';
      for (const g of this.views[v]) drawItem(x, g, pad, pad, K);
      const d = x.getImageData(0, 0, W, H).data, on = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) on[i] = d[i * 4] < 128 ? 1 : 0;
      const outside = new Uint8Array(W * H), st = [0]; outside[0] = 1;
      while (st.length) { const p = st.pop(), px = p % W;
        for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= W * H) continue; if ((q === p - 1 && px === 0) || (q === p + 1 && px === W - 1)) continue; if (!on[q] && !outside[q]) { outside[q] = 1; st.push(q); } } }
      return { outside, W, H, pad, nw, nh };
    }

    // 各図の線から、輪郭の内側を塗ったシルエット（半マス単位のセル）と、なめらかな立体用のマスクを作る
    toSilhouettes() {
      const out = {}, K = 16;
      for (const v of VIEWS) {
        const { outside, W, H, pad, nw, nh } = this._raster(v, K);
        let i0 = nw, j0 = nh, i1 = -1, j1 = -1; const cell = new Uint8Array(nw * nh);
        for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
          const p = (pad + Math.round((j + 0.5) * K)) * W + pad + Math.round((i + 0.5) * K);
          if (!outside[p]) { cell[j * nw + i] = 1; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
        }
        const mask = new Uint8Array(W * H); let any = false; for (let i = 0; i < W * H; i++) if (!outside[i]) { mask[i] = 1; any = true; }
        if (i1 < 0 && !any) throw new Error(NAMES[v] + 'の輪郭が閉じていません。線がつながっているか確かめてください。');
        if (i1 < 0) { i0 = j0 = 0; i1 = j1 = 0; }
        const w = i1 - i0 + 1, hh = j1 - j0 + 1, s = new Uint8Array(w * hh);
        for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) s[j * w + i] = cell[(j + j0) * nw + i + i0];
        const [rx, ry] = this.L.regions[v], ppm = K / this.u;
        // 画面でかいた線は正確なので方眼への合わせこみはせず、線の太さ（1px）だけ内側へ
        out[v] = { s, W: w, H: hh, view: { mask, w: W, h: H, pxPerMm: ppm, x0: rx - pad / ppm, y0: ry - pad / ppm, erodePx: 1, tolMm: 1.2 / ppm, snap: null } };
      }
      return out;
    }
  }

  // 線・円・円弧を描く（ox, oy: 図の原点の画面座標、k: 半マスの画面上の長さ）
  function drawItem(ctx, g, ox, oy, k) {
    ctx.beginPath();
    if (g.k === 'circle') ctx.arc(ox + g.cx * k, oy + g.cy * k, g.r * k, 0, Math.PI * 2);
    else if (g.k === 'arc') ctx.arc(ox + g.cx * k, oy + g.cy * k, g.r * k, g.a0, g.a0 + g.sweep, g.sweep < 0);
    else { ctx.moveTo(ox + g.x1 * k, oy + g.y1 * k); ctx.lineTo(ox + g.x2 * k, oy + g.y2 * k); }
    ctx.stroke();
  }
  function distToItem(px, py, g) {
    if (g.k === 'circle') return Math.abs(Math.hypot(px - g.cx, py - g.cy) - g.r);
    if (g.k === 'arc') {
      let a = Math.atan2(py - g.cy, px - g.cx) - g.a0; const s = Math.sign(g.sweep) || 1; a *= s;
      while (a < 0) a += 2 * Math.PI; while (a >= 2 * Math.PI) a -= 2 * Math.PI;
      if (a <= Math.abs(g.sweep)) return Math.abs(Math.hypot(px - g.cx, py - g.cy) - g.r);
      const e = (ang) => Math.hypot(px - g.cx - g.r * Math.cos(ang), py - g.cy - g.r * Math.sin(ang));
      return Math.min(e(g.a0), e(g.a0 + g.sweep));
    }
    return distToSeg(px, py, g);
  }
  function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  function distToSeg(px, py, g) {
    const dx = g.x2 - g.x1, dy = g.y2 - g.y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - g.x1) * dx + (py - g.y1) * dy) / l2)) : 0;
    return Math.hypot(px - g.x1 - t * dx, py - g.y1 - t * dy);
  }

  // 塗ったセル（半マス）の境界から輪郭線を作る（同じ向きに続く辺はまとめる）
  function outlineFromCells(sil, ox, oy) {
    const { s, W, H } = sil, at = (i, j) => !!(i >= 0 && j >= 0 && i < W && j < H && s[j * W + i]);
    const hs = new Set(), vs = new Set(), segs = [];
    for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) if (at(i, j) !== at(i, j - 1)) hs.add(i + ',' + j);
    for (let i = 0; i <= W; i++) for (let j = 0; j < H; j++) if (at(i, j) !== at(i - 1, j)) vs.add(i + ',' + j);
    for (let j = 0; j <= H; j++) for (let i = 0; i < W; i++) if (hs.has(i + ',' + j) && !hs.has((i - 1) + ',' + j)) { let e = i; while (hs.has((e + 1) + ',' + j)) e++; segs.push({ x1: ox + i, y1: oy + j, x2: ox + e + 1, y2: oy + j, t: 'solid' }); }
    for (let i = 0; i <= W; i++) for (let j = 0; j < H; j++) if (vs.has(i + ',' + j) && !vs.has(i + ',' + (j - 1))) { let e = j; while (vs.has(i + ',' + (e + 1))) e++; segs.push({ x1: ox + i, y1: oy + j, x2: ox + i, y2: oy + e + 1, t: 'solid' }); }
    return segs;
  }

  global.DrawingEditor = DrawingEditor;
  global.outlineFromCells = outlineFromCells;
})(window);
