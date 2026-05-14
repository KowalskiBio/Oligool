import React, { useEffect, useRef } from 'react';

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

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // ── game state ──────────────────────────────────────────────────────────
    const state = {
      ry:        GROUND_PX as number,   // rabbit top-y (CSS px)
      vy:        0,
      onGround:  true,
      bullets:   [] as Bullet[],
      score:     0,
      frame:     0,
      dead:      false,
      highScore: 0,
      volley:    [] as number[],        // timestamps of pending bullet fires
      muzzle:    0,                     // frames left for muzzle flash
    };

    const scheduleVolley = (now: number) => {
      const sc = state.score;
      const minGap = Math.max(550,  2000 - sc * 2.8);
      const maxGap = Math.max(900,  3200 - sc * 3.5);
      const t0 = now + minGap + Math.random() * (maxGap - minGap);

      const r = Math.random();
      if (sc > 200 && r < 0.15)       state.volley = [t0, t0 + 170, t0 + 340];  // triple
      else if (sc > 80 && r < 0.42)   state.volley = [t0, t0 + 190];             // double
      else                             state.volley = [t0];                        // single
    };

    const restart = () => {
      state.ry        = GROUND_PX;
      state.vy        = 0;
      state.onGround  = true;
      state.bullets   = [];
      state.score     = 0;
      state.frame     = 0;
      state.dead      = false;
      state.volley    = [];
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
        // Physics
        state.vy += 0.65;
        state.ry += state.vy;
        if (state.ry >= GROUND_PX) {
          state.ry       = GROUND_PX;
          state.vy       = 0;
          state.onGround = true;
        }

        // Schedule first volley
        if (state.volley.length === 0) scheduleVolley(ts);

        // Fire
        const fired = state.volley.filter(t => ts >= t);
        if (fired.length) {
          fired.forEach(() => state.bullets.push({ x: BULLET_X0, y: BULLET_Y0 }));
          state.volley  = state.volley.filter(t => ts < t);
          state.muzzle  = 8;
          if (state.volley.length === 0) scheduleVolley(ts);
        }

        // Move bullets
        const spd = 6 + Math.min(4, Math.floor(state.score / 120) * 0.8);
        state.bullets = state.bullets.filter(b => b.x > -24);
        state.bullets.forEach(b => { b.x -= spd; });

        // Collision (tight inner hitbox)
        const rT  = state.ry + 3 * PS;
        const rBo = state.ry + (R_ROWS - 2) * PS;
        const rL  = RABBIT_LEFT + 2 * PS;
        const rR  = RABBIT_LEFT + (R_COLS - 3) * PS;

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
      drawSprite(state.onGround ? S_STAND : S_JUMP, RABBIT_LEFT, Math.round(state.ry));

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

      // Jump hint (first 3 s)
      if (state.frame < 180 && !state.dead) {
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.font      = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SPACE / CLICK  to jump', CW / 2, CH - 5);
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

    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); jump(); } };
    canvas.addEventListener('click', jump);
    window.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('click', jump);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className="flex flex-col items-center gap-2 mt-6">
      <p className="text-xs text-slate-400 dark:text-slate-500 font-mono tracking-wide">
        help the bunny survive while BLAST runs!
      </p>
      <canvas
        ref={canvasRef}
        width={CW}
        height={CH}
        className="cursor-pointer rounded-lg border border-slate-700 shadow-lg select-none"
        style={{ maxWidth: '100%', imageRendering: 'pixelated' }}
      />
    </div>
  );
};

export default RabbitGame;
