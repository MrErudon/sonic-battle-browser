import { describe, expect, it } from "vitest";
import { ARENA } from "../src/core/arena";
import { createFighter, DEFAULT_MOVEMENT as config, NO_INPUT, projectFighter, STEP, stepFighter } from "../src/core/movement";

const directions = [
  [0, -1, "n"], [1, -1, "ne"], [1, 0, "e"], [1, 1, "se"],
  [0, 1, "s"], [-1, 1, "sw"], [-1, 0, "w"], [-1, -1, "nw"],
] as const;

describe("fighter movement", () => {
  it.each(directions)("moves and faces screen direction (%i, %i) %s at normalized speed", (x, y, facing) => {
    const f = createFighter(0, 0);
    const before = projectFighter(f);
    for (let i = 0; i < 30; i++) stepFighter(f, { x, y, jump: false });
    expect(Math.hypot(f.x, f.y)).toBeCloseTo(config.speed / 2);
    const after = projectFighter(f);
    if (x === 0) expect(after.x).toBeCloseTo(before.x);
    else expect(Math.sign(after.x - before.x)).toBe(x);
    if (y === 0) expect(after.y).toBeCloseTo(before.y);
    else expect(Math.sign(after.y - before.y)).toBe(y);
    expect(f.facing).toBe(facing);
    expect(f.state).toBe("walk");
    stepFighter(f, NO_INPUT);
    expect(f.state).toBe("idle");
    expect(f.facing).toBe(facing);
  });

  it.each(directions)("clamps the footprint at boundaries for direction (%i, %i)", (x, y) => {
    const f = createFighter(0, 0);
    for (let i = 0; i < 600; i++) {
      stepFighter(f, { x, y, jump: i % 60 === 0 });
      expect(Math.abs(f.x)).toBeLessThanOrEqual(ARENA.width / 2 - config.radius);
      expect(Math.abs(f.y)).toBeLessThanOrEqual(ARENA.depth / 2 - config.radius);
    }
    expect(Math.abs(f.x) === ARENA.width / 2 - config.radius || Math.abs(f.y) === ARENA.depth / 2 - config.radius).toBe(true);
  });

  it("slides along an edge and stops walking when fully blocked", () => {
    const f = createFighter(ARENA.width / 2 - config.radius, 0);
    stepFighter(f, { x: 1, y: 0, jump: false });
    expect(f.x).toBe(324);
    expect(f.y).toBeLessThan(0);
    f.y = -194;
    stepFighter(f, { x: 1, y: 0, jump: false });
    expect(f.state).toBe("idle");
    expect(f.facing).toBe("e");
    stepFighter(f, { x: -1, y: 0, jump: false });
    expect(f.x).toBeLessThan(324);
    expect(f.y).toBeGreaterThan(-194);
  });

  it("honors speed, radius, jump, gravity and air-control overrides", () => {
    const custom = { ...config, speed: 120, radius: 30, jumpSpeed: 300, gravity: 600, airControl: 0.25 };
    const f = createFighter(0, 0);
    stepFighter(f, { x: 1, y: 1, jump: true }, custom);
    expect(Math.hypot(f.x, f.y)).toBeCloseTo(0.5);
    expect(f.vz).toBeCloseTo(290);
    expect(f.z).toBeCloseTo(300 * STEP - 300 * STEP ** 2);
    f.x = 340;
    stepFighter(f, NO_INPUT, custom);
    expect(f.x).toBe(310);
  });

  it("rises, falls, lands exactly at zero, locks recovery then returns to idle", () => {
    const f = createFighter(0, 0);
    stepFighter(f, { ...NO_INPUT, jump: true });
    expect(f.state).toBe("jump");
    expect(f.z).toBeGreaterThan(0);
    let fell = false;
    let peak = f.z;
    let frames = 1;
    while (f.state === "jump" && frames++ < 120) {
      const previous = f.z;
      stepFighter(f, NO_INPUT);
      fell ||= f.z < previous;
      peak = Math.max(peak, f.z);
      expect(f.z).toBeGreaterThanOrEqual(0);
    }
    expect(fell).toBe(true);
    expect(peak).toBeCloseTo(config.jumpSpeed ** 2 / (2 * config.gravity), 0);
    expect(frames).toBeLessThan(60);
    expect(f).toMatchObject({ z: 0, vz: 0, state: "landing", landingRemaining: 6 });
    for (let i = 0; i < 5; i++) {
      stepFighter(f, { x: 1, y: 0, jump: true });
      expect(f.state).toBe("landing");
      expect(f.x).toBe(0);
    }
    stepFighter(f, NO_INPUT);
    expect(f.state).toBe("idle");
  });

  it("steers in air at reduced speed and cannot double jump", () => {
    const f = createFighter(0, 0);
    stepFighter(f, { ...NO_INPUT, jump: true });
    const vz = f.vz;
    stepFighter(f, { x: -1, y: 0, jump: true });
    expect(f.vz).toBeCloseTo(vz - config.gravity * STEP);
    expect(Math.hypot(f.x, f.y)).toBeCloseTo(config.speed * config.airControl * STEP);
    expect(f.facing).toBe("w");
    const x = f.x, y = f.y;
    stepFighter(f, NO_INPUT);
    expect(f.x).toBe(x);
    expect(f.y).toBe(y);
  });

  it("returns to walk after recovery, then allows another jump", () => {
    const f = createFighter(0, 0);
    stepFighter(f, { ...NO_INPUT, jump: true });
    for (let i = 0; i < 60; i++) stepFighter(f, { x: 1, y: 0, jump: false });
    expect(f.state).toBe("walk");
    stepFighter(f, { ...NO_INPUT, jump: true });
    expect(f.state).toBe("jump");
  });

  it("supports zero landing recovery", () => {
    const f = createFighter(0, 0);
    const custom = { ...config, landingFrames: 0 };
    stepFighter(f, { ...NO_INPUT, jump: true }, custom);
    for (let i = 0; i < 45; i++) stepFighter(f, NO_INPUT, custom);
    expect(f.state).toBe("idle");
  });

  it("keeps an uncommanded second fighter stationary and is deterministic", () => {
    const a = createFighter(0, 0), b = createFighter(0, 0);
    const opponent = createFighter(100, 0, "w");
    const original = { ...opponent };
    for (let i = 0; i < 300; i++) {
      const input = { x: i % 3 - 1, y: i % 5 - 2, jump: i % 70 === 0 };
      stepFighter(a, input);
      stepFighter(b, input);
      stepFighter(opponent, NO_INPUT);
    }
    expect(a).toEqual(b);
    expect(opponent).toEqual(original);
  });
});

describe("fighter projection", () => {
  it("elevates only the body; shadow and depth stay anchored to the ground", () => {
    const f = createFighter(100, 50);
    const ground = projectFighter(f);
    f.z = 80;
    expect(projectFighter(f)).toEqual({ x: 512.5, y: 268, groundY: 348, depth: ground.depth });
  });
  it("sorts using projected ground depth, including while jumping past another fighter", () => {
    const a = createFighter(-100, 0), b = createFighter(0, 0);
    expect(projectFighter(a).depth).toBeLessThan(projectFighter(b).depth);
    a.x = 100;
    a.z = 100;
    expect(projectFighter(a).y).toBeLessThan(projectFighter(b).y);
    expect(projectFighter(a).depth).toBeGreaterThan(projectFighter(b).depth);
  });
});
