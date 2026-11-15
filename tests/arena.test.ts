import { describe, expect, it } from "vitest";
import { ARENA, projectArena } from "../src/core/arena";

describe("arena projection", () => {
  it("projects origin to center", () => expect(projectArena(0, 0)).toEqual({ x: ARENA.centerX, y: ARENA.centerY }));

  it.each([
    { name: "+x", x: 100, y: 0, screenX: 545, screenY: 332 },
    { name: "-x", x: -100, y: 0, screenX: 415, screenY: 268 },
    { name: "+y", x: 0, y: 100, screenX: 415, screenY: 332 },
    { name: "-y", x: 0, y: -100, screenX: 545, screenY: 268 },
  ])("projects the $name axis with the expected direction and scale", ({ x, y, screenX, screenY }) => {
    const projected = projectArena(x, y);
    expect(projected.x).toBeCloseTo(screenX);
    expect(projected.y).toBeCloseTo(screenY);
  });

  const halfWidth = ARENA.width / 2;
  const halfDepth = ARENA.depth / 2;

  it.each([
    { name: "top", x: -halfWidth, y: -halfDepth, screenX: 395.5, screenY: 124 },
    { name: "right", x: halfWidth, y: -halfDepth, screenX: 837.5, screenY: 341.6 },
    { name: "bottom", x: halfWidth, y: halfDepth, screenX: 564.5, screenY: 476 },
    { name: "left", x: -halfWidth, y: halfDepth, screenX: 122.5, screenY: 258.4 },
  ])("projects the arena's $name corner to its expected screen position", ({ x, y, screenX, screenY }) => {
    const projected = projectArena(x, y);
    expect(projected.x).toBeCloseTo(screenX);
    expect(projected.y).toBeCloseTo(screenY);
  });

  it("projects opposite corners symmetrically", () => {
    const a = projectArena(100, 50), b = projectArena(-100, -50);
    expect(a.x + b.x).toBeCloseTo(ARENA.centerX * 2);
    expect(a.y + b.y).toBeCloseTo(ARENA.centerY * 2);
  });
});
