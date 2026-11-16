import { describe, expect, it } from "vitest";
import { attackOverlaps, attackPhase, createCombatFighter, DEFAULT_FIGHTER_STATS, facingVector, stepCombat, type AttackAction, type AttackKind, type CombatFighter } from "../src/core/combat";
import { ARENA } from "../src/core/arena";
import { createFighter, DIRECTIONS, NO_INPUT, stepFighter } from "../src/core/movement";

const press = (attack: AttackKind) => ({ ...NO_INPUT, attack });
function pair(distance = 45) {
  const d = facingVector("e");
  return [createCombatFighter("P1", 0, 0, "e"), createCombatFighter("P2", d.x * distance, d.y * distance, "w")] as const;
}
function ticks(f: readonly CombatFighter[], n: number) { for (let i = 0; i < n; i++) stepCombat(f, []); }
function start(f: CombatFighter, kind: AttackKind = "light") { stepCombat([f], [press(kind)]); return f.action as AttackAction; }

describe("combat timing and input rules", () => {
  it.each(["light", "heavy"] as const)("has exact non-overlapping %s phases and cooldown", kind => {
    const [p] = pair(), a = start(p, kind), s = a.stats;
    const phases = [];
    for (let frame = 1; frame <= s.startup + s.active + s.recovery; frame++) {
      expect(p.action).toMatchObject({ type: "attack", frame });
      phases.push(attackPhase(p.action as AttackAction));
      stepCombat([p], [press(kind)]);
    }
    expect(phases.filter(p => p === "startup")).toHaveLength(s.startup);
    expect(phases.filter(p => p === "active")).toHaveLength(s.active);
    expect(phases.filter(p => p === "recovery")).toHaveLength(s.recovery);
    expect(p.action.type).toBe("ready");
    for (let i = 0; i < s.cooldown; i++) { stepCombat([p], [press(kind)]); expect(p.action.type).toBe("ready"); }
    stepCombat([p], [press(kind)]); expect(p.action).toMatchObject({ type: "attack", frame: 1 });
  });
  it("does not damage during startup; damages exactly on first active tick", () => {
    const f = pair(); stepCombat(f, [press("light")]); ticks(f, 4);
    expect(f[1].health).toBe(100);
    const events = stepCombat(f, []);
    expect(f[1].health).toBe(95); expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ attackerId: "P1", defenderId: "P2", damage: 5 });
  });
  it("cannot damage during recovery", () => {
    const [p, q] = pair(300); start(p); ticks([p, q], 8);
    Object.assign(q, { x: 10, y: -10 }); ticks([p, q], 10);
    expect(q.health).toBe(100);
  });
  it("a single attack damages a target once even if it leaves and re-enters", () => {
    const f = pair(); start(f[0]); ticks(f, 5); expect(f[1].health).toBe(95);
    f[1].x = 300; ticks(f, 1); Object.assign(f[1], { x: 20, y: -20 }); ticks(f, 1);
    expect(f[1].health).toBe(95);
    ticks(f, 30); Object.assign(f[1], { x: 20, y: -20, knockbackX: 0, knockbackY: 0 });
    stepCombat(f, [press("light")]); ticks(f, 5); expect(f[1].health).toBe(90);
  });
  it("heavy deals more damage and knockback than light", () => {
    const light = pair(), heavy = pair(); start(light[0]); start(heavy[0], "heavy");
    ticks(light, 5); ticks(heavy, 12);
    expect(heavy[1].health).toBe(85); expect(light[1].health).toBe(95);
    expect(Math.hypot(heavy[1].knockbackX, heavy[1].knockbackY)).toBeGreaterThan(Math.hypot(light[1].knockbackX, light[1].knockbackY));
    expect(heavy[1].state).toBe("jump");
  });
  it.each(["light", "heavy"] as const)("selects configurable aerial %s while preserving gravity and landing", kind => {
    const [p] = pair(); stepCombat([p], [{ ...press(kind), jump: true }]);
    expect(p.action).toMatchObject({ type: "attack", airborne: true, stats: p.stats.attacks.air[kind] });
    expect(p.state).toBe("jump"); ticks([p], 120);
    expect(p.z).toBe(0); expect(p.state).toBe("idle"); expect(p.action.type).toBe("ready");
  });
  it("discarded landing attacks do not start later", () => {
    const [p] = pair(); p.state = "landing"; p.landingRemaining = 3;
    stepCombat([p], [press("light")]); ticks([p], 20); expect(p.action.type).toBe("ready");
  });
});

