import { useEffect, useReducer } from 'react';
import { SimController } from '../engine/controller';

function initialPreset(): string {
  try {
    const p = new URLSearchParams(location.search).get('preset');
    if (p) return p;
  } catch {
    /* ignore */
  }
  return 'genesis';
}

/** The single simulation controller shared by the whole UI. */
export const sim = new SimController(initialPreset(), 1);

// Expose for debugging and automated smoke tests.
(globalThis as unknown as { __rc: SimController }).__rc = sim;

/** Re-render when the controller signals a structural change. */
export function useSimVersion(): number {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => sim.subscribe(force), []);
  return sim.version;
}

/** Re-render at a fixed rate for live readouts. */
export function useTick(hz = 8): number {
  const [n, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(force, 1000 / hz);
    return () => clearInterval(id);
  }, [hz]);
  return n;
}
