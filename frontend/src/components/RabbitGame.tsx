import React, { useEffect, useRef, useState } from 'react';

type GameSpeed = 'slow' | 'normal' | 'fast';

const SPEED_PRESETS: Record<GameSpeed, { bullet: number; minGap: number; maxGap: number; run: number; label: string }> = {
  slow:   { bullet: 4,  minGap: 1800, maxGap: 2800, run: 2.2, label: 'Slow' },
  normal: { bullet: 6,  minGap: 1300, maxGap: 2100, run: 3.0, label: 'Normal' },
  fast:   { bullet: 8,  minGap: 900,  maxGap: 1500, run: 3.8, label: 'Fast' },
};

const CW = 680;
const CH = 160;
const GY = 128;        // top of ground strip (CSS px)
const PS = 3;          // 1 game-pixel = 3 CSS pixels

const R_COLS = 14;
const R_ROWS = 20;
const H_COLS = 12;

// Fixed X positions (CSS px)
const RABBIT_LEFT  = 68;
const HUNTER_RIGHT = CW - 44;
const HUNTER_LEFT  = HUNTER_RIGHT - H_COLS * PS;   // = CW-44-36

// Y when standing on ground
const GROUND_PX = GY - R_ROWS * PS;    // 128 - 60 = 68

// Bullet spawn (gun tip coords)
const BULLET_X0 = HUNTER_LEFT - PS;
const BULLET_Y0 = GROUND_PX + 10 * PS + 1;  // gun row 10 mid

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------
const PAL: Record<string, string> = {
  // rabbit
  W: '#cacaca', G: '#686868', P: '#ff9898', B: '#111111', R: '#dd2222', T: '#f2f2f2',
  // hunter
  H: '#15803d', N: '#4ade80', S: '#fde68a', E: '#111111', K: '#374151', O: '#92400e',
};

// ---------------------------------------------------------------------------
// Pixel sprites  (each row = string of palette keys, '.' = transparent)
// ---------------------------------------------------------------------------
const S_STAND: string[] = [
  '..GG..GG......',
  '.GWWG.GWWG....',
  '.GPPG.GPPG....',
  '.GPPG.GPPG....',
  '.GWWG.GWWG....',
  '...GGGGGGG....',
  '..GWWWWWWWG...',
  '.GWWWWWWWWWG..',
  '.GWWBWWWRWWG..',   // B=eye, R=nose
  '.GWWWWWWWWWG..',
  '.GWWWWWWWWWG..',
  'TGGWWWWWWWWG..',   // T=tail
  '.GWWWWWWWWWG..',
  '.GWWWWWWWWWG..',
  '.GWWWWWWWWWG..',
  '.GWWWWWWWWWG..',
  '..GGGGGGGGG...',
  '....GGG.GGG...',
  '....GGG.GGG...',
  '.....GG..GG...',
];

const S_JUMP: string[] = [
  '..GG..GG......',
  '.GWWG.GWWG....',
  '.GPPG.GPPG....',
  '.GPPG.GPPG....',
  '.GWWG.GWWG....',
  '...GGGGGGG....',
  '..GWWWWWWWG...',
  '.GWWWWWWWWWG..',
  '.GWWBWWWRWWG..',
  '.GWWWWWWWWWG..',
  '.GWWWWWWWWWG..',
  'TGGWWWWWWWWG..',
  '.GWWWWWWWWWG..',
  '.GWWWWWWWWWG..',
  '.GWWWWWWWWWG..',
  '.GWWWWWWWWWG..',
  '..GGGGGGGGG...',
  '.GGG.......GGG',   // legs splayed mid-air
  '.GG.........GG',
  '..G...........',
];