describe("arena-space geometry", () => {
  it.each(DIRECTIONS)("aims correctly for %s, missing behind and to the side", facing => {
    const p = createCombatFighter("P1", 0, 0, facing), q = createCombatFighter("P2", 0, 0);
    const a = start(p), d = facingVector(facing);
    q.x = d.x * 45; q.y = d.y * 45; expect(attackOverlaps(p, q, a)).toBe(true);
    q.x = -d.x * 45; q.y = -d.y * 45; expect(attackOverlaps(p, q, a)).toBe(false);
    q.x = -d.y * 80; q.y = d.x * 80; expect(attackOverlaps(p, q, a)).toBe(false);
  });
  it("uses circular hurtbox against rectangle corners, not an inflated square", () => {
    const [p, q] = pair(), a = start(p), d = facingVector(p.facing);
    const forward = a.stats.reach + 15, side = a.stats.width / 2 + 15;
    q.x = d.x * forward - d.y * side; q.y = d.y * forward + d.x * side;
    expect(attackOverlaps(p, q, a)).toBe(false);
  });
  it("respects reach and inclusive edge contact", () => {
    const p = createCombatFighter("P1", 0, 0, "se"), q = createCombatFighter("P2", 0, 0);
    const a = start(p), d = facingVector(p.facing);
    q.x = d.x * 75; q.y = d.y * 75; expect(attackOverlaps(p, q, a)).toBe(false);
    q.x = d.x * 73; q.y = d.y * 73; expect(attackOverlaps(p, q, a)).toBe(true);
    // Vertical interval boundaries are exact and inclusive.
    q.z = a.stats.bottom + a.stats.height; expect(attackOverlaps(p, q, a)).toBe(true);
    q.z += 0.01; expect(attackOverlaps(p, q, a)).toBe(false);
  });
  it("misses high airborne targets and connects at matching jump heights", () => {
    const [p, q] = pair(), a = start(p); q.z = 100;
    expect(attackOverlaps(p, q, a)).toBe(false);
    p.z = 100; expect(attackOverlaps(p, q, a)).toBe(true);
    q.z = 0; expect(attackOverlaps(p, q, a)).toBe(false);
  });
  it("hits multiple targets once each, excluding self", () => {
    const [p, q] = pair(); const r = createCombatFighter("P3", q.x, q.y);
    start(p); ticks([p, q, r], 7);
    expect([p.health, q.health, r.health]).toEqual([100, 95, 95]);
  });
});

