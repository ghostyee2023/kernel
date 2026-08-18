# DESIGN.md — Kernel · 创意种子 静态作品发布与投票平台

> 参考基因：**Linear**（排版精度与发丝层级）· **Vercel**（近白画布与克制黑墨）· **Framer**（作品展示的视觉张力）
> 品牌：**Kernel · 创意种子** —— 每一件杰作都始于一颗种子。Slogan：英文 `Core. Code. Create.` / 中文「核心 · 代码 · 创造」。
> 本文件为 AI 编程代理（Cursor / Claude Code / v0）的唯一视觉真源。所有色值、尺寸不得自行发挥。

---

## 1. Visual Theme & Atmosphere

**设计哲学**：内容优先的展台。平台自身是**中性的画框**，作品才是主角。UI 用近白画布 + 发丝边框把作品缩略图托起来，绝不用花哨背景抢戏。

**视觉基调**：精密（precision）· 克制（restraint）· 通透（airy）· 有分量（weighted）

**核心特征关键词**
1. **近白画布** — `#FFFFFF` / `#FAFAFB` 双层底，作品图在其上自然浮起
2. **发丝边框** — 1px `#E1E4EA` 定义结构，优先于阴影划分区域
3. **负字距标题** — 大标题一律负 letter-spacing，制造软件工艺感
4. **品牌色点睛** — 靛 / 青 / 品红三色只在投票、榜单、活动阶段状态处出现，绝不铺面积。三色同时构成品牌渐变 `linear-gradient(100deg,#4C5BD4 0%,#12B8B0 48%,#E0489A 100%)`，仅用于品牌标识与 Hero 标题渐变一处
5. **微阴影层级** — 阴影只用来表达"可交互 / 已抬起"，不用来装饰

**光影质感**：纯扁平为底 + 极低不透明度多层阴影。禁止拟物、禁止大面积渐变。渐变文字**仅允许在 Hero 标题一处**（`background-clip:text` 品牌渐变高亮关键词"种子"）；背景氛围层为极低透明度三色径向渐变（techBg），不抢内容。奖牌、投票 hover 微光可含渐变。

---

## 2. Color Palette & Roles

### Primary（品牌靛 Iris）

| 角色 | HEX | CSS 变量 | 用途 |
|------|-----|---------|------|
| Primary | `#4C5BD4` | `--color-primary` | 主按钮、链接、聚焦环、品牌标识 |
| Primary Hover | `#5D6BE0` | `--color-primary-hover` | 主按钮悬停 |
| Primary Active | `#3F4DBA` | `--color-primary-active` | 按下态 |
| Primary Soft | `#EEF0FE` | `--color-primary-soft` | 选中背景、标签底色 |
| Primary Border | `#C7CDF7` | `--color-primary-border` | 软态边框 |
| On Primary | `#FFFFFF` | `--color-on-primary` | 主色上的文字 |

### Brand Dark

| 角色 | HEX | CSS 变量 | 用途 |
|------|-----|---------|------|
| Ink | `#0E1014` | `--color-ink` | 最深墨色，Logo、Hero 标题 |
| Ink Elevated | `#1A1D24` | `--color-ink-elevated` | 深色区块、大屏模式底 |

### Accent / Interactive（品牌光谱 · 三色）

> 品牌主梯度 **仅三色**：靛 `#4C5BD4` / 青 `#12B8B0` / 品红 `#E0489A`。早期方案中的第四色 Amber `#F2A03D` 已废弃，不再使用。

| 角色 | HEX | CSS 变量 | 用途 |
|------|-----|---------|------|
| Cyan | `#12B8B0` | `--color-accent-cyan` | 作品征集 / 提交阶段状态、数据指标 |
| Magenta | `#E0489A` | `--color-accent-magenta` | **点赞/投票**、热度火苗 |
| Gold | `#E0B33C` | `--color-accent-gold` | 榜首奖牌 |
| Bronze | `#C08552` | `--color-accent-bronze` | 季军奖牌 |

