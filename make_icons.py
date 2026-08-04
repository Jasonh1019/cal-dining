"""生成 PWA 图标：Berkeley 蓝底 + 金色碗和筷子。纯 stdlib，不需要 PIL。

图标已经生成好在 icons/ 里，只有想换样子时才需要重跑：
    python3 make_icons.py
"""
import struct, zlib, math
from pathlib import Path

OUT = Path(__file__).resolve().parent / 'icons'
BLUE = (0x00, 0x32, 0x62)
GOLD = (0xFD, 0xB5, 0x15)

def png(path, w, h, px):
    raw = b''.join(b'\x00' + bytes(v for x in range(w) for v in px[y][x]) for y in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    hdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)  # 8-bit truecolor
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', hdr)
                     + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def blend(bg, fg, a):
    return tuple(round(bg[i] * (1 - a) + fg[i] * a) for i in range(3))

def draw(size, maskable=False):
    S = size
    ss = 3  # 超采样，边缘不锯齿
    pad = 0.0 if maskable else 0.0
    # 安全区：maskable 图标内容缩到中间 ~62%
    scale = 0.62 if maskable else 0.80
    px = [[BLUE] * S for _ in range(S)]

    cx, cy = S / 2, S / 2
    R = S * scale / 2          # 图形整体半径

    # 碗：下半圆 + 上沿；筷子：两根斜线
    bowl_r   = R * 0.86
    bowl_top = cy + R * 0.02   # 碗口所在的水平线
    rim_h    = R * 0.10
    rim_w    = bowl_r * 2.16   # 比碗身略宽，才像碗沿

    for y in range(S):
        for x in range(S):
            hits = 0
            for sy in range(ss):
                for sx in range(ss):
                    fx = x + (sx + 0.5) / ss
                    fy = y + (sy + 0.5) / ss
                    inside = False
                    dx, dy = fx - cx, fy - bowl_top
                    # 碗身：半圆环
                    if dy >= 0 and dx*dx + dy*dy <= bowl_r*bowl_r:
                        inside = True
                    # 碗口横条
                    if -rim_h <= dy <= 0 and abs(dx) <= rim_w / 2:
                        inside = True
                    # 两根筷子，斜插在碗上方
                    for off, ang in ((-0.20, -20), (0.06, -12)):
                        ax = cx + R * off
                        ay = bowl_top - R * 0.22
                        t = math.radians(ang)
                        ux, uy = math.sin(t), -math.cos(t)
                        px_, py_ = fx - ax, fy - ay
                        proj = px_ * ux + py_ * uy
                        if 0 <= proj <= R * 0.78:
                            perp = abs(px_ * uy - py_ * ux)
                            if perp <= R * 0.055:
                                inside = True
                    if inside:
                        hits += 1
            if hits:
                px[y][x] = blend(BLUE, GOLD, hits / (ss * ss))
    return px

for size in (180, 192, 512):
    png(OUT / f'icon-{size}.png', size, size, draw(size))
    print('icon-%d.png' % size)
png(OUT / 'icon-maskable-512.png', 512, 512, draw(512, maskable=True))
print('icon-maskable-512.png')
