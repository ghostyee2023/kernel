#!/usr/bin/env python3
"""生成 Kernel demo 作品的截图轮播图（16:9 PNG，存放 public/screenshots/）。

文件名遵守路由白名单：16 位小写 hex + .png（对应 ^[0-9a-f]{16}\\.(jpg|png|webp|gif)$）。
仅用于本地/部署时的 demo 填充，不进入运行期逻辑。
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "screenshots")
os.makedirs(OUT, exist_ok=True)

W, H = 1280, 720
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
    # 右侧刷新/菜单点
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
    # 粒子点模拟
    import random
    random.seed(100 + variant)
    for _ in range(140):
        x = random.randint(40, W - 40)
        y = random.randint(BAR + 40, H - 40)
        r = random.randint(1, 4)
        a = random.randint(60, 200)
        d.ellipse([(x - r, y - r), (x + r, y + r)], fill=(52, 211, 153, a)[:3])
    titles = ["极光粒子场", "流场扰动", "调参面板"]
    subs = ["Canvas 2D · 零依赖零构建", "鼠标施加反平方斥力", "粒子数 / 速度 / 混合模式"]
    d.text((40, BAR + 28), "Aurora Field 极光粒子场", font=F_TITLE, fill=AUR_TXT)
    d.text((40, BAR + 82), subs[variant], font=F_SUB, fill=(167, 243, 208))
    # 卡片
    card(d, (40, H - 180, 420, H - 60), (16, 40, 36), titles[variant], "实时演化的三色流体")
    card(d, (460, H - 180, 840, H - 60), (16, 40, 36), "60 fps", "devicePixelRatio 自适应")
    card(d, (860, H - 180, W - 40, H - 60), (16, 40, 36), "≈300 粒子", "沿流线漂移")
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
    d.text((40, BAR + 28), "Nebula 一页式落地页", font=F_TITLE, fill=NEB_TXT)
    sections = [
        ("Hero", "clamp() 流体排版 · 首屏 14KB", ["特性", "数据", "定价", "页脚"]),
        ("Features", "纯 CSS 动效 · 尊重 reduced-motion", ["零依赖", "双击即开", "响应式"]),
        ("Pricing", "两个文件就是部署单元", ["免费", "Pro", "团队"]),
    ]
    title, sub, chips = sections[variant]
    d.text((40, BAR + 82), sub, font=F_SUB, fill=(240, 200, 250))
    # chips
    x = 40
    for c in chips:
        w = F_SMALL.getlength(c) + 28
        round_rect(d, (x, BAR + 124, x + w, BAR + 156), 16, fill=(60, 20, 80))
        d.text((x + 14, BAR + 132), c, font=F_SMALL, fill=NEB_TXT)
        x += w + 12
    # 内容块
    card(d, (40, H - 230, W - 40, H - 150), (40, 16, 60), title, sub)
    # 三栏
    cw = (W - 80 - 40) // 3
    for i in range(3):
        bx = 40 + i * (cw + 20)
        card(d, (bx, H - 140, bx + cw, H - 60), (50, 22, 72), f"模块 {i+1}", "纯静态 · 无 JS")
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
    d.text((40, BAR + 28), "Pulse 部署脉搏仪表盘", font=F_TITLE, fill=PUL_TXT)
    # 侧栏
    round_rect(d, (40, BAR + 80, 220, H - 40), 12, fill=(12, 26, 48))
    for i in range(5):
        round_rect(d, (56, BAR + 100 + i * 44, 204, BAR + 132 + i * 44), 8, fill=(20, 40, 70))
    # 主区折线
    if variant == 0:
        pts = [(260, 360), (360, 300), (460, 340), (560, 240), (660, 280), (760, 200), (860, 250),
               (960, 180), (1060, 210), (1180, 160)]
        round_rect(d, (260, BAR + 80, W - 40, H - 200), 12, fill=(12, 30, 56))
        d.line(pts, fill=PUL_ACC, width=4, joint="curve")
        for p in pts:
            d.ellipse([(p[0] - 4, p[1] - 4), (p[0] + 4, p[1] + 4)], fill=(207, 250, 254))
        d.text((280, BAR + 96), "部署频率 · 近 30 天", font=F_SUB, fill=PUL_TXT)
    elif variant == 1:
        round_rect(d, (260, BAR + 80, W - 40, H - 200), 12, fill=(12, 30, 56))
        bx = 300
        for i in range(8):
            bh = 60 + (i * 37) % 160
            round_rect(d, (bx, H - 220 - bh, bx + 70, H - 220), 6, fill=PUL_ACC)
            bx += 100
        d.text((280, BAR + 96), "构建时长分布", font=F_SUB, fill=PUL_TXT)
    else:
        round_rect(d, (260, BAR + 80, W - 40, H - 200), 12, fill=(12, 30, 56))
        for i in range(4):
            y = BAR + 110 + i * 60
            round_rect(d, (280, y, W - 60, y + 40), 8, fill=(20, 40, 70))
            d.text((300, y + 11), f"deploy #{1000 + i*7}  ·  ok  ·  2.{i}.{i+1}", font=F_SMALL, fill=PUL_TXT)
        d.text((280, BAR + 96), "最近部署", font=F_SUB, fill=PUL_TXT)
    # KPI 条
    card(d, (260, H - 180, 470, H - 60), (12, 34, 60), "可用性 99.9%", "滚动 90 天")
    card(d, (490, H - 180, 700, H - 60), (12, 34, 60), "P95 1.8s", "冷启动已优化")
    card(d, (720, H - 180, W - 40, H - 60), (12, 34, 60), "12 次/日", "自动发布")
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