### Neutral / Gray Scale

| Token | HEX | CSS 变量 |
|-------|-----|---------|
| Gray 50 | `#FAFAFB` | `--gray-50` |
| Gray 100 | `#F4F5F7` | `--gray-100` |
| Gray 200 | `#E9EBEF` | `--gray-200` |
| Gray 300 | `#D8DCE3` | `--gray-300` |
| Gray 400 | `#A8AEBA` | `--gray-400` |
| Gray 500 | `#7C8493` | `--gray-500` |
| Gray 600 | `#5A6172` | `--gray-600` |
| Gray 700 | `#3E4453` | `--gray-700` |
| Gray 800 | `#272B36` | `--gray-800` |
| Gray 900 | `#171A21` | `--gray-900` |

### Text

| 角色 | HEX | CSS 变量 | 用途 |
|------|-----|---------|------|
| Primary | `#0E1014` | `--text-primary` | 标题、正文强调 |
| Secondary | `#4A5060` | `--text-secondary` | 正文 |
| Tertiary | `#838B9B` | `--text-tertiary` | 辅助信息、时间戳 |
| Disabled | `#B4BAC6` | `--text-disabled` | 禁用态 |
| Inverse | `#FFFFFF` | `--text-inverse` | 深底上的文字 |

### Surface & Borders

| 角色 | HEX | CSS 变量 | 用途 |
|------|-----|---------|------|
| Canvas | `#FFFFFF` | `--surface-canvas` | 页面主底 |
| Soft | `#FAFAFB` | `--surface-soft` | 区块交替底 |
| Sunken | `#F4F5F7` | `--surface-sunken` | 输入框底、代码块、预览容器 |
| Elevated | `#FFFFFF` | `--surface-elevated` | 卡片、弹层 |
| Border Subtle | `#EDEEF2` | `--border-subtle` | 分隔线 |
| Border Default | `#E1E4EA` | `--border-default` | 卡片、输入框边框 |
| Border Strong | `#CBD0DA` | `--border-strong` | 悬停边框、强调分隔 |

### Semantic

| 角色 | HEX | Soft | CSS 变量 |
|------|-----|------|---------|
| Success | `#16A46B` | `#E6F7F0` | `--color-success` / `--color-success-soft` |
| Warning | `#E08A17` | `#FEF4E4` | `--color-warning` / `--color-warning-soft` |
| Danger | `#DC3A47` | `#FDEDEE` | `--color-danger` / `--color-danger-soft` |
| Info | `#2E7CF6` | `#E9F2FE` | `--color-info` / `--color-info-soft` |

### Shadow Colors

```css
--shadow-color:       rgba(14, 16, 20, 0.06);
--shadow-color-md:    rgba(14, 16, 20, 0.08);
--shadow-color-lg:    rgba(14, 16, 20, 0.12);
--shadow-brand:       rgba(76, 91, 212, 0.24);
--shadow-magenta:     rgba(224, 72, 154, 0.22);
--focus-ring:         rgba(76, 91, 212, 0.18);
--overlay-scrim:      rgba(14, 16, 20, 0.48);
```

### Dark Theme Overrides

```css
[data-theme="dark"] {
  --surface-canvas: #0B0C0F;  --surface-soft: #101216;
  --surface-sunken: #131519;  --surface-elevated: #17191F;
  --border-subtle: #1E212828; --border-default: #272B33;
  --border-strong: #363B45;
  --text-primary: #F2F3F5;    --text-secondary: #B4BAC6;
  --text-tertiary: #7C8493;
  --color-primary: #7F8AF0;   --color-primary-soft: #1C1F3A;
  --shadow-color: rgba(0, 0, 0, 0.40);
}
```

---

## 3. Typography Rules

### Font Family

