import React, { useEffect, useState } from 'react';
import RabbitGame from './RabbitGame';
import BirdGame from './BirdGame';

type GameId = 'bunny' | 'tit';

const GAMES: Record<GameId, { label: string }> = {
  bunny: { label: 'Bunny' },
  tit:   { label: 'Great Tit' },
};

const STORAGE_KEY = 'oligool-loading-game';

/**
 * Picker for the loading-screen easter-egg games. The choice is remembered
 * across sessions.
 */
const GameArcade: React.FC<{ isDark: boolean }> = ({ isDark }) => {
  const [game, setGame] = useState<GameId>(() =>
    localStorage.getItem(STORAGE_KEY) === 'tit' ? 'tit' : 'bunny',
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, game);
  }, [game]);

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1.5 mb-2">
        {(Object.keys(GAMES) as GameId[]).map((g) => (
          <button
            key={g}
            onClick={() => setGame(g)}
            className={`px-2.5 py-1 text-[13px] font-medium rounded-md border transition-colors ${
              game === g
                ? 'bg-accent-700/10 dark:bg-accent-300/10 text-accent-800 dark:text-accent-200 border-accent-700/30 dark:border-accent-300/30'
                : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700'
            }`}
          >
            {GAMES[g].label}
          </button>
        ))}
      </div>
      {game === 'bunny' ? <RabbitGame isDark={isDark} /> : <BirdGame isDark={isDark} />}
    </div>
  );
};

export default GameArcade;
