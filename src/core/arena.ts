export const ARENA = { width: 680, depth: 420, centerX: 480, centerY: 300 } as const;
export function projectArena(x: number, y: number): { x: number; y: number } {
  return { x: ARENA.centerX + (x - y) * 0.65, y: ARENA.centerY + (x + y) * 0.32 };
}