```css
--font-sans:    'Inter var', 'Inter', 'Geist', -apple-system, BlinkMacSystemFont,
                'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', sans-serif;
--font-display: var(--font-sans);
--font-mono:    'Geist Mono', 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace;
```
短码 slug、文件路径、票数数字**一律用 mono**，并开启 `font-variant-numeric: tabular-nums` 防止跳动。

### Type Scale

| Token | Size | Weight | Line Height | Letter Spacing | 用途 |
|-------|------|--------|-------------|----------------|------|
| `display-hero` | 64px | 600 | 1.04 | -2.4px | 首页 Hero |
| `display-xl` | 48px | 600 | 1.08 | -1.6px | 活动主页大标题 |
| `display-lg` | 36px | 600 | 1.14 | -1.0px | 区块标题 |
| `headline` | 28px | 600 | 1.22 | -0.6px | 作品详情标题 |
| `title` | 22px | 600 | 1.30 | -0.4px | 卡片组标题 |
| `card-title` | 17px | 600 | 1.36 | -0.2px | 作品卡片标题 |
| `subtitle` | 18px | 500 | 1.44 | -0.2px | 副标题 |
| `body-lg` | 17px | 400 | 1.60 | -0.1px | 详情正文 |
| `body` | 15px | 400 | 1.60 | 0 | 默认正文 |
| `body-sm` | 13px | 400 | 1.55 | 0 | 卡片描述 |
| `label` | 13px | 500 | 1.20 | 0 | 按钮、表单标签 |
| `caption` | 12px | 400 | 1.40 | 0.1px | 时间戳、计数 |
| `overline` | 11px | 600 | 1.30 | 0.8px | 分区小标（大写） |
| `nano` | 10px | 500 | 1.20 | 0.4px | 角标 |
| `mono-code` | 13px | 400 | 1.50 | 0 | 短码 / 路径 |

### 设计哲学

- **字重只用 400 / 500 / 600 三档**，不用 700 以上——重量靠字号和色阶拉开，不靠加粗
- **字号越大，字距越负**：≥36px 用 `-1.0px` 起步，Hero 到 `-2.4px`，这是"精密感"的来源
- **中文行高比英文高一档**：正文中文用 `1.75`，纯英文可用 `1.60`
- **数字用 tabular-nums**：票数实时跳动时不抖动

---

## 4. Component Stylings

### Buttons

```css
/* Primary — 发布 / 投票 */
.btn-primary {
  background: var(--color-primary); color: #FFFFFF;
  font: 500 14px/1 var(--font-sans);
  padding: 0 18px; height: 38px; border-radius: 8px; border: none;
  box-shadow: 0 1px 2px rgba(14,16,20,0.06);
  transition: background .16s ease, transform .16s ease, box-shadow .16s ease;
}
.btn-primary:hover  { background: var(--color-primary-hover);
                      box-shadow: 0 4px 14px var(--shadow-brand); transform: translateY(-1px); }
.btn-primary:active { background: var(--color-primary-active); transform: translateY(0); }
.btn-primary:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--focus-ring); }

/* Secondary — 次要操作 */
.btn-secondary {
  background: #FFFFFF; color: var(--text-primary);
  border: 1px solid var(--border-default);
  height: 38px; padding: 0 16px; border-radius: 8px; font: 500 14px/1 var(--font-sans);
}
.btn-secondary:hover { background: var(--gray-50); border-color: var(--border-strong); }

/* Ghost — 工具栏 */
.btn-ghost {
  background: transparent; color: var(--text-secondary);
  height: 34px; padding: 0 12px; border-radius: 7px; border: none;
}
.btn-ghost:hover { background: var(--gray-100); color: var(--text-primary); }

/* Vote — 点赞专用，唯一使用品红的按钮 */
.btn-vote {
  background: #FFFFFF; color: var(--text-primary);
  border: 1px solid var(--border-default);
  height: 40px; padding: 0 16px; border-radius: 999px;
  display: inline-flex; align-items: center; gap: 8px;
}
.btn-vote:hover  { border-color: var(--color-accent-magenta); color: var(--color-accent-magenta); }
.btn-vote[data-voted="true"] {
  background: var(--color-accent-magenta); border-color: var(--color-accent-magenta); color: #FFFFFF;
  box-shadow: 0 4px 14px var(--shadow-magenta);
}

/* Danger */
.btn-danger { background: var(--color-danger); color: #FFF; height: 38px; padding: 0 16px; border-radius: 8px; }
.btn-danger:hover { background: #C42E3A; }
```

