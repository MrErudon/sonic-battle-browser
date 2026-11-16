import { describe, expect, it } from "vitest";
import { CpuController, CPU_PRESETS, pursuitInput, seededRandom } from "../src/core/cpu";
import { createCombatFighter, facingVector, stepCombat } from "../src/core/combat";
import { DIRECTIONS, NO_INPUT } from "../src/core/movement";
import { ARENA } from "../src/core/arena";

const config = { ...CPU_PRESETS.Normal, reactionFrames: 3, pauseChance: 0, aerialChance: 0 };
function pair(distance = 44) {
  const d = facingVector("e");
  return [createCombatFighter("cpu", 0, 0, "e"), createCombatFighter("p1", d.x * distance, d.y * distance, "w")] as const;
}
function run(seed: number, preset = CPU_PRESETS.Normal, frames = 1200) {
  const cpu = new CpuController(preset, seed), [self, target] = pair(200);
  const trace = [];
  let attacks = 0, damage = 0, heavy = 0, aerial = 0;
  for (let i = 0; i < frames; i++) {
    const input = cpu.tick(self, target);
    if (input.attack) { attacks++; if (input.attack === "heavy") heavy++; if (input.jump) aerial++; }
    const hits = stepCombat([self, target], [input, NO_INPUT]);
    damage += hits.reduce((sum, hit) => sum + hit.damage, 0);
    trace.push([input, self.x, self.y, self.z, target.health]);
    // Renewable training target lets long simulations measure attack cadence.
    target.health = 100;
  }
  return { trace, attacks, damage, heavy, aerial, self, target };
}

describe("CPU legal movement", () => {
  it.each(DIRECTIONS)("converts arena pursuit to screen direction %s", (facing) => {
    const d = facingVector(facing), self = createCombatFighter("cpu", 0, 0);
    const input = pursuitInput(self, { x: d.x * 150, y: d.y * 150 });
    stepCombat([self], [input]);
    expect(self.facing).toBe(facing);
    expect(self.x * d.x + self.y * d.y).toBeGreaterThan(0);
  });
  it.each([[-324, -194], [-324, 194], [324, -194], [324, 194]])("pursues out of corner %s,%s and damages P1", (x, y) => {
    const self = createCombatFighter("cpu", x, y), target = createCombatFighter("p1", -x, -y);
    const cpu = new CpuController(config, 1);
    for (let i = 0; i < 1000; i++) {
      stepCombat([self, target], [cpu.tick(self, target), NO_INPUT]);
      expect(Math.abs(self.x)).toBeLessThanOrEqual(ARENA.width / 2 - self.stats.movement.radius);
      expect(Math.abs(self.y)).toBeLessThanOrEqual(ARENA.depth / 2 - self.stats.movement.radius);
    }
    expect(target.health).toBeLessThan(100);
  });
  it("settles inside the spacing band without jitter", () => {
    const [self, target] = pair();
    const cpu = new CpuController({ ...config, pauseChance: 1 }, 1);
    for (let i = 0; i < 200; i++) {
      const input = cpu.tick(self, target);
      expect(input).toEqual(NO_INPUT);
      stepCombat([self, target], [input, NO_INPUT]);
    }
    expect(self.x).toBe(0);
  });
  it("turns toward an opponent behind it before attacking", () => {
    const [self, target] = pair(); self.facing = "w";
    const cpu = new CpuController(config, 1);
    let attacked = false;
    for (let i = 0; i < 30; i++) {
      const input = cpu.tick(self, target);
      if (input.attack) { expect(self.facing).toBe("e"); attacked = true; }
      stepCombat([self, target], [input, NO_INPUT]);
    }
    expect(attacked).toBe(true);
  });
});

