'use client';

/**
 * HeroCanvas v4 —— 首页 hero「种子 → 开花」常驻花朵特效（零依赖）。
 *
 * 叙事（一次性，不循环）：
 *   1. 星尘中，一颗「种子」光点从顶部缓缓落下（品牌叙事：每一件杰作始于一颗种子）；
 *   2. 落到标题「都始于一颗种子」的 em「种子」二字右下方锚点；
 *   3. 破土：细茎向下生长、两片叶子展开、花苞 12 片花瓣逐片绽放（弹性缓动）；
 *   4. 常驻盛开：
 *      - 微风摇曳（小振幅正弦，持续）；
 *      - 随机「阵风」（每 6-12s 一阵，振幅明显加大，平滑起落）；
 *      - 鼠标悬停花冠附近 → 抖一抖（高频衰减抖动，移开后再悬停可重复触发）。
 *
 * 交互：鼠标在 hero 内移动 → 花朵 3D 视差 + 星尘粒子斥力；悬停花冠 → 抖动。
 * 行为：hero 滚出视口后淡出（IntersectionObserver）；切后台暂停 rAF。
 *
 * 性能与降级：
 *   - devicePixelRatio 适配（上限 2），dt 钳制（≤40ms）
 *   - `prefers-reduced-motion` → 只渲染一帧静态盛开的花（open=1，不摇曳）
 *   - Canvas 由客户端挂载后才绘制，不阻塞 SSR 首屏
 */

import { useEffect, useRef } from 'react';

/** 星尘粒子。 */
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  alpha: number;
  hue: number;
}

/** 流星（偶尔划过，一次性）。 */
interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  age: number;
  life: number;
}

/** 主色（对齐 design token，浏览器端无法直接读 CSS 变量时兜底）。 */
const PRIMARY_RGB = [127, 138, 240] as const; // #7F8AF0（dark 主色）
const CYAN_RGB = [62, 201, 194] as const; // #3EC9C2（dark 渐变锚点）
const LEAF_RGB = [94, 178, 128] as const; // 茎叶青绿

/** 鼠标位置（hero 坐标系）。 */
const POINTER = { x: -9999, y: -9999, active: false };

/** 种子下落总时长（ms）。 */
const DROP_MS = 3000;
/** 花苞绽放总时长（ms）。 */
const GROW_MS = 2600;
/** 花瓣数。 */
const PETAL_COUNT = 12;
/** 茎长（px）。 */
const STEM_LEN = 96;
/** 悬停判定半径（px，相对花冠）。 */
const HOVER_RADIUS = 95;

function easeInQuad(t: number): number {
  return t * t;
}
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** 二次贝塞尔求点：p0 → c → p1，t∈[0,1]。叶子精确贴在茎曲线上用。 */
function quadPoint(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  t: number,
): [number, number] {
  const mt = 1 - t;
  return [
    mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
    mt * mt * y0 + 2 * mt * t * cy + t * t * y1,
  ];
}