### Cards（作品卡片）

> 交互：卡片**整体可点击**进入详情（`data-goto="detail"` + `cursor:pointer`）；悬浮层仅保留「查看详情」视觉提示，**已移除「全屏运行」按钮**（原型验证：不需要脱离外壳的单独运行态）。点击卡片内投票按钮时不触发卡片跳转（投票处理优先级高于视图切换）。

```css
.card {
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(14,16,20,0.04);
  transition: transform .22s cubic-bezier(.16,1,.3,1),
              box-shadow .22s cubic-bezier(.16,1,.3,1),
              border-color .22s ease;
}
.card:hover {
  transform: translateY(-3px);
  border-color: var(--border-strong);
  box-shadow: 0 12px 28px rgba(14,16,20,0.08), 0 2px 6px rgba(14,16,20,0.04);
}
.card__thumb { aspect-ratio: 16/10; background: var(--surface-sunken); object-fit: cover; }
.card__body  { padding: 16px 18px 18px; }
```

### Inputs

```css
.input {
  height: 40px; padding: 0 12px;
  background: var(--surface-canvas);
  border: 1px solid var(--border-default); border-radius: 8px;
  font: 400 15px/1 var(--font-sans); color: var(--text-primary);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.input::placeholder { color: var(--text-disabled); }
.input:hover  { border-color: var(--border-strong); }
.input:focus  { outline: none; border-color: var(--color-primary);
                box-shadow: 0 0 0 3px var(--focus-ring); }
.input[aria-invalid="true"] { border-color: var(--color-danger);
                box-shadow: 0 0 0 3px rgba(220,58,71,0.15); }
```

### Navigation

```css
.nav {
  height: 60px; background: rgba(255,255,255,0.82);
  backdrop-filter: saturate(180%) blur(16px);
  border-bottom: 1px solid var(--border-subtle);
  position: sticky; top: 0; z-index: 100;
}
.nav__link        { font: 500 14px/1 var(--font-sans); color: var(--text-secondary);
                    padding: 8px 12px; border-radius: 7px; }
.nav__link:hover  { color: var(--text-primary); background: var(--gray-100); }
.nav__link[aria-current="page"] { color: var(--color-primary); background: var(--color-primary-soft); }
```

> **移动端抽屉导航**：`≤768px` 时主横导航收起为汉堡按钮，点击展开右侧抽屉 `.nav__drawer`（宽 `min(82vw,320px)`，右滑入，带半透明遮罩 `.nav__drawer-mask`）。抽屉内复用顶部导航链接 + 登录/注册操作。桌面端不渲染汉堡与抽屉。
> **原型调试切换器已移除**：早期原型底部的黑色浮层视图切换器（`.proto`）已从设计系统中删除，正式版以真实导航为准。

### Badges / Tags

```css
.badge         { height: 22px; padding: 0 9px; border-radius: 6px;
                 font: 500 12px/22px var(--font-sans); display: inline-flex; align-items: center; }
.badge--campaign { background: var(--color-primary-soft); color: var(--color-primary); }
.badge--live     { background: var(--color-success-soft); color: var(--color-success); }
.badge--expiring { background: var(--color-warning-soft); color: var(--color-warning); }
.badge--private  { background: var(--gray-100); color: var(--gray-600); }
.tag           { height: 24px; padding: 0 10px; border-radius: 999px;
                 border: 1px solid var(--border-default); background: #FFF;
                 font: 400 12px/24px var(--font-sans); color: var(--text-secondary); }
.tag:hover     { border-color: var(--color-primary-border); color: var(--color-primary);
                 background: var(--color-primary-soft); }
```