// Hunter faces LEFT (gun extends to the left = toward rabbit)
const S_HUNTER: string[] = [
  '....NHHHH...',
  '....NHHHH...',
  '....NHHHH...',
  '.HHHHHHHHHH.',
  '....SSSSSS..',
  '...ESSSSSSS.',   // E = eye, hunter faces left
  '....SSSSSS..',
  '..HHHHHHHH..',
  '..HHHHHHHH..',
  '..HHHHHHHH..',
  'KKKKHHHHHHHH',   // K = gun arm extending left
  'KK..HHHHHH..',   // K = barrel tip
  '..HHHHHHHH..',
  '....HHH.HHH.',
  '....HHH.HHH.',
  '....HHH.HHH.',
  '....HHH.HHH.',
  '...OOOO.OOOO',
  '...OOOO.OOOO',
  '............',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface Bullet { x: number; y: number }

const RabbitGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const speedRef  = useRef<GameSpeed>('normal');
  const [speed, setSpeed] = useState<GameSpeed>('normal');

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // ── game state ──────────────────────────────────────────────────────────
    const state = {
      rx:        RABBIT_LEFT as number,
      ry:        GROUND_PX as number,
      vx:        0,
      vy:        0,
      onGround:  true,
      bullets:   [] as Bullet[],
      score:     0,
      frame:     0,
      dead:      false,
      highScore: 0,
      nextShot:  0,
      muzzle:    0,
    };
    const keys = { left: false, right: false };

    const scheduleNextShot = (now: number) => {
      const sc = state.score;
      const preset = SPEED_PRESETS[speedRef.current];
      const scoreT = Math.min(1, sc / 1200);
      const minGap = preset.minGap - scoreT * 300;
      const maxGap = preset.maxGap - scoreT * 400;
      state.nextShot = now + minGap + Math.random() * (maxGap - minGap);
    };

    const restart = () => {
      state.rx        = RABBIT_LEFT;
      state.ry        = GROUND_PX;
      state.vx        = 0;
      state.vy        = 0;
      state.onGround  = true;
      state.bullets   = [];
      state.score     = 0;
      state.frame     = 0;
      state.dead      = false;
      state.nextShot  = 0;
      state.muzzle    = 0;
    };

    const jump = () => {
      if (state.dead) { restart(); return; }
      if (state.onGround) {
        state.vy       = -9.2;
        state.onGround = false;
      }
    };

    // ── draw helpers ────────────────────────────────────────────────────────
    const drawSprite = (rows: string[], x: number, y: number) => {
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const c = row[rx];
          if (c === '.' || !PAL[c]) continue;
          ctx.fillStyle = PAL[c];
          ctx.fillRect(x + rx * PS, y + ry * PS, PS, PS);
        }
      });
    };

    const drawBullet = (b: Bullet) => {
      // trail (4 px wide, fading)
      ctx.fillStyle = 'rgba(251,191,36,0.25)';
      ctx.fillRect(b.x + PS * 4, b.y, PS * 4, PS);
      // body
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(b.x,          b.y, PS * 3, PS);
      // tip darker
      ctx.fillStyle = '#f97316';
      ctx.fillRect(b.x + PS * 3, b.y, PS,     PS);
    };

    // ── main loop ──────────────────────────────────────────────────────────
    const loop = (ts: number) => {
      if (!state.dead) {
        state.vy += 0.65;
        state.ry += state.vy;
        if (state.ry >= GROUND_PX) {
          state.ry       = GROUND_PX;
          state.vy       = 0;
          state.onGround = true;
        }

        const preset = SPEED_PRESETS[speedRef.current];
        if (keys.left && !keys.right)  state.vx = -preset.run;
        else if (keys.right && !keys.left) state.vx = preset.run;
        else state.vx = 0;
        state.rx += state.vx;
        const maxRx = HUNTER_LEFT - R_COLS * PS - 8;
        state.rx = Math.max(0, Math.min(state.rx, maxRx));

        if (state.nextShot === 0) scheduleNextShot(ts);

        if (ts >= state.nextShot) {
          state.bullets.push({ x: BULLET_X0, y: BULLET_Y0 });
          state.muzzle = 8;
          scheduleNextShot(ts);
        }

        const spd = preset.bullet + Math.min(3, Math.floor(state.score / 150) * 0.5);
        state.bullets = state.bullets.filter(b => b.x > -24);
        state.bullets.forEach(b => { b.x -= spd; });

        const rT  = state.ry + 3 * PS;
        const rBo = state.ry + (R_ROWS - 2) * PS;
        const rL  = state.rx + 2 * PS;
        const rR  = state.rx + (R_COLS - 3) * PS;

        for (const b of state.bullets) {
          if (b.x + PS * 3 > rL && b.x < rR && b.y + PS > rT && b.y < rBo) {
            state.dead = true;
            if (state.score > state.highScore) state.highScore = state.score;
            break;
          }
        }

        if (state.muzzle > 0) state.muzzle--;
        state.frame++;
        if (state.frame % 4 === 0) state.score++;
      }

      // ── DRAW ──────────────────────────────────────────────────────────────

      // Sky
      ctx.fillStyle = '#0d1b2a';
      ctx.fillRect(0, 0, CW, CH);

      // Stars (pixel dots, static)
      ctx.fillStyle = '#ffffff';
      [50,120,200,315,430,545,610,660].forEach((sx, i) => {
        ctx.fillRect(sx, [20,10,30,15,28,12,36,22][i], PS, PS);
      });

      // Pixel clouds
      ctx.fillStyle = '#1a3a5c';
      [[70, 44, 54, 10], [260, 37, 76, 12], [470, 48, 50, 10]].forEach(
        ([cx, cy, cw, chh]) => {
          ctx.fillRect(cx, cy, cw, chh);
          ctx.fillRect(cx + 8, cy - 8, cw - 16, 10);
        }
      );

      // Ground
      ctx.fillStyle = '#3d2b1f';
      ctx.fillRect(0, GY, CW, CH - GY);
      ctx.fillStyle = '#4a7c3f';
      ctx.fillRect(0, GY, CW, PS * 2);
      // tile separators
      ctx.fillStyle = '#2d6e33';
      for (let tx = 0; tx < CW; tx += 32) ctx.fillRect(tx, GY, PS, PS * 2);

      // Hunter
      const hx = HUNTER_LEFT;
      const hy = GROUND_PX;
      drawSprite(S_HUNTER, hx, hy);

      // Muzzle flash
      if (state.muzzle > 0) {
        ctx.fillStyle = state.muzzle > 4 ? '#ffffff' : '#fbbf24';
        ctx.fillRect(BULLET_X0 - PS, BULLET_Y0 - PS, PS * 3, PS * 3);
      }

      // Bullets
      state.bullets.forEach(drawBullet);

      // Rabbit
      drawSprite(state.onGround ? S_STAND : S_JUMP, Math.round(state.rx), Math.round(state.ry));

      // HUD
      ctx.fillStyle = '#e2e8f0';
      ctx.font      = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`SCORE  ${state.score}`, CW / 2, 14);
      if (state.highScore > 0) {
        ctx.fillStyle = '#fbbf24';
        ctx.font      = '10px monospace';
        ctx.fillText(`BEST  ${state.highScore}`, CW / 2, 26);
      }
      ctx.textAlign = 'left';

      if (state.frame < 180 && !state.dead) {
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.font      = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SPACE/W/UP  to jump   A/D  to run', CW / 2, CH - 5);
        ctx.textAlign = 'left';
      }

      // Game-over overlay
      if (state.dead) {
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, 0, CW, CH);

        ctx.fillStyle = '#ef4444';
        ctx.font      = 'bold 24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', CW / 2, CH / 2 - 16);

        ctx.fillStyle = '#e2e8f0';
        ctx.font      = 'bold 13px monospace';
        ctx.fillText(`Score: ${state.score}`, CW / 2, CH / 2 + 6);

        ctx.fillStyle = '#94a3b8';
        ctx.font      = '11px monospace';
        ctx.fillText('SPACE / CLICK  to try again', CW / 2, CH / 2 + 26);
        ctx.textAlign = 'left';
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        jump();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        keys.left = true;
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        keys.right = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
    };
    canvas.addEventListener('click', jump);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('click', jump);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  return (
    <div className="flex flex-col items-center gap-2 mt-6">
      <p className="text-[13px] text-zinc-400 dark:text-zinc-500 font-mono tracking-wide">
        help the bunny survive while BLAST runs!
      </p>
      <div className="flex items-center gap-1.5">
        {(Object.keys(SPEED_PRESETS) as GameSpeed[]).map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`px-2.5 py-1 text-[13px] font-medium rounded-md border transition-colors ${
              speed === s
                ? 'bg-accent-700/10 dark:bg-accent-300/10 text-accent-800 dark:text-accent-200 border-accent-700/30 dark:border-accent-300/30'
                : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
            }`}
          >
            {SPEED_PRESETS[s].label}
          </button>
        ))}
      </div>
      <canvas
        ref={canvasRef}
        width={CW}
        height={CH}
        className="cursor-pointer rounded-lg border border-zinc-700 dark:border-zinc-800 shadow-lg select-none"
        style={{ maxWidth: '100%', imageRendering: 'pixelated' }}
      />
    </div>
  );
};

export default RabbitGame;