export function HeroCanvas(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasRefEl = canvasRef.current;
    const hostRefEl = canvasRefEl?.parentElement;
    if (!canvasRefEl || !hostRefEl) return;
    const canvas: HTMLCanvasElement = canvasRefEl;
    const host: HTMLElement = hostRefEl;
    const ctx: CanvasRenderingContext2D = canvas.getContext('2d') as CanvasRenderingContext2D;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let running = true;
    let visible = true;
    let inViewport = true;
    let particles: Particle[] = [];

    // —— 花朵锚点：em「种子」右下方 ——
    let flowerX = 0;
    let flowerY = 0;
    let anchorMeasured = false;

    // —— 状态机：drop → grow → bloomed（常驻） ——
    let phase: 'drop' | 'flower' = 'drop';
    let phaseT = 0;
    let seedX = 0;
    let seedDropY = 0;
    let stemGrow = 0;
    let petalOpen: number[] = new Array(PETAL_COUNT).fill(0);

    // —— 摇曳系统 ——
    let swayT = 0; // 微风相位累计
    let gustCountdown = 0; // 距下次阵风 ms
    let gustT = 0; // 当前阵风已进行 ms
    let gustDur = 0; // 当前阵风持续 ms
    let hoverT = 480; // hover 抖动进行 ms（≥480 表示空闲）
    let hoverCooldown = 0; // 抖动触发冷却（防花冠摇摆导致边缘反复触发）
    let prevOnFlower = false;

    // —— 流星系统 ——
    let meteors: Meteor[] = [];
    let meteorCountdown = 5000 + Math.random() * 6000; // 首个流星 5-11s 后

    /** 测量 em「种子」位置 → 花朵锚点（hero 坐标系）。 */
    function measureTarget(): void {
      const hostRect = host.getBoundingClientRect();
      const em = document.querySelector<HTMLElement>('.hero__title em');
      if (em) {
        const r = em.getBoundingClientRect();
        flowerX = r.right - hostRect.left + 24;
        flowerY = r.bottom - hostRect.top + 4;
      } else {
        flowerX = width / 2 + 120;
        flowerY = height * 0.42;
      }
      anchorMeasured = true;
    }

    /** 适配画布尺寸（含 DPR，上限 2 控开销）。 */
    function resize(): void {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      seed();
      measureTarget();
      seedX = width / 2;
      seedDropY = height * -0.06;
      stemGrow = 1;
      petalOpen = new Array(PETAL_COUNT).fill(1);
      if (reduced) draw();
    }

    /** 按当前尺寸播种星尘粒子。 */
    function seed(): void {
      const count = Math.min(140, Math.max(60, Math.floor((width * height) / 11000)));
      particles = Array.from({ length: count }, () => {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const toSeed = Math.random() < 0.4;
        return {
          x: toSeed ? flowerX + (Math.random() - 0.5) * width * 0.3 : x,
          y: toSeed ? flowerY + (Math.random() - 0.5) * height * 0.24 : y,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
          r: Math.random() * 1.8 + 0.5,
          alpha: Math.random() * 0.55 + 0.2,
          hue: Math.random() < 0.55 ? 0 : 1,
        };
      });
    }

    /** 种子触地 → 开始生长。 */
    function startFlower(): void {
      phase = 'flower';
      phaseT = 0;
      stemGrow = 0;
      petalOpen = new Array(PETAL_COUNT).fill(0);
      gustCountdown = 4000 + Math.random() * 5000; // 首个阵风在 4-9s 后
    }

    /** 当前风角（微风 + 阵风 + hover 轻颤的合成）。 */
    function windAngle(): number {
      let a = 0.05 * Math.sin((2 * Math.PI * 1.05 * swayT) / 1000 + 0.7);
      if (gustT < gustDur) {
        const e = Math.sin(Math.PI * (gustT / gustDur)); // 0→1→0 包络
        a += 0.26 * Math.sin((2 * Math.PI * 0.85 * gustT) / 1000) * e;
      }
      // 轻颤：低幅 5Hz，衰减包络（柔和"抖一抖"，不剧烈）
      if (hoverT < 480) {
        const k = 1 - hoverT / 480;
        a += 0.032 * Math.sin((2 * Math.PI * 5 * hoverT) / 1000) * k;
      }
      return a;
    }

    /** 生成一颗流星：从 hero 顶部斜向划过，带拖尾（len 段渐变）。 */
    function spawnMeteor(): void {
      const angle = Math.PI * 0.62 + (Math.random() - 0.5) * 0.5; // 约 112°±29°：斜向左下或右下
      const speed = 620 + Math.random() * 260; // px/s
      meteors.push({
        x: width * (0.12 + Math.random() * 0.76),
        y: -16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        len: 150 + Math.random() * 120,
        age: 0,
        life: 0.62 + Math.random() * 0.25,
      });
    }

    /** 更新状态机与风系统。 */
    function update(dt: number): void {
      phaseT += dt;
      swayT += dt;

      if (phase === 'drop') {
        const t = Math.min(1, phaseT / DROP_MS);
        seedDropY = lerp(height * -0.06, flowerY, easeInQuad(t));
        seedX = flowerX + Math.sin(phaseT / 300) * 10;
        if (t >= 1) startFlower();
        return;
      }

      // —— flower ——
      if (stemGrow < 1) {
        stemGrow = Math.min(1, phaseT / 900);
      }
      // 花瓣逐片展开（一次性）
      for (let i = 0; i < PETAL_COUNT; i++) {
        const local = (phaseT - i * 90) / 620;
        if (local > 0 && petalOpen[i] < 1) petalOpen[i] = Math.min(1, easeOutBack(Math.min(1, local)));
      }

      // 阵风调度
      if (gustT >= gustDur) {
        gustCountdown -= dt;
        if (gustCountdown <= 0) {
          gustT = 0;
          gustDur = 1500 + Math.random() * 900;
        }
      } else {
        gustT += dt;
      }

      // hover 轻颤推进 + 触发冷却
      if (hoverT < 480) hoverT += dt;
      if (hoverCooldown > 0) hoverCooldown = Math.max(0, hoverCooldown - dt);

      // 流星：调度 + 推进（按秒）
      meteorCountdown -= dt;
      if (meteorCountdown <= 0) {
        spawnMeteor();
        meteorCountdown = 7000 + Math.random() * 10000; // 下次流星 7-17s 后
      }
      const dt_s = dt / 1000;
      for (const m of meteors) {
        m.age += dt_s;
        m.x += m.vx * dt_s;
        m.y += m.vy * dt_s;
      }
      meteors = meteors.filter((m) => m.age < m.life);
    }

    /** 绘制单帧。 */
    function draw(): void {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const breathe = 1 + Math.sin(performance.now() / 1600) * 0.04;

      // —— 种子（下落阶段） ——
      if (phase === 'drop') {
        const progress = Math.max(0, (seedDropY + 0.06 * height) / (flowerY + 0.06 * height));
        const glowR = (36 + progress * 52) * breathe * dpr;
        const glow = ctx.createRadialGradient(seedX * dpr, seedDropY * dpr, 0, seedX * dpr, seedDropY * dpr, glowR * 4);
        glow.addColorStop(0, `rgba(${PRIMARY_RGB[0]},${PRIMARY_RGB[1]},${PRIMARY_RGB[2]},0.4)`);
        glow.addColorStop(0.5, `rgba(${PRIMARY_RGB[0]},${PRIMARY_RGB[1]},${PRIMARY_RGB[2]},0.12)`);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const core = ctx.createRadialGradient(seedX * dpr, seedDropY * dpr, 0, seedX * dpr, seedDropY * dpr, glowR * 0.7);
        core.addColorStop(0, 'rgba(220, 235, 255, 0.95)');
        core.addColorStop(0.25, `rgba(${CYAN_RGB[0]},${CYAN_RGB[1]},${CYAN_RGB[2]},0.85)`);
        core.addColorStop(0.7, `rgba(${PRIMARY_RGB[0]},${PRIMARY_RGB[1]},${PRIMARY_RGB[2]},0.35)`);
        core.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(seedX * dpr, seedDropY * dpr, glowR * 0.7, 0, Math.PI * 2);
        ctx.fill();

        for (let i = 1; i <= 2; i++) {
          const ty = seedDropY - i * 26;
          if (ty < -10) continue;
          const a = 0.22 - i * 0.07;
          if (a <= 0) continue;
          ctx.beginPath();
          ctx.fillStyle = `rgba(${CYAN_RGB[0]},${CYAN_RGB[1]},${CYAN_RGB[2]},${a})`;
          ctx.arc(seedX * dpr, ty * dpr, (2.4 - i * 0.6) * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // —— 花（常驻：茎 + 花冠，随风摇曳） ——
      if (phase === 'flower' && stemGrow > 0.02) {
        const sway = windAngle();
        const stemLen = STEM_LEN * stemGrow;
        // 茎底部 pivot 固定，花冠绕 pivot 摆动（风吹弯茎秆）
        const px = flowerX;
        const py = flowerY + stemLen;
        const bloomX = px - Math.sin(sway) * stemLen; // 小角度近似：cos≈1
        const bloomY = py - Math.cos(sway) * stemLen;
        const midY = (py + bloomY) / 2;
        const bend = Math.sin(sway) * stemLen * 0.6; // 中段弯曲控制点

        // 茎（贝塞尔：pivot → 控制点 → 花冠）
        ctx.save();
        ctx.strokeStyle = `rgba(${LEAF_RGB[0]},${LEAF_RGB[1]},${LEAF_RGB[2]},${0.55 * stemGrow})`;
        ctx.lineWidth = 2 * dpr;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(px * dpr, py * dpr);
        ctx.quadraticCurveTo((px + bend) * dpr, midY * dpr, bloomX * dpr, bloomY * dpr);
        ctx.stroke();

        // 两片叶子：精确取茎曲线上 t 处的点与切线（贴茎，不分离）
        for (const t of [0.55, 0.78]) {
          const [lx, ly] = quadPoint(px, py, px + bend, midY, bloomX, bloomY, t);
          const [lx2, ly2] = quadPoint(px, py, px + bend, midY, bloomX, bloomY, Math.min(1, t + 0.02));
          const tangent = Math.atan2(ly2 - ly, lx2 - lx);
          const side = t > 0.7 ? -1 : 1;
          ctx.fillStyle = `rgba(${LEAF_RGB[0]},${LEAF_RGB[1]},${LEAF_RGB[2]},${0.5 * stemGrow})`;
          ctx.save();
          ctx.translate(lx * dpr, ly * dpr);
          ctx.rotate(tangent + side * Math.PI * 0.42);
          ctx.beginPath();
          ctx.ellipse(side * 8 * dpr, 0, 11 * dpr, 4 * dpr, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();

        // 花冠：hover 判定（带冷却，防花冠摇摆导致边缘反复触发）+ 3D 视差 + 花瓣
        const dxMouse = bloomX - POINTER.x;
        const dyMouse = bloomY - POINTER.y;
        const onFlower = POINTER.active && Math.hypot(dxMouse, dyMouse) < HOVER_RADIUS;
        if (onFlower && !prevOnFlower && hoverCooldown <= 0) {
          hoverT = 0; // 悬停进入 → 轻轻一颤
          hoverCooldown = 900;
        }
        prevOnFlower = onFlower;

        const tiltX = POINTER.active ? (POINTER.x / width - 0.5) * 2 : 0;
        const tiltY = POINTER.active ? (POINTER.y / height - 0.5) * 2 : 0;
        ctx.save();
        ctx.translate(bloomX * dpr, bloomY * dpr);
        ctx.rotate(tiltX * 0.12);
        ctx.scale(1 - Math.abs(tiltY) * 0.08, 1 - Math.abs(tiltX) * 0.08);

        // 花心光点
        const coreR = 6.5 * breathe * dpr;
        const core = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR * 3);
        core.addColorStop(0, 'rgba(255,244,200,0.95)');
        core.addColorStop(0.4, `rgba(${CYAN_RGB[0]},${CYAN_RGB[1]},${CYAN_RGB[2]},0.8)`);
        core.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(0, 0, coreR * 3, 0, Math.PI * 2);
        ctx.fill();

        // 12 片花瓣（3D 感：宽随 open 从细苞到平展）
        const petalLen = 40 * dpr;
        const petalWid = 15 * dpr;
        for (let i = 0; i < PETAL_COUNT; i++) {
          const open = petalOpen[i];
          if (open <= 0.02) continue;
          const ang = (i / PETAL_COUNT) * Math.PI * 2;
          const w = petalWid * (0.22 + 0.78 * open);
          const l = petalLen * (0.72 + 0.28 * open);
          const rgb = i % 3 === 0 ? CYAN_RGB : PRIMARY_RGB;
          const grad = ctx.createLinearGradient(l * 0.15, 0, l * 0.95, 0);
          grad.addColorStop(0, `rgba(255,255,255,${0.75 * open})`);
          grad.addColorStop(0.45, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.72 * open})`);
          grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.18 * open})`);
          ctx.save();
          ctx.rotate(ang);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(l * 0.55, 0, l * 0.5, w * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.restore();
      }

      // —— 星尘粒子（鼠标斥力 + 漂移 + 环绕） ——
      for (const p of particles) {
        if (POINTER.active) {
          const dx = p.x - POINTER.x;
          const dy = p.y - POINTER.y;
          const dist = Math.hypot(dx, dy);
          const range = 130;
          if (dist < range && dist > 0.01) {
            const force = (1 - dist / range) * 1.4;
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.vy *= 0.985;
        if (p.x < -8) p.x = width + 8;
        if (p.x > width + 8) p.x = -8;
        if (p.y < -8) p.y = height + 8;
        if (p.y > height + 8) p.y = -8;

        const rgb = p.hue === 0 ? PRIMARY_RGB : CYAN_RGB;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${p.alpha})`;
        ctx.arc(p.x * dpr, p.y * dpr, p.r * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      // —— 流星（偶尔划过，拖尾渐变 + 头部光点） ——
      for (const m of meteors) {
        const t = m.age / m.life;
        const a = Math.sin(Math.PI * t); // 淡入 → 淡出
        const dx = m.vx / Math.hypot(m.vx, m.vy);
        const dy = m.vy / Math.hypot(m.vx, m.vy);
        const tailX = (m.x - dx * m.len) * dpr;
        const tailY = (m.y - dy * m.len) * dpr;
        const headX = m.x * dpr;
        const headY = m.y * dpr;
        const grad = ctx.createLinearGradient(headX, headY, tailX, tailY);
        grad.addColorStop(0, `rgba(240,246,255,${0.9 * a})`);
        grad.addColorStop(0.35, `rgba(${CYAN_RGB[0]},${CYAN_RGB[1]},${CYAN_RGB[2]},${0.45 * a})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2 * dpr;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(headX, headY);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        // 头部光点
        ctx.beginPath();
        ctx.fillStyle = `rgba(240,246,255,${0.85 * a})`;
        ctx.arc(headX, headY, 2.2 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /** rAF 主循环（dt 钳制防切后台跳帧）。 */
    let lastT = performance.now();
    function loop(): void {
      if (!running) return;
      const now = performance.now();
      let dt = now - lastT;
      lastT = now;
      if (dt > 40) dt = 40;
      update(dt);
      draw();
      rafId = requestAnimationFrame(loop);
    }

    /** 指针进入 hero。 */
    function onMove(event: MouseEvent): void {
      const rect = host.getBoundingClientRect();
      POINTER.x = event.clientX - rect.left;
      POINTER.y = event.clientY - rect.top;
      POINTER.active = true;
    }
    function onLeave(): void {
      POINTER.active = false;
      POINTER.x = -9999;
      POINTER.y = -9999;
      prevOnFlower = false;
    }

    /** 视口可见性（hero 滚出则淡出并暂停）。 */
    function onIntersect(entries: IntersectionObserverEntry[]): void {
      inViewport = entries[0]?.isIntersecting ?? true;
      canvas.style.opacity = inViewport ? '1' : '0';
      if (inViewport && visible && !reduced) loop();
    }

    /** 页面可见性（切后台暂停 rAF）。 */
    function onVisibility(): void {
      visible = !document.hidden;
      if (visible && inViewport && !reduced && running) loop();
    }

    resize();
    if (reduced) {
      draw(); // 只绘一帧静态盛开的花
      return () => {
        /* reduced-motion 下无动画可清理 */
      };
    }

    running = true;
    lastT = performance.now();
    loop();

    window.addEventListener('resize', resize);
    host.addEventListener('mousemove', onMove);
    host.addEventListener('mouseleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    const observer = new IntersectionObserver(onIntersect, { threshold: 0.15 });
    observer.observe(canvas);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      host.removeEventListener('mousemove', onMove);
      host.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />;
}