### Modals / Dialogs

```css
.scrim  { position: fixed; inset: 0; background: var(--overlay-scrim);
          backdrop-filter: blur(4px); z-index: 900;
          animation: fade .18s ease both; }
.modal  { background: var(--surface-elevated); border-radius: 18px;
          border: 1px solid var(--border-default);
          box-shadow: 0 40px 80px rgba(14,16,20,0.14), 0 8px 20px rgba(14,16,20,0.06);
          padding: 28px; max-width: 520px; width: calc(100% - 32px); z-index: 1000;
          animation: modalIn .24s cubic-bezier(.16,1,.3,1) both; }
@keyframes fade    { from { opacity: 0 } to { opacity: 1 } }
@keyframes modalIn { from { opacity: 0; transform: translateY(12px) scale(.98) }
                     to   { opacity: 1; transform: translateY(0)    scale(1)   } }
```

---

## 4.5 Hero & Brand Expression（品牌表达）

> 品牌表达是"点睛"，不是"铺面"。所有品牌渐变与 Slogan 仅出现在首页 Hero 与品牌标识，绝不进入内容卡片。

- **Hero 标题**：中文「每一件杰作，都始于一颗<em>种子</em>。」——"种子"用品牌渐变 `background-clip:text` 高亮，**全站唯一一处渐变文字**。
- **Slogan 胶囊**：`.hero__slogan` 中文「核心 · 代码 · 创造」等宽字体、微渐变背景、1px 品牌描边、内/外发光 + 周期性扫光动画（`sloganShine`）。
- **Logo**：「种子·核」意象 SVG，配竖排中文「创意种子」。
- **Footer**：全局统一 `Core. Code. Create. / 核心 · 代码 · 创造`，作为品牌收尾。
- **氛围背景**：`#techBg` 极低透明度三色径向渐变（靛/青/品红），置于 `z-index:-1`，不抢内容。
- **上传页**：`Cultivate the future.` 青色大写副标题，呼应"培育作品"理念。

---

## 4.6 Ranking（排行榜）

- **前三名奖牌**：`1/2/3` 数字圆替换为 **奖杯 SVG**（金/银/铜背景渐变，`TROPHY_SVG`），取消纯数字序号。
- **进入庆祝**：进入排行榜页面触发限时烟花（`#rankFireworks` canvas，7 发 / 1.5s 内分批，自动停火清屏），仅作一次性情绪反馈。
- **功能预告保留**：「大屏模式」作为 feature teaser 保留；「导出成绩单」「加载更多」等若已在前端隐藏，以「规划中」占位，不出现在正式交互路径。

---

## 4.7 Campaign（活动页）

> 活动页经原型多轮去冗余验证，以下为已固化的设计决策。

- **活动广场（`#view-campaign`）**：标题「参加活动 · 让作品被看见」+ 简介，**无顶部 eyebrow、无阶段筛选器**（原型验证：筛选器对当前活动数量无必要，活动卡片本身含状态徽章即可区分）。活动卡片网格直接渲染全部活动。
- **活动详情 CTA 合并**：Hero 区 CTA 行始终显示「查看作品」，按阶段追加「前往报名 / 提交作品 / 去排行榜」，单行排列（原型验证：避免按钮分散与信息重复）。
- **详情状态提示框已移除**：原左下角"活动已结束/投票已关闭"等 `.camp-phasebox` 提示框删除——阶段状态已由 Hero 状态徽章 + 阶段进度条承载，不再重复。
- **活动即标签**：活动名称本身就是标签，参与者打 `#活动名` 即视为参与；**不单独建立标签体系**，详情/卡片不再展示独立标签 chips（原型验证：标签即活动名，多余）。
- **创建表单**：删除「关联活动标签」输入；投票规则 chips/checkboxes 接上读写（`rules` 数组：限票档位 + 允许自投/评委加权/结果实时公开）。

