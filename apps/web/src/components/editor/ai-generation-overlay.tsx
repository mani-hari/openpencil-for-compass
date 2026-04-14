import { useEffect, useState } from 'react';

/**
 * Pulsing concentric-rings overlay shown while the AI is actively generating
 * a design. Rendered on top of the Skia canvas (pointer-events: none) so it
 * doesn't interfere with user interaction.
 *
 * The indicator appears centered over the canvas with a progressive set of
 * messages that rotate every few seconds so the user sees work is still
 * happening during long orchestrator runs.
 */
const MESSAGES = [
  'Analyzing your request…',
  'Planning the layout…',
  'Placing sections…',
  'Filling content…',
  'Adding finishing touches…',
];

export function AIGenerationOverlay() {
  const [msgIdx, setMsgIdx] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMsgIdx((i) => Math.min(i + 1, MESSAGES.length - 1));
    }, 8000);
    const clockTimer = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => {
      clearInterval(msgTimer);
      clearInterval(clockTimer);
    };
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
      aria-live="polite"
    >
      <style>{`
        @keyframes op-ring-pulse {
          0%   { transform: scale(0.4); opacity: 0.75; }
          70%  { opacity: 0.05; }
          100% { transform: scale(2.6); opacity: 0; }
        }
        @keyframes op-core-breathe {
          0%, 100% { transform: scale(1);   opacity: 0.9; }
          50%      { transform: scale(1.1); opacity: 1;   }
        }
      `}</style>

      <div className="relative flex flex-col items-center">
        <div className="relative h-40 w-40">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="absolute inset-0 rounded-full border-2 border-primary"
              style={{
                animation: 'op-ring-pulse 2.4s ease-out infinite',
                animationDelay: `${i * 0.6}s`,
              }}
            />
          ))}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-lg"
            style={{
              width: 28,
              height: 28,
              animation: 'op-core-breathe 1.6s ease-in-out infinite',
            }}
          />
        </div>

        <div className="mt-4 rounded-md border border-border bg-card/95 px-3 py-2 text-center shadow-md backdrop-blur">
          <div className="text-xs font-medium text-foreground">{MESSAGES[msgIdx]}</div>
          <div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
            {elapsedSec}s elapsed
          </div>
        </div>
      </div>
    </div>
  );
}
