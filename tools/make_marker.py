"""歯車と「OKA」のARマーカー（AR.js パターン形式）を作る。
使い方: python3 make_marker.py <出力png> <出力patt>
png は黒い枠を含むマーカー本体（余白なし）。パターン比率 0.5（AR.js 既定）。"""
import sys, math
from PIL import Image, ImageDraw, ImageFont

N = 1024  # 内側の図柄の解像度


def inner_image():
    im = Image.new('L', (N, N), 255)
    d = ImageDraw.Draw(im)
    # 歯車（左上寄り）: 歯 8 枚
    cx, cy, r_out, r_in, r_hole = N * 0.36, N * 0.34, N * 0.27, N * 0.20, N * 0.085
    pts = []
    teeth = 8
    for i in range(teeth * 4):
        a = 2 * math.pi * i / (teeth * 4) - math.pi / 2
        r = r_out if (i % 4) in (1, 2) else r_in
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, fill=0)
    d.ellipse([cx - r_hole, cy - r_hole, cx + r_hole, cy + r_hole], fill=255)
    # OKA（下）
    font = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf', int(N * 0.30))
    bb = d.textbbox((0, 0), 'OKA', font=font)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((N - tw) / 2 - bb[0], N * 0.93 - th - bb[1]), 'OKA', font=font, fill=0)
    return im


def full_marker(inner, size=2048):
    m = Image.new('L', (size, size), 0)
    s = size // 2
    m.paste(inner.resize((s, s), Image.LANCZOS), (size // 4, size // 4))
    return m


def encode(inner):
    """AR.js の ArPatternFile.encodeImage と同じ: 0, -90, -180, -270 度（反時計回り）× BGR × 16行"""
    out = []
    for k in range(4):
        rot = inner.rotate(90 * k)  # PIL の正の角度は反時計回り
        px = rot.convert('RGB').resize((16, 16), Image.BOX).load()
        block = []
        for ch in (2, 1, 0):
            for y in range(16):
                block.append(' '.join(str(px[x, y][ch]).rjust(3) for x in range(16)))
        out.append('\n'.join(block))
    return '\n\n'.join(out) + '\n'


if __name__ == '__main__':
    inner = inner_image()
    full_marker(inner).save(sys.argv[1])
    open(sys.argv[2], 'w').write(encode(inner))