---

## 5. Layout Principles

### Spacing System — 4px 基数

| Token | 值 | 典型用途 |
|-------|-----|---------|
| `space-1` | 4px | 图标与文字间隙 |
| `space-2` | 8px | 紧凑内边距 |
| `space-3` | 12px | 表单项间距 |
| `space-4` | 16px | 卡片内边距 |
| `space-5` | 20px | 卡片间距 |
| `space-6` | 24px | 组件组间距 |
| `space-8` | 32px | 小节间距 |
| `space-12` | 48px | 区块内间距 |
| `space-16` | 64px | 区块间距（移动端） |
| `space-24` | 96px | 区块间距（桌面端） |

### Grid & Container

```css
--container-max: 1280px;     /* 主内容 */
--container-wide: 1440px;    /* 作品广场（多一列） */
--container-prose: 720px;    /* 详情正文 */
--container-pad: 24px;       /* 桌面左右留白，移动端 16px */
--grid-gap: 20px;
```
作品网格列数：`mobile 1 / tablet 2 / desktop 3 / wide 4`
后台表格页：左侧固定 240px 侧边栏 + 右侧流式。

### Section Spacing
桌面区块上下 `96px`，移动端 `64px`。Hero 顶部额外 `+24px` 呼吸。

### 留白哲学
**宁可少一列，也不要挤。** 作品缩略图是内容核心，卡片间距不低于 20px，让每个作品都有独立呼吸空间。文字块最大行宽 72 字符（中文 38 字）。

---

## 6. Depth & Elevation

### Shadow System

```css
--shadow-xs:  0 1px 2px  rgba(14,16,20,0.04);
--shadow-sm:  0 1px 3px  rgba(14,16,20,0.06), 0 1px 2px  rgba(14,16,20,0.04);
--shadow-md:  0 4px 12px rgba(14,16,20,0.06), 0 1px 3px  rgba(14,16,20,0.04);
--shadow-lg:  0 12px 28px rgba(14,16,20,0.08), 0 2px 6px  rgba(14,16,20,0.04);
--shadow-xl:  0 24px 48px rgba(14,16,20,0.10), 0 4px 12px rgba(14,16,20,0.05);
--shadow-2xl: 0 40px 80px rgba(14,16,20,0.14), 0 8px 20px rgba(14,16,20,0.06);
--shadow-brand-glow:   0 8px 24px rgba(76,91,212,0.24);
--shadow-magenta-glow: 0 8px 24px rgba(224,72,154,0.22);
```

### Surface Layers

```
Layer 0  Canvas    #FFFFFF          无阴影
Layer 1  Soft      #FAFAFB          无阴影，靠色差区分
Layer 2  Card      #FFFFFF + 1px 边框 + shadow-xs
Layer 3  Hover     #FFFFFF + shadow-lg + translateY(-3px)
Layer 4  Popover   #FFFFFF + shadow-xl
Layer 5  Modal     #FFFFFF + shadow-2xl + scrim
```

### Z-index Scale

```css
--z-base: 0;      --z-sticky: 100;   --z-dropdown: 300;
--z-tooltip: 500; --z-scrim: 900;    --z-modal: 1000;  --z-toast: 1200;
```

### Backdrop Effects
仅用于两处：导航栏 `blur(16px) saturate(180%)`、模态遮罩 `blur(4px)`。作品卡片**不使用**毛玻璃——会让缩略图失焦。

---

## 7. Do's and Don'ts

### ✅ Do's
1. 用 **1px 发丝边框** 划分区域，阴影只表达"可交互"
2. 大标题一律**负字距**，≥36px 不低于 `-1.0px`
3. 票数、短码、文件大小一律用 **mono + tabular-nums**
4. 卡片 hover 用 `translateY(-3px)` + shadow-lg，位移不超过 4px
5. 强调色（青/品红/金）单页出现总面积 **< 5%**
6. 所有交互过渡 `160–240ms`，缓动统一 `cubic-bezier(.16,1,.3,1)`
7. 作品缩略图容器用 `--surface-sunken` 打底，避免透明 PNG 悬空
8. 空状态必须有插画/图标 + 一句引导 + 一个主 CTA

