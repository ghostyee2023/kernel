#!/usr/bin/env python3
"""生成 Kernel demo 作品的截图轮播图（3:4 PNG，存放 public/screenshots/）。

文件名遵守路由白名单：16 位小写 hex + .png（对应 ^[0-9a-f]{16}\\.(jpg|png|webp|gif)$）。
比例与详情页 banner、上传裁剪器默认比例（3:4）保持一致。
仅用于本地/部署时的 demo 填充，不进入运行期逻辑。
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "screenshots")
os.makedirs(OUT, exist_ok=True)

# 3:4 竖版（与详情页 banner / 裁剪器默认比例一致）
W, H = 960, 1280
BAR = 48  # 浏览器顶栏高

FONT_PATHS = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def load_font(size, bold=False):
    for fp in FONT_PATHS:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                pass
    return ImageFont.load_default()


F_TITLE = load_font(40, bold=True)
F_SUB = load_font(22)
F_BODY = load_font(18)
F_SMALL = load_font(15)
F_URL = load_font(15)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgradient(draw, top, bottom):
    for y in range(H):
        t = y / (H - 1)
        draw.line([(0, y), (W, y)], fill=lerp(top, bottom, t))


def round_rect(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def browser_bar(draw, url, accent):
    draw.rectangle([(0, 0), (W, BAR)], fill=(12, 14, 18))
    dots = [(24, (255, 95, 86)), (48, (255, 189, 46)), (72, (39, 201, 63))]
    for cx, col in dots:
        draw.ellipse([(cx - 6, BAR // 2 - 6), (cx + 6, BAR // 2 + 6)], fill=col)
    pad = 22
    box = (120, 10, W - 120, BAR - 10)
    round_rect(draw, box, 8, fill=(28, 31, 38))
    draw.text((box[0] + pad, box[1] + 9), url, font=F_URL, fill=(150, 158, 172))
    for i in range(3):
        cx = W - 36 - i * 18
        draw.ellipse([(cx - 3, BAR // 2 - 3), (cx + 3, BAR // 2 + 3)], fill=(90, 96, 110))


def card(draw, box, fill, title=None, sub=None):
    round_rect(draw, box, 12, fill=fill)
    if title:
        draw.text((box[0] + 16, box[1] + 14), title, font=F_SUB, fill=(235, 238, 245))
    if sub:
        draw.text((box[0] + 16, box[1] + 46), sub, font=F_SMALL, fill=(180, 186, 198))


def save(name, img):
    path = os.path.join(OUT, name)
    img.save(path, "PNG")
    print("wrote", path)


# ---------------- Aurora Field（极光粒子场 · 绿/青） ----------------
AUR_TOP, AUR_BOT = (8, 28, 24), (12, 60, 52)
AUR_ACC = (52, 211, 153)
AUR_TXT = (209, 250, 229)


def aurora(variant):
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    vgradient(d, AUR_TOP, AUR_BOT)
    browser_bar(d, "aurora-field.kernel.dev", AUR_ACC)
    d.text((40, BAR + 30), "Aurora Field 极光粒子场", font=F_TITLE, fill=AUR_TXT)
    subs = ["Canvas 2D · 零依赖零构建", "鼠标施加反平方斥力", "粒子数 / 速度 / 混合模式"]
    d.text((40, BAR + 84), subs[variant], font=F_SUB, fill=(167, 243, 208))
    # 粒子面板（中部竖版主视觉）
    px0, py0, px1, py1 = (40, 200, W - 40, H - 300)
    round_rect(d, (px0, py0, px1, py1), 16, fill=(10, 24, 21))
    import random
    random.seed(100 + variant)
    shades = [(52, 211, 153), (110, 231, 183), (30, 160, 120)]
    for _ in range(220):
        x = random.randint(px0 + 24, px1 - 24)
        y = random.randint(py0 + 24, py1 - 24)
        r = random.randint(1, 4)
        d.ellipse([(x - r, y - r), (x + r, y + r)], fill=random.choice(shades))
    # 底部两个 KPI 卡
    titles = ["极光粒子场", "流场扰动", "调参面板"]
    cy0, cy1 = H - 260, H - 120
    card(d, (40, cy0, (W - 60) // 2, cy1), (16, 40, 36), titles[variant], "实时演化的三色流体")
    card(d, ((W - 40 + 40) // 2 + 20, cy0, W - 40, cy1), (16, 40, 36), "60 fps", "devicePixelRatio 自适应")
    return img


# ---------------- Nebula（一页式落地页 · 紫/粉） ----------------
NEB_TOP, NEB_BOT = (20, 10, 40), (58, 13, 82)
NEB_ACC = (232, 121, 249)
NEB_TXT = (245, 208, 254)


def nebula(variant):
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    vgradient(d, NEB_TOP, NEB_BOT)
    browser_bar(d, "nebula-landing.kernel.dev", NEB_ACC)
    d.text((40, BAR + 30), "Nebula 一页式落地页", font=F_TITLE, fill=NEB_TXT)
    sections = [
        ("Hero", "clamp() 流体排版 · 首屏 14KB"),
        ("Features", "纯 CSS 动效 · 尊重 reduced-motion"),
        ("Pricing", "两个文件就是部署单元"),
    ]
    title, sub = sections[variant]
    d.text((40, BAR + 84), sub, font=F_SUB, fill=(240, 200, 250))
    chips_map = {
        0: ["特性", "数据", "定价", "页脚"],
        1: ["零依赖", "双击即开", "响应式"],
        2: ["免费", "Pro", "团队"],
    }
    x = 40
    for c in chips_map[variant]:
        w = F_SMALL.getlength(c) + 28
        round_rect(d, (x, BAR + 124, x + w, BAR + 156), 16, fill=(60, 20, 80))
        d.text((x + 14, BAR + 132), c, font=F_SMALL, fill=NEB_TXT)
        x += w + 12
    # Hero 大块
    round_rect(d, (40, 200, W - 40, 560), 16, fill=(40, 16, 60))
    d.text((64, 232), "Nebula", font=F_TITLE, fill=NEB_TXT)
    d.text((64, 288), "一页式落地页 · 14KB 首屏", font=F_SUB, fill=(240, 200, 250))
    # 三个堆叠模块行
    mods = ["模块一 · 流体排版", "模块二 · 零依赖动效", "模块三 · 双文件部署"]
    for i in range(3):
        y = 600 + i * 100
        round_rect(d, (40, y, W - 40, y + 84), 12, fill=(50, 22, 72))
        d.text((64, y + 28), mods[i], font=F_SUB, fill=NEB_TXT)
        d.text((64, y + 56), "纯静态 · 无 JS", font=F_SMALL, fill=(210, 170, 230))
    # 底部定价卡
    card(d, (40, H - 200, W - 40, H - 60), (40, 16, 60), title, sub)
    return img


# ---------------- Pulse（部署脉搏仪表盘 · 蓝/青） ----------------
PUL_TOP, PUL_BOT = (8, 18, 38), (14, 42, 74)
PUL_ACC = (34, 211, 238)
PUL_TXT = (207, 250, 254)


def pulse(variant):
    img = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(img)
    vgradient(d, PUL_TOP, PUL_BOT)
    browser_bar(d, "pulse-dashboard.kernel.dev", PUL_ACC)
    d.text((40, BAR + 30), "Pulse 部署脉搏仪表盘", font=F_TITLE, fill=PUL_TXT)
    d.text((40, BAR + 84), "实时可观测的部署脉搏", font=F_SUB, fill=(180, 235, 250))
    # 侧栏
    round_rect(d, (40, 200, 220, H - 260), 12, fill=(12, 26, 48))
    for i in range(5):
        round_rect(d, (56, 224 + i * 44, 204, 256 + i * 44), 8, fill=(20, 40, 70))
    # 主面板
    mx0, my0, mx1, my1 = (240, 200, W - 40, H - 300)
    round_rect(d, (mx0, my0, mx1, my1), 12, fill=(12, 30, 56))
    if variant == 0:
        pts = [
            (mx0 + 30, my0 + 130), (mx0 + 120, my0 + 70), (mx0 + 210, my0 + 110),
            (mx0 + 300, my0 + 40), (mx0 + 390, my0 + 80), (mx0 + 480, my0 + 30),
            (mx0 + 560, my0 + 70),
        ]
        d.line(pts, fill=PUL_ACC, width=4, joint="curve")
        for p in pts:
            d.ellipse([(p[0] - 4, p[1] - 4), (p[0] + 4, p[1] + 4)], fill=(207, 250, 254))
        d.text((mx0 + 20, my0 + 16), "部署频率 · 近 30 天", font=F_SUB, fill=PUL_TXT)
    elif variant == 1:
        bx = mx0 + 40
        for i in range(6):
            bh = 50 + (i * 47) % 150
            round_rect(d, (bx, my1 - 40 - bh, bx + 60, my1 - 40), 6, fill=PUL_ACC)
            bx += 90
        d.text((mx0 + 20, my0 + 16), "构建时长分布", font=F_SUB, fill=PUL_TXT)
    else:
        for i in range(4):
            y = my0 + 50 + i * 70
            round_rect(d, (mx0 + 20, y, mx1 - 20, y + 50), 8, fill=(20, 40, 70))
            d.text((mx0 + 40, y + 15), f"deploy #{1000 + i * 7}  ·  ok  ·  2.{i}.{i + 1}", font=F_SMALL, fill=PUL_TXT)
        d.text((mx0 + 20, my0 + 16), "最近部署", font=F_SUB, fill=PUL_TXT)
    # 底部两个 KPI 卡
    cy0, cy1 = H - 260, H - 120
    card(d, (40, cy0, (W - 60) // 2, cy1), (12, 34, 60), "可用性 99.9%", "滚动 90 天")
    card(d, ((W - 40 + 40) // 2 + 20, cy0, W - 40, cy1), (12, 34, 60), "P95 1.8s", "冷启动已优化")
    return img


def main():
    specs = [
        ("a1b2c3d4e5f60101.png", aurora, 0),
        ("a1b2c3d4e5f60102.png", aurora, 1),
        ("a1b2c3d4e5f60103.png", aurora, 2),
        ("b2c3d4e5f6a70201.png", nebula, 0),
        ("b2c3d4e5f6a70202.png", nebula, 1),
        ("b2c3d4e5f6a70203.png", nebula, 2),
        ("c3d4e5f6a7b80301.png", pulse, 0),
        ("c3d4e5f6a7b80302.png", pulse, 1),
        ("c3d4e5f6a7b80303.png", pulse, 2),
    ]
    for name, fn, v in specs:
        save(name, fn(v))
    print("done:", len(specs), "images ->", OUT)


if __name__ == "__main__":
    main()
