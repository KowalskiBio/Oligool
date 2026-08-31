import React, { useEffect, useRef, useState } from 'react';

type GameSpeed = 'slow' | 'normal' | 'fast';
type ObjKind = 'dna' | 'star' | 'book' | 'flask' | 'burger' | 'sushi' | 'cake';

const SPEED_PRESETS: Record<GameSpeed, { fall: number; minGap: number; maxGap: number; fly: number; label: string }> = {
  slow:   { fall: 1.8, minGap: 950, maxGap: 1450, fly: 2.6, label: 'Slow' },
  normal: { fall: 2.6, minGap: 700, maxGap: 1050, fly: 3.2, label: 'Normal' },
  fast:   { fall: 3.6, minGap: 500, maxGap: 800,  fly: 3.8, label: 'Fast' },
};

const CW = 340;
const CH = 440;
const GY = CH - 20;        // top of ground strip (CSS px)
const PS = 3;              // 1 game-pixel = 3 CSS pixels

const B_COLS = 16;
const B_ROWS = 11;
const B_W = B_COLS * PS;
const B_H = B_ROWS * PS;

// ---------------------------------------------------------------------------
// Themes: night sky in dark mode, light sky in light mode
// ---------------------------------------------------------------------------
const THEMES = {
  dark:  { night: true,  sky: '#0d1b2a', cloud: '#1a3a5c', dirt: '#3d2b1f', grass: '#4a7c3f', tile: '#2d6e33', hud: '#e2e8f0', best: '#fbbf24', hint: 'rgba(148,163,184,0.7)' },
  light: { night: false, sky: '#b3dcf2', cloud: '#ffffff', dirt: '#6b4f3a', grass: '#66a653', tile: '#4d9141', hud: '#1e293b', best: '#b45309', hint: 'rgba(71,85,105,0.75)' },
};

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------
const PAL: Record<string, string> = {
  // great tit
  K: '#18181b', W: '#f8f8f4', E: '#ffffff', Y: '#f5c542', O: '#8a9a3f', B: '#8fa0b3', L: '#3f3f46',
  // hazards
  A: '#22d3ee', D: '#e879f9', S: '#fde047', R: '#dc2626', V: '#cfeef7', N: '#64748b', G: '#4ade80',
  // snacks
  U: '#e8a33d', M: '#f97316', P: '#8b5a2b', F: '#f9a8d4',
};

// ---------------------------------------------------------------------------
// Pixel sprites (each row = string of palette keys, '.' = transparent)
// ---------------------------------------------------------------------------

// Great tit facing right: black cap and bib, white cheek, yellow breast,
// olive back, grey wing, dark tail. Wing is overlaid separately.
const S_BIRD: string[] = [
  '......OOOO......',
  '....OOOOOOOO....',
  '...OOOOOKKKK...',
  '..OOOOOOKKWWEK..',
  'K.OOOOOOKKWWKKK.',
  'KKOOOOOOKKKKKKL.',
  'KKOOOOOOOYKKK...',
  'K.OOOOOYYKKK....',
  '...OOOYYYYK.....',
  '...OOYYYYY......',
  '....OOOOOO......',
];

// Wing, drawn over the back; vertical position toggles for the flap
const S_WING: string[] = [
  'BBBBB',
  'BBBB.',
  '.BB..',
];

const S_DNA: string[] = [
  'A......D',
  'AA....DD',
  '.AA..DD.',
  '..AADD..',
  '..AADD..',
  '.DD..AA.',
  'DD....AA',
  'D......A',
];

const S_STAR: string[] = [
  '...S...',
  '..SSS..',
  '.SSSSS.',
  'SSSSSSS',
  '.SSSSS.',
  '..SSS..',
  '...S...',
];

const S_BOOK: string[] = [
  'KKKKKKKKKK',
  'RRRRRRRRRR',
  'RRRRRRRRRR',
  'WWWWWWWWWW',
  'RRRRRRRRRR',
  'KKKKKKKKKK',
];

const S_FLASK: string[] = [
  '..VVVV..',
  '...VV...',
  '...VV...',
  '..V..V..',
  '.V....V.',
  'V.GGGG.V',
  'VGGGGGGV',
  '.VVVVVV.',
];

const S_BURGER: string[] = [
  '..UUUU..',
  '.UWUUWU.',
  'UUUUUUUU',
  'GGGGGGGG',
  'PPPPPPPP',
  '.UUUUUU.',
  '..UUUU..',
];

const S_SUSHI: string[] = [
  '.MMMMMM.',
  'MMWMMWMM',
  '.WWWWWW.',
  'WWWWWWWW',
  '.WWWWWW.',
];

const S_CAKE: string[] = [
  '....R....',
  '..FFFFF..',
  '.FFFFFFF.',
  'FFFFFFFFF',
  '.UUUUUUU.',
  '.UWUWUWU.',
  '.UUUUUUU.',
];

