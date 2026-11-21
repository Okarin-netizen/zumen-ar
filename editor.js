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
    setTool(t) { this.tool = t; this.render(); }
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
      this.views[s.v] = segs.filter(g => distToSeg(s.fi, s.fj, g) > 0.45);
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
      const { a, b } = d;
      if (a.i !== b.i || a.j !== b.j) {
        this._push();
        const segs = this.views[a.v];
        const same = segs.findIndex(g => (g.x1 === a.i && g.y1 === a.j && g.x2 === b.i && g.y2 === b.j) || (g.x1 === b.i && g.y1 === b.j && g.x2 === a.i && g.y2 === a.j));
        if (same >= 0) segs.splice(same, 1);
        segs.push({ x1: a.i, y1: a.j, x2: b.i, y2: b.j, t: this.tool === 'hidden' ? 'hidden' : 'solid' });
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
          line(ctx, X(x0 + g.x1 * u), Y(y0 + g.y1 * u), X(x0 + g.x2 * u), Y(y0 + g.y2 * u)); ctx.restore();
        }
      }
      if (this.drag && !this.drag.erase) {
        const { a, b } = this.drag, [x0, y0] = R[a.v];
        ctx.save(); ctx.strokeStyle = '#2f6fde'; ctx.lineWidth = lw; ctx.lineCap = 'round'; if (this.tool === 'hidden') ctx.setLineDash([1.8 * k, 1.2 * k]);
        line(ctx, X(x0 + a.i * u), Y(y0 + a.j * u), X(x0 + b.i * u), Y(y0 + b.j * u)); ctx.restore();
      }
      if (h) {
        const [x0, y0] = R[h.v]; ctx.fillStyle = this.tool === 'erase' ? 'rgba(224,85,58,.35)' : '#2f6fde';
        ctx.beginPath(); ctx.arc(X(x0 + h.i * u), Y(y0 + h.j * u), this.tool === 'erase' ? 0.45 * u * k : Math.max(3, 0.5 * k), 0, Math.PI * 2); ctx.fill();
      }
    }

    // 各図の線から、輪郭の内側を塗ったシルエット（半マス単位）を作る
    toSilhouettes() {
      const out = {}, K = 8;
      for (const v of VIEWS) {
        const [nw, nh] = this.size[v], pad = 2, W = nw * K + pad * 2 + 1, H = nh * K + pad * 2 + 1;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.strokeStyle = '#000'; x.lineWidth = 2; x.lineCap = 'round';
        for (const g of this.views[v]) line(x, pad + g.x1 * K, pad + g.y1 * K, pad + g.x2 * K, pad + g.y2 * K);
        const d = x.getImageData(0, 0, W, H).data, on = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) on[i] = d[i * 4] < 128 ? 1 : 0;
        const outside = new Uint8Array(W * H), st = [0]; outside[0] = 1;
        while (st.length) { const p = st.pop(), px = p % W;
          for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= W * H) continue; if ((q === p - 1 && px === 0) || (q === p + 1 && px === W - 1)) continue; if (!on[q] && !outside[q]) { outside[q] = 1; st.push(q); } } }
        let i0 = nw, j0 = nh, i1 = -1, j1 = -1; const cell = new Uint8Array(nw * nh);
        for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
          const p = (pad + Math.round((j + 0.5) * K)) * W + pad + Math.round((i + 0.5) * K);
          if (!outside[p]) { cell[j * nw + i] = 1; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
        }
        if (i1 < 0) throw new Error(NAMES[v] + 'の輪郭が閉じていません。線がつながっているか確かめてください。');
        const w = i1 - i0 + 1, hh = j1 - j0 + 1, s = new Uint8Array(w * hh);
        for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) s[j * w + i] = cell[(j + j0) * nw + i + i0];
        out[v] = { s, W: w, H: hh };
      }
      return out;
    }
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
