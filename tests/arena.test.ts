import { describe, expect, it } from "vitest";
import { ARENA, projectArena } from "../src/core/arena";

describe("arena projection", () => {
  it("projects origin to center", () => expect(projectArena(0, 0)).toEqual({ x: ARENA.centerX, y: ARENA.centerY }));
  it("projects opposite corners symmetrically", () => {
    const a = projectArena(100, 50), b = projectArena(-100, -50);
    expect(a.x + b.x).toBeCloseTo(ARENA.centerX * 2);
    expect(a.y + b.y).toBeCloseTo(ARENA.centerY * 2);
  });
});