### ❌ Don'ts
1. **不要**给整页加渐变背景——会吃掉作品的视觉权重
2. **不要**用 700 以上字重，靠字号和色阶拉层次
3. **不要**在卡片上叠毛玻璃
4. **不要**同时出现两个主色按钮，一屏只有一个主行动点
5. **不要**用纯黑 `#000000` 做文字，用 `#0E1014`
6. **不要**给作品卡片加彩色边框区分状态，用左上角小徽章
7. **不要**在列表里用超过 3 种圆角，统一 `8 / 14 / 999px`
8. **不要**做超过 300ms 的入场动画，浏览作品时最怕等
9. **不要**在 Hero 标题关键词"种子"之外使用 `background-clip:text` 渐变文字——全站渐变文字仅此一处
10. **不要**把原型调试浮层（黑色视图切换器）带入正式版，正式版以真实导航为准

---

## 8. Responsive Behavior

### Breakpoints

```css
--bp-sm:  480px;   /* 大屏手机 */
--bp-md:  768px;   /* 平板竖屏 */
--bp-lg:  1024px;  /* 平板横屏 / 小笔记本 */
--bp-xl:  1280px;  /* 桌面 */
--bp-2xl: 1536px;  /* 宽屏 */
```

### 各断点行为

| 断点 | 作品网格 | 导航 | 详情页 | 后台 |
|------|---------|------|--------|------|
| `< 480` | 1 列 | 汉堡菜单 + 底部 Tab | 预览堆叠在信息上方 | 卡片列表替代表格 |
| `480–768` | 2 列 | 汉堡菜单 | 同上 | 卡片列表 |
| `768–1024` | 2 列 | 精简横向导航 | 预览 60% + 信息 40% | 侧边栏收起为图标 |
| `1024–1280` | 3 列 | 完整导航 | 预览 68% + 侧栏 32% | 侧边栏 240px |
| `≥ 1280` | 4 列（wide 容器） | 完整导航 + 搜索框 | 同上，容器 1280px | 同上 |

### Touch Targets
- 最小 **44×44px**（含透明热区）
- 投票按钮移动端 `height: 48px`，全宽吸底
- 卡片整块可点，链接热区不小于 `40px` 高

### Font Scaling
```css
html { font-size: 16px; }
@media (max-width: 768px) {
  --display-hero: 40px;   /* 64 → 40，letter-spacing 收至 -1.4px */
  --display-xl:   32px;
  --display-lg:   26px;
  --headline:     22px;
  /* body 保持 15px 不缩小，保证可读性 */
}
```
**规则**：标题在移动端缩放，正文永不小于 15px；`caption` 永不小于 12px。

---

## 9. Agent Prompt Guide

### Quick Reference（给 AI 代理的一句话摘要）

> 近白画布 `#FFFFFF`/`#FAFAFB`，主色靛 `#4C5BD4`，点赞品红 `#E0489A`，文字 `#0E1014`/`#4A5060`/`#838B9B`，边框 `#E1E4EA`。字体 Inter + PingFang SC，标题负字距，字重只用 400/500/600。圆角 `8 / 14 / 999px`。间距 4px 基数。卡片 = 白底 + 1px 边框 + shadow-xs，hover 抬起 3px 加 shadow-lg。过渡 200ms `cubic-bezier(.16,1,.3,1)`。强调色总面积不超过 5%。

### Component Prompts（可直接复制）

