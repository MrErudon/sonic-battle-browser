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

// Every regression advances the real combat simulation; no frozen fighter mocks.
describe("CPU starvation full simulation regressions", () => {
  const seeds = [0, 1, 5, 42, 255];
  const cases = Object.entries(CPU_PRESETS).flatMap(([name, preset]) => seeds.map(seed => ({ name, preset, seed })));
  it.each(cases)("$name seed $seed resumes after five seconds jumping", ({ preset, seed }) => {
    const simulate = () => {
      const self = createCombatFighter("P2", 100, 0, "w");
      const target = createCombatFighter("P1", -100, 0, "e");
      const cpu = new CpuController(preset, seed);
      const trace = [];
      let firstAttack = -1, firstHit = -1;
      for (let tick = 0; tick < 2100; tick++) {
        const input = cpu.tick(self, target);
        if (tick >= 300 && input.attack && firstAttack < 0) firstAttack = tick - 300;
        const hits = stepCombat([target, self], [{ ...NO_INPUT, jump: tick < 300 && target.z === 0 }, input]);
        if (tick >= 300 && hits.some(hit => hit.attackerId === "P2") && firstHit < 0) firstHit = tick - 300;
        trace.push([input, structuredClone(self), structuredClone(target)]);
      }
      expect(firstAttack).toBeGreaterThanOrEqual(0);
      expect(firstAttack).toBeLessThanOrEqual(600);
      expect(firstHit).toBeGreaterThanOrEqual(0);
      expect(firstHit).toBeLessThanOrEqual(720);
      return trace;
    };
    expect(simulate()).toEqual(simulate());
  });
  it.each(cases)("$name seed $seed resolves overlap and vertical separation", ({ preset, seed }) => {
    for (const distance of [0, 0.01, 1, 3, 10, 44]) {
      for (const facing of DIRECTIONS) {
        const [self, target] = pair(distance); self.facing = facing;
        target.z = 200; target.state = "jump";
        const cpu = new CpuController(preset, seed);
        let attack = -1, hit = -1, corrections = 0;
        for (let tick = 0; tick < 720; tick++) {
          const before = structuredClone([self, target]);
          const input = cpu.tick(self, target);
          expect([self, target]).toEqual(before);
          if (tick < 30 && (input.x || input.y)) corrections++;
          if (input.attack && attack < 0) attack = tick;
          const hits = stepCombat([self, target], [input, NO_INPUT]);
          if (hits.length && hit < 0) hit = tick;
        }
        expect(corrections, `stable facing ${distance}/${facing}`).toBeLessThanOrEqual(2);
        expect(attack, `${distance}/${facing}`).toBeGreaterThanOrEqual(0);
        expect(attack).toBeLessThanOrEqual(600);
        expect(hit).toBeGreaterThanOrEqual(0);
        expect(hit).toBeLessThanOrEqual(720);
      }
    }
  });
  it.each(cases)("$name seed $seed resumes after real heavy hitstun and knockback", ({ preset, seed }) => {
    const [self, target] = pair(); self.facing = "e";
    const cpu = new CpuController(preset, seed);
    let stunned = false, knocked = false, resumed = -1;
    for (let tick = 0; tick < 720; tick++) {
      const locked = self.action.type !== "ready" || self.cooldown > 0 || self.state === "landing";
      // Start CPU in ordinary heavy recovery; P1's heavy interrupts it.
      const input = tick === 0 ? { ...NO_INPUT, attack: "heavy" as const } : cpu.tick(self, target);
      if (tick > 0 && locked) expect(input).toEqual(NO_INPUT);
      if (stunned && input.attack && resumed < 0) resumed = tick;
      stepCombat([self, target], [input, { ...NO_INPUT, attack: tick === 0 ? "heavy" : undefined }]);
      stunned ||= self.action.type === "hitstun";
      knocked ||= Math.hypot(self.knockbackX, self.knockbackY) > 0;
    }
    expect(stunned).toBe(true); expect(knocked).toBe(true);
    expect(resumed).toBeGreaterThan(0); expect(resumed).toBeLessThanOrEqual(600);
  });
});