describe("damage, interruption and movement regression", () => {
  it.each(["light", "heavy"] as const)("aerial %s hits at matching heights using its own damage", kind => {
    const [p, q] = pair();
    for (const f of [p, q]) Object.assign(f, { z: 60, vz: 100, state: "jump" });
    stepCombat([p, q], [press(kind)]);
    const stats = p.stats.attacks.air[kind]; ticks([p, q], stats.startup);
    expect(q.health).toBe(100 - stats.damage);
  });
  it("landing during aerial recovery does not cancel the action or unlock new attacks", () => {
    const [p] = pair(); Object.assign(p, { z: 2, vz: 0, state: "jump" }); start(p);
    ticks([p], 10); expect(p.z).toBe(0);
    expect(p.action).toMatchObject({ type: "attack", airborne: true, frame: 11 });
    stepCombat([p], [press("heavy")]);
    expect(p.action).toMatchObject({ type: "attack", kind: "light", frame: 12 });
  });
  it("a launch during landing clears landing lock so gravity resumes immediately", () => {
    const [p, q] = pair(); start(p, "heavy"); ticks([p], 11);
    q.state = "landing"; q.landingRemaining = 5; ticks([p, q], 1);
    expect(q).toMatchObject({ state: "jump", landingRemaining: 0 });
    ticks([p, q], 1); expect(q.z).toBeGreaterThan(0);
    ticks([p, q], 120); expect(q.z).toBe(0);
  });
  it("ground attacks lock movement and reject jump until recovery finishes", () => {
    const [p] = pair(); start(p);
    for (let i = 0; i < 17; i++) stepCombat([p], [{ x: 1, y: 1, jump: true }]);
    expect(p).toMatchObject({ x: 0, y: 0, z: 0, facing: "e" });
    stepCombat([p], [{ x: 1, y: 1, jump: true }]); expect(p.z).toBeGreaterThan(0);
  });
  it("each repeated attack has an escape interval longer than its hitstun", () => {
    for (const mode of ["ground", "air"] as const) for (const kind of ["light", "heavy"] as const) {
      const a = DEFAULT_FIGHTER_STATS.attacks[mode][kind];
      expect(a.startup + a.active + a.recovery + a.cooldown).toBeGreaterThan(a.hitstun);
    }
  });
  it("interrupts startup and prevents the interrupted attack from hitting", () => {
    const f = pair(); stepCombat(f, [press("light"), press("heavy")]); ticks(f, 5);
    expect(f[1].action).toMatchObject({ type: "hitstun", remaining: 12 });
    ticks(f, 30); expect(f[0].health).toBe(100);
  });
  it("simultaneous active attacks trade regardless of fighter order", () => {
    const run = (reverse: boolean) => {
      const f = pair(); stepCombat(reverse ? [...f].reverse() : f, [press("light"), press("light")]);
      ticks(reverse ? [...f].reverse() : f, 5); return f.map(p => ({ health: p.health, action: p.action }));
    };
    expect(run(false)).toEqual(run(true)); expect(run(false).map(f => f.health)).toEqual([95, 95]);
  });
  it("hitstun lasts exactly the configured ticks and blocks movement/jump/attacks", () => {
    const [p] = pair(); p.action = { type: "hitstun", remaining: 3 };
    for (let i = 0; i < 3; i++) stepCombat([p], [{ x: 1, y: 1, jump: true, attack: "heavy" }]);
    expect(p).toMatchObject({ x: 0, y: 0, z: 0, action: { type: "ready" } });
    stepCombat([p], [{ x: 1, y: 1, jump: true }]); expect(p.z).toBeGreaterThan(0);
  });
  it("KO clamps health, prevents control and further hits, but gravity finishes", () => {
    const f = pair(); f[1].health = 2; start(f[0], "heavy"); ticks(f, 12);
    expect(f[1].health).toBe(0); expect(f[1].action.type).toBe("ko");
    for (let i = 0; i < 120; i++) stepCombat(f, [press("heavy"), { x: 1, y: 1, jump: true, attack: "light" }]);
    expect(f[1].health).toBe(0); expect(f[1].z).toBe(0); expect(f[1].action.type).toBe("ko");
  });
  it.each([[1, 1], [-1, -1], [1, -1], [-1, 1]])("clamps knockback at arena corner %s,%s without breaking gravity", (x, y) => {
    const [p] = pair(); p.x = x * (ARENA.width / 2 - 16); p.y = y * (ARENA.depth / 2 - 16);
    p.knockbackX = x * 1000; p.knockbackY = y * 1000; p.state = "jump"; p.vz = 180;
    p.action = { type: "hitstun", remaining: 24 }; ticks([p], 180);
    expect(Math.abs(p.x)).toBeLessThanOrEqual(ARENA.width / 2 - 16);
    expect(Math.abs(p.y)).toBeLessThanOrEqual(ARENA.depth / 2 - 16);
    expect(p.z).toBe(0); expect(p.vz).toBe(0); expect(p.knockbackX).toBe(0);
  });
  it("matches the original movement for an uninterrupted movement/jump sequence", () => {
    const p = createCombatFighter("P1", 0, 0), baseline = createFighter(0, 0);
    for (let i = 0; i < 300; i++) {
      const input = { x: i % 5 - 2, y: i % 7 - 3, jump: i % 39 === 0 };
      stepCombat([p], [input]); stepFighter(baseline, input);
      for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) expect(p[key]).toEqual(baseline[key]);
    }
  });
  it("locks attack facing while allowing aerial steering", () => {
    const [p] = pair(); stepCombat([p], [{ ...press("light"), jump: true }]);
    const x = p.x; stepCombat([p], [{ x: -1, y: 0, jump: false }]);
    expect(p.x).toBeLessThan(x); expect(p.facing).toBe("e");
    expect(p.action).toMatchObject({ facing: "e" });
  });
  it("accepts per-fighter stats without mutating defaults", () => {
    const stats = { ...DEFAULT_FIGHTER_STATS, maxHealth: 200, attacks: { ...DEFAULT_FIGHTER_STATS.attacks,
      ground: { ...DEFAULT_FIGHTER_STATS.attacks.ground, light: { ...DEFAULT_FIGHTER_STATS.attacks.ground.light, damage: 23 } } } };
    const p = createCombatFighter("P1", 0, 0, "e", stats), [, q] = pair();
    expect(p.health).toBe(200); start(p); ticks([p, q], 5);
    expect(q.health).toBe(77); expect(DEFAULT_FIGHTER_STATS.attacks.ground.light.damage).toBe(5);
  });
});