const OBJECTS: Record<ObjKind, { rows: string[]; food: boolean }> = {
  dna:    { rows: S_DNA,    food: false },
  star:   { rows: S_STAR,   food: false },
  book:   { rows: S_BOOK,   food: false },
  flask:  { rows: S_FLASK,  food: false },
  burger: { rows: S_BURGER, food: true },
  sushi:  { rows: S_SUSHI,  food: true },
  cake:   { rows: S_CAKE,   food: true },
};
const HAZARDS: ObjKind[] = ['dna', 'star', 'book', 'flask'];
const SNACKS: ObjKind[] = ['burger', 'sushi', 'cake'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface FallObj { x: number; y: number; vy: number; kind: ObjKind }

const BirdGame: React.FC<{ isDark?: boolean }> = ({ isDark = true }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const speedRef  = useRef<GameSpeed>('normal');
  const isDarkRef = useRef(isDark);
  const [speed, setSpeed] = useState<GameSpeed>('normal');

  useEffect(() => { isDarkRef.current = isDark; }, [isDark]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    // ── game state ──────────────────────────────────────────────────────────
    const state = {
      bx:        (CW - B_W) / 2,
      by:        GY - 150,
      vx:        0,
      vy:        0,
      facing:    1,
      lives:     3,
      invuln:    0,
      objs:      [] as FallObj[],
      fx:        [] as { x: number; y: number; text: string; color: string; t: number }[],
      score:     0,
      frame:     0,
      dead:      false,
      highScore: 0,
      nextSpawn: 0,
    };
    const keys = { left: false, right: false, up: false, down: false };

    const scheduleNextSpawn = (now: number) => {
      const preset = SPEED_PRESETS[speedRef.current];
      const scoreT = Math.min(1, state.score / 1500);
      const minGap = preset.minGap - scoreT * 200;
      const maxGap = preset.maxGap - scoreT * 300;
      state.nextSpawn = now + minGap + Math.random() * (maxGap - minGap);
    };

    const restart = () => {
      state.bx        = (CW - B_W) / 2;
      state.by        = GY - 150;
      state.vx        = 0;
      state.vy        = 0;
      state.facing    = 1;
      state.lives     = 3;
      state.invuln    = 0;
      state.objs      = [];
      state.fx        = [];
      state.score     = 0;
      state.frame     = 0;
      state.dead      = false;
      state.nextSpawn = 0;
    };

    const primary = () => { if (state.dead) restart(); };

    // ── draw helpers ────────────────────────────────────────────────────────
    const drawSprite = (rows: string[], x: number, y: number, flip = false) => {
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          const c = row[rx];
          if (c === '.' || !PAL[c]) continue;
          ctx.fillStyle = PAL[c];
          ctx.fillRect(x + (flip ? row.length - 1 - rx : rx) * PS, y + ry * PS, PS, PS);
        }
      });
    };

    const drawHeart = (x: number, y: number, filled: boolean) => {
      const rows = ['.RR.RR.', 'RRRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...'];
      ctx.fillStyle = filled ? '#ef4444' : 'rgba(120,120,120,0.4)';
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          if (row[rx] === 'R') ctx.fillRect(x + rx * 3, y + ry * 3, 3, 3);
        }
      });
    };

    // ── main loop ──────────────────────────────────────────────────────────
    const loop = (ts: number) => {
      if (!state.dead) {
        // Bird flight
        const preset = SPEED_PRESETS[speedRef.current];
        state.vx = 0;
        state.vy = 0;
        if (keys.left)  { state.vx = -preset.fly; state.facing = -1; }
        if (keys.right) { state.vx =  preset.fly; state.facing =  1; }
        if (keys.up)    state.vy = -preset.fly;
        if (keys.down)  state.vy =  preset.fly;
        state.bx += state.vx;
        state.by += state.vy;
        state.bx = Math.max(4, Math.min(state.bx, CW - B_W - 4));
        state.by = Math.max(6, Math.min(state.by, GY - B_H - 4));

        // Spawning
        if (state.nextSpawn === 0) scheduleNextSpawn(ts);
        if (ts >= state.nextSpawn) {
          const food = Math.random() < 0.45;
          const kind = food
            ? SNACKS[Math.floor(Math.random() * SNACKS.length)]
            : HAZARDS[Math.floor(Math.random() * HAZARDS.length)];
          const w = OBJECTS[kind].rows[0].length * PS;
          state.objs.push({
            x:  4 + Math.random() * (CW - w - 8),
            y: -OBJECTS[kind].rows.length * PS,
            vy: preset.fall * (0.85 + Math.random() * 0.45) + Math.min(1.2, state.score / 900),
            kind,
          });
          scheduleNextSpawn(ts);
        }

        // Fall + collisions
        const bL = state.bx + 2 * PS;
        const bT = state.by + PS;
        const bR = state.bx + B_W - 2 * PS;
        const bB = state.by + B_H - PS;
        state.objs = state.objs.filter(o => {
          o.y += o.vy;
          if (o.y > GY) return false;
          const def = OBJECTS[o.kind];
          const w = def.rows[0].length * PS;
          const h = def.rows.length * PS;
          if (o.x + PS < bR && o.x + w - PS > bL && o.y + PS < bB && o.y + h - PS > bT) {
            if (def.food) {
              state.lives = Math.min(3, state.lives + 1);
              state.score += 25;
              state.fx.push({ x: o.x, y: o.y, text: '+1', color: '#4ade80', t: 45 });
              return false;
            }
            if (state.invuln <= 0) {
              state.lives -= 1;
              state.invuln = 80;
              state.fx.push({ x: o.x, y: o.y, text: '-1', color: '#f87171', t: 45 });
              if (state.lives <= 0) {
                state.dead = true;
                if (state.score > state.highScore) state.highScore = state.score;
              }
              return false;
            }
          }
          return true;
        });

        if (state.invuln > 0) state.invuln--;
        state.fx = state.fx.filter(f => { f.y -= 0.5; f.t--; return f.t > 0; });

        state.frame++;
        if (state.frame % 4 === 0) state.score++;
      }

      // ── DRAW ──────────────────────────────────────────────────────────────

      const th = THEMES[isDarkRef.current ? 'dark' : 'light'];

      // Sky
      ctx.fillStyle = th.sky;
      ctx.fillRect(0, 0, CW, CH);

      if (th.night) {
        // Stars (pixel dots, static)
        ctx.fillStyle = '#ffffff';
        [40, 110, 190, 260, 310, 145, 75, 230].forEach((sx, i) => {
          ctx.fillRect(sx, [18, 34, 10, 26, 40, 60, 90, 78][i], PS, PS);
        });
      } else {
        // Sun
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(24, 15, PS * 3, PS * 3);
        ctx.fillRect(27, 6,  PS, PS);
        ctx.fillRect(27, 27, PS, PS);
        ctx.fillRect(17, 18, PS, PS);
        ctx.fillRect(37, 18, PS, PS);
      }

      // Pixel clouds (slow drift)
      ctx.fillStyle = th.cloud;
      [[30, 60, 60, 10], [190, 40, 70, 12], [90, 130, 50, 10]].forEach(([bx, cy, cw, chh], i) => {
        const cx = ((bx + state.frame * (0.12 + i * 0.04)) % (CW + cw)) - cw;
        ctx.fillRect(cx, cy, cw, chh);
        ctx.fillRect(cx + 8, cy - 8, cw - 16, 10);
      });

      // Ground
      ctx.fillStyle = th.dirt;
      ctx.fillRect(0, GY, CW, CH - GY);
      ctx.fillStyle = th.grass;
      ctx.fillRect(0, GY, CW, PS * 2);
      ctx.fillStyle = th.tile;
      for (let tx = 0; tx < CW; tx += 32) ctx.fillRect(tx, GY, PS, PS * 2);

      // Falling objects
      state.objs.forEach(o => drawSprite(OBJECTS[o.kind].rows, Math.round(o.x), Math.round(o.y)));

      // Bird (blinks while invulnerable, flips to face its direction)
      if (!(state.invuln > 0 && state.frame % 8 < 4)) {
        const flap  = Math.floor(state.frame / 8) % 2 === 0;
        const flip  = state.facing < 0;
        drawSprite(S_BIRD, Math.round(state.bx), Math.round(state.by), flip);
        drawSprite(S_WING, Math.round(state.bx) + (flip ? 9 : 2) * PS, Math.round(state.by) + (flap ? 3 : 6) * PS, flip);
      }

      // Floating score effects
      ctx.font      = 'bold 12px monospace';
      ctx.textAlign = 'center';
      state.fx.forEach(f => {
        ctx.globalAlpha = Math.min(1, f.t / 15);
        ctx.fillStyle   = f.color;
        ctx.fillText(f.text, f.x, f.y);
      });
      ctx.globalAlpha = 1;

      // HUD: hearts, score, best
      for (let i = 0; i < 3; i++) drawHeart(10 + i * 28, 8, i < state.lives);

      ctx.fillStyle = th.hud;
      ctx.font      = 'bold 12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`SCORE  ${state.score}`, CW / 2, 16);
      if (state.highScore > 0) {
        ctx.fillStyle = th.best;
        ctx.font      = '10px monospace';
        ctx.fillText(`BEST  ${state.highScore}`, CW / 2, 28);
      }

      if (state.frame < 240 && !state.dead) {
        ctx.fillStyle = th.hint;
        ctx.font      = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('WASD/ARROWS to fly, snacks heal', CW / 2, CH - 5);
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
      if (e.code === 'Space') {
        e.preventDefault();
        primary();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        keys.left = true;
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        keys.right = true;
      } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        keys.up = true;
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        keys.down = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') keys.left = false;
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') keys.right = false;
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = false;
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = false;
    };
    canvas.addEventListener('click', primary);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('click', primary);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-[13px] text-zinc-400 dark:text-zinc-500 font-mono tracking-wide">
        help the great tit dodge lab junk while BLAST runs!
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
        className={`cursor-pointer rounded-lg border shadow-lg select-none ${isDark ? 'border-zinc-700' : 'border-zinc-300'}`}
        style={{ maxWidth: '100%', imageRendering: 'pixelated' }}
      />
    </div>
  );
};

export default BirdGame;
