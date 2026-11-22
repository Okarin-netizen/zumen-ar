// 動作確認（スモークテスト）: 見本・編集画面・作図用紙の読み取りで立体ができるかを、ブラウザを自動で動かして確かめる。
// 使い方: npm i playwright && npx playwright install chromium && node tests/smoke.js [出力フォルダ]
//   ライブラリは CDN から読む。ネットにつながらない環境では LIBS=<node_modules のある親フォルダ> で手元のものを使う。
const { chromium } = require('playwright');
const fs = require('fs'),
  path = require('path');
const repo = path.join(__dirname, '..'),
  libs = process.env.LIBS;
const outDir = process.argv[2] || require('os').tmpdir(),
  out = path.join(outDir, 'smoke.json');
const mime = f =>
  ({
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.patt': 'text/plain',
    '.dat': 'application/octet-stream',
    '.json': 'application/json',
  })[path.extname(f)] || 'application/octet-stream';

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const logs = [];
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text());
  });
  page.on('pageerror', e => logs.push('pageerror: ' + e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.host === 'app.test') {
      const f = path.join(repo, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
      if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: 'nf' });
      return route.fulfill({ body: fs.readFileSync(f), contentType: mime(f) });
    }
    let m = u.pathname.match(/^\/(?:npm\/)?((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/);
    if (!libs) return route.continue();
    if ((u.host === 'cdn.jsdelivr.net' || u.host === 'unpkg.com') && m) {
      const f = path.join(libs, 'node_modules', m[1], m[2]);
      if (!fs.existsSync(f)) {
        logs.push('missing lib ' + f);
        return route.fulfill({ status: 404, body: 'nf' });
      }
      return route.fulfill({
        body: fs.readFileSync(f),
        contentType: mime(f),
        headers: { 'access-control-allow-origin': '*' },
      });
    }
    logs.push('blocked ' + u.href);
    return route.fulfill({ status: 404, body: 'blocked' });
  });
  await page.addInitScript(() => {
    let x = 12345;
    Math.random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  });
  await page.goto('https://app.test/index.html');
  await page.waitForFunction(() => window.__editor && window.__sheet);
  const res = {};
  const waitResult = async () => {
    await page.waitForFunction(() => window.__result, null, { timeout: 60000 });
    const r = await page.evaluate(() => window.__result);
    await page.evaluate(() => {
      window.__result = null;
    });
    return r;
  };
  const snap = () =>
    page.evaluate(() => ({
      status: [...document.querySelectorAll('.status[id]')].map(e => e.id + ':' + e.textContent),
      views: window.__editor.views,
    }));

  // A. 見本
  await page.evaluate(() => {
    let x = 777;
    Math.random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  });
  await page.click('#sample');
  res.sample = await waitResult();
  res.sampleUi = await snap();
  // B. 見本の編集画面から立体
  await page.click('#editBuild');
  res.editSample = await waitResult();
  // C. 編集画面: 円柱（平面図が円）+ 斜面（正面図が台形）
  await page.evaluate(() =>
    window.__editor.setSegments({
      top: [{ k: 'circle', cx: 10, cy: 10, r: 6, t: 'solid' }],
      front: [
        { x1: 4, y1: 4, x2: 16, y2: 4, t: 'solid' },
        { x1: 16, y1: 4, x2: 16, y2: 20, t: 'solid' },
        { x1: 16, y1: 20, x2: 4, y2: 20, t: 'solid' },
        { x1: 4, y1: 20, x2: 4, y2: 4, t: 'solid' },
      ],
      side: [
        { x1: 4, y1: 4, x2: 10, y2: 4, t: 'solid' },
        { x1: 10, y1: 4, x2: 16, y2: 12, t: 'solid' },
        { x1: 16, y1: 12, x2: 16, y2: 20, t: 'solid' },
        { x1: 16, y1: 20, x2: 4, y2: 20, t: 'solid' },
        { x1: 4, y1: 20, x2: 4, y2: 4, t: 'solid' },
      ],
    }),
  );
  await page.click('#editBuild');
  res.editCustom = await waitResult();
  // D. 作図用紙を合成して読み取り（A4・5mm）
  const png = await page.evaluate(async () => {
    const { blob } = await window.__sheet.sheetPng();
    const img = await createImageBitmap(blob),
      c = document.createElement('canvas');
    c.width = img.width + 160;
    c.height = img.height + 120;
    const x = c.getContext('2d');
    x.fillStyle = '#d8d4cc';
    x.fillRect(0, 0, c.width, c.height);
    x.translate(c.width / 2, c.height / 2);
    x.rotate(0.03);
    x.translate(-img.width / 2, -img.height / 2);
    x.drawImage(img, 0, 0);
    const k = 200 / 25.4;
    // A4 5mm の枠（sheet.js の layout と同じ値）
    const R = { top: [25, 22], front: [25, 107], side: [140, 107] },
      p = 5;
    x.strokeStyle = '#222';
    x.lineWidth = 3;
    x.lineCap = 'round';
    const poly = (o, pts) => {
      x.beginPath();
      pts.forEach(([a, b], i) => x[i ? 'lineTo' : 'moveTo']((o[0] + a * p) * k, (o[1] + b * p) * k));
      x.closePath();
      x.stroke();
    };
    const seg = (o, a, b, c2, d) => {
      x.beginPath();
      x.moveTo((o[0] + a * p) * k, (o[1] + b * p) * k);
      x.lineTo((o[0] + c2 * p) * k, (o[1] + d * p) * k);
      x.stroke();
    };
    poly(R.front, [
      [2, 3],
      [6, 3],
      [6, 7],
      [10, 7],
      [10, 11],
      [2, 11],
    ]);
    poly(R.top, [
      [2, 3],
      [10, 3],
      [10, 9],
      [2, 9],
    ]);
    seg(R.top, 6, 3, 6, 9);
    poly(R.side, [
      [2, 3],
      [8, 3],
      [8, 11],
      [2, 11],
    ]);
    seg(R.side, 2, 7, 8, 7);
    return c.toDataURL('image/png');
  });
  const f = path.join(path.dirname(out), 'scan-' + path.basename(out) + '.png');
  fs.writeFileSync(f, Buffer.from(png.split(',')[1], 'base64'));
  await page.setInputFiles('#file', f);
  res.scan = await waitResult();
  res.scanUi = await snap();
  // E. model-viewer がモデルを読みこめたか
  res.mvLoaded = await page.evaluate(
    () =>
      new Promise(r => {
        const mv = document.getElementById('mv');
        if (mv.loaded) return r(true);
        mv.addEventListener('load', () => r(true), { once: true });
        mv.addEventListener('error', () => r(false), { once: true });
        setTimeout(() => r('timeout'), 15000);
      }),
  );
  await page.screenshot({ path: out.replace(/\.json$/, '.png'), fullPage: true });
  res.logs = logs;
  fs.writeFileSync(out, JSON.stringify(res, null, 1));
  await browser.close();
  const checks = {
    見本: res.sample?.ok,
    見本を編集画面から: res.editSample?.ok,
    円柱と斜面: res.editCustom?.ok && res.editCustom.solid?.y === 40,
    作図用紙: res.scan?.ok && res.scan.solid?.volume === 36000,
    '3D表示': res.mvLoaded === true,
  };
  for (const [k, v] of Object.entries(checks)) console.log((v ? 'OK  ' : 'NG  ') + k);
  console.log('詳しい結果: ' + out);
  if (Object.values(checks).some(v => !v)) process.exit(1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