**① 作品卡片**
```
生成一个作品卡片组件。16:10 缩略图（占位底色 #F4F5F7），下方 padding 16px 18px 18px。
标题 17px/600/-0.2px 单行省略；描述 13px/400 双行省略 color:#838B9B。
底部一行：左侧作者头像 20px 圆形 + 昵称 12px；右侧圆角 999px 投票按钮，
未投票为白底 1px #E1E4EA，已投票为 #E0489A 白字 + 0 4px 14px rgba(224,72,154,.22)。
左上角绝对定位徽章显示活动名（背景 #EEF0FE 文字 #4C5BD4 圆角 6px 高 22px）。
卡片本体：白底、1px #E1E4EA、圆角 14px、shadow 0 1px 2px rgba(14,16,20,.04)；
hover translateY(-3px) + 0 12px 28px rgba(14,16,20,.08)，过渡 220ms cubic-bezier(.16,1,.3,1)。
```

**② 上传拖拽区**
```
生成上传 Dropzone。虚线边框 2px dashed #D8DCE3，圆角 16px，背景 #FAFAFB，
内边距 48px，居中图标 40px color:#A8AEBA。
主文案 17px/500 #0E1014「拖入 HTML 文件或 ZIP 包」，
副文案 13px #838B9B「单文件 ≤ 100MB，解压后 ≤ 200MB」。
拖拽悬停态：边框 #4C5BD4 实线、背景 #EEF0FE、图标变 #4C5BD4，过渡 160ms。
下方进度条高 6px 圆角 999px，轨道 #E9EBEF，填充 #4C5BD4。
```

**③ 排行榜行**
```
生成排行榜列表项，高 76px，白底，底部 1px #EDEEF2 分隔。
左侧排名数字 mono 20px/600 tabular-nums 宽 40px 右对齐；
前三名替换为渐变奖牌圆形 32px：1 名 linear-gradient(135deg,#F5D67B,#E0B33C)、
2 名 (#E4E7EC,#B9BFC9)、3 名 (#DCAE86,#C08552)，内嵌白色名次数字。
接着 56×36 缩略图圆角 8px；然后标题 15px/500 + 活动标签 11px；
最右票数 mono 18px/600 #0E1014 + 12px #838B9B「票」。
hover 整行背景 #FAFAFB。
```

**④ 作品详情预览区**
```
生成详情页预览容器。外框圆角 16px、1px #E1E4EA、背景 #F4F5F7、shadow-md。
顶部 40px 浏览器风格工具条：左三个 10px 灰点，中间 mono 13px 显示短码域名
（背景 #FFFFFF 圆角 8px 高 26px padding 0 12px 内嵌 1px #E9EBEF），
右侧刷新与全屏图标按钮 28px。
下方 iframe aspect-ratio 16/10，sandbox="allow-scripts allow-popups allow-forms"，
不加 allow-same-origin。
```

**⑤ 后台数据卡片**
```
生成后台概览指标卡。白底 1px #E1E4EA 圆角 12px padding 20px。
顶部 overline 11px/600/0.8px 大写 #838B9B 标题；
中部数值 mono 32px/600 tabular-nums #0E1014；
底部一行 12px：涨幅用 #16A46B（正）或 #DC3A47（负）+ 灰色对比文案。
右上角 32px 圆角 8px 图标底，背景用对应语义 soft 色。
```

### Iteration Guide

1. 先落 **layout 与间距**，再上色——色彩最后加，避免用颜色掩盖结构问题
2. 每次只调**一个维度**（字号 / 间距 / 色彩），不要同时改三样
3. 生成后检查：一屏内主色按钮是否只有一个？
4. 检查强调色面积，超过 5% 就撤掉最不重要的那处
5. 阴影只在可交互元素上出现，静态区块用边框
6. 所有文字对比度过 WCAG AA（正文 ≥ 4.5:1，大字 ≥ 3:1）
7. 中文文案检查行高，正文用 1.75 而非 1.6
8. 移动端先看 375px 宽，主 CTA 是否吸底、是否够 44px
9. 动画统一 `cubic-bezier(.16,1,.3,1)`，禁止 `ease-in-out` 混用
10. 交付前把所有硬编码色值替换为 CSS 变量，确保暗色主题能一键切换