describe("CPU decisions", () => {
  it("does not attack backwards even when hurtboxes overlap", () => {
    const [self, target] = pair(10); self.facing = "w";
    const cpu = new CpuController(config);
    for (let i = 0; i < 30; i++) expect(cpu.tick(self, target).attack).toBeUndefined();
  });
  it("does not attack a vertically separated target", () => {
    const [self, target] = pair(); target.z = 200;
    const cpu = new CpuController(config);
    for (let i = 0; i < 30; i++) expect(cpu.tick(self, target).attack).toBeUndefined();
  });
  it("reacquires a target that crosses to the opposite side", () => {
    const [self, target] = pair(120); const cpu = new CpuController(config);
    for (let i = 0; i < 40; i++) stepCombat([self, target], [cpu.tick(self, target), NO_INPUT]);
    target.x = -180; target.y = 100;
    const before = Math.hypot(target.x - self.x, target.y - self.y);
    for (let i = 0; i < 120; i++) stepCombat([self, target], [cpu.tick(self, target), NO_INPUT]);
    expect(Math.hypot(target.x - self.x, target.y - self.y)).toBeLessThan(before);
    expect(target.health).toBeLessThan(100);
  });
  it("does not mutate fighters or emit out-of-range attacks", () => {
    const [self, target] = pair(250), before = structuredClone([self, target]);
    const cpu = new CpuController(config);
    for (let i = 0; i < 100; i++) expect(cpu.tick(self, target).attack).toBeUndefined();
    expect([self, target]).toEqual(before);
  });
  it("waits the configured reaction delay before movement and before attacking", () => {
    const [self, target] = pair(); const cpu = new CpuController(config);
    for (let i = 0; i < config.reactionFrames * 2; i++) expect(cpu.tick(self, target)).toEqual(NO_INPUT);
    expect(cpu.tick(self, target).attack).toBeDefined();
    const far = new CpuController(config); target.x = 250;
    for (let i = 0; i < config.reactionFrames; i++) expect(far.tick(self, target)).toEqual(NO_INPUT);
    expect(far.tick(self, target)).not.toEqual(NO_INPUT);
  });
  it("limits attack frequency even when a caller leaves the fighter ready", () => {
    const [self, target] = pair(); const cpu = new CpuController(config);
    const frames: number[] = [];
    for (let i = 0; i < 300; i++) if (cpu.tick(self, target).attack) frames.push(i);
    expect(frames.length).toBeGreaterThan(1);
    for (let i = 1; i < frames.length; i++) expect(frames[i] - frames[i - 1]).toBeGreaterThanOrEqual(config.attackInterval);
  });
  it("respects startup, active, recovery, cooldown, landing and hitstun then resumes", () => {
    const [self, target] = pair(), cpu = new CpuController(config);
    stepCombat([self], [{ ...NO_INPUT, attack: "heavy" }]);
    for (let i = 0; i < 36; i++) {
      expect(cpu.tick(self, target)).toEqual(NO_INPUT); stepCombat([self], [NO_INPUT]);
    }
    self.action = { type: "hitstun", remaining: 6 }; self.cooldown = 10;
    for (let i = 0; i < 10; i++) {
      expect(cpu.tick(self, target)).toEqual(NO_INPUT); stepCombat([self], [NO_INPUT]);
    }
    self.state = "landing"; self.landingRemaining = 6;
    expect(cpu.tick(self, target)).toEqual(NO_INPUT);
    for (let i = 0; i < 6; i++) stepCombat([self], [NO_INPUT]);
    let resumed = false;
    for (let i = 0; i < 60; i++) if (cpu.tick(self, target).attack) resumed = true;
    expect(resumed).toBe(true);
  });
  it("stops after either fighter is KO", () => {
    const [self, target] = pair(), cpu = new CpuController(config);
    target.health = 0;
    for (let i = 0; i < 100; i++) expect(cpu.tick(self, target)).toEqual(NO_INPUT);
    target.health = 100; self.health = 0;
    expect(cpu.tick(self, target)).toEqual(NO_INPUT);
  });
  it("rejects invalid tuning", () => {
    expect(() => new CpuController({ ...config, reactionFrames: 0 })).toThrow();
    expect(() => new CpuController({ ...config, heavyChance: 2 })).toThrow();
    expect(() => new CpuController({ ...config, spacing: NaN })).toThrow();
  });
  it("replays exactly for the same seed and diverges for different seeds", () => {
    expect(run(42)).toEqual(run(42));
    expect(run(42).trace).not.toEqual(run(43).trace);
    const a = seededRandom(0), b = seededRandom(0);
    for (let i = 0; i < 100; i++) { const value = a(); expect(value).toBe(b()); expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThan(1); }
  });
  it("makes all difficulties damage P1 with distinct deterministic cadence", () => {
    const easy = run(5, CPU_PRESETS.Easy, 3600), normal = run(5, CPU_PRESETS.Normal, 3600), hard = run(5, CPU_PRESETS.Hard, 3600);
    expect(easy.damage).toBeGreaterThan(0);
    expect(normal.attacks).toBeGreaterThan(easy.attacks);
    expect(hard.attacks).toBeGreaterThan(normal.attacks);
    expect(hard.heavy).toBeGreaterThan(easy.heavy);
    expect(hard.aerial).toBeGreaterThan(0);
  });
  it("can use both attack types and aerial attacks via normal combat", () => {
    const result = run(3, { ...config, aerialChance: 1 }, 1200);
    expect(result.aerial).toBeGreaterThan(0);
    expect(result.heavy).toBeGreaterThan(0);
    expect(result.attacks).toBeGreaterThan(result.heavy);
  });
});
