import { describe, expect, it } from "vitest";
import { COUNTDOWN_TICKS, MatchController, ROUND_OVER_TICKS, type RoundResult } from "../src/core/match";
import { createCombatFighter, facingVector, type AttackAction } from "../src/core/combat";
import { CPU_PRESETS, type Difficulty } from "../src/core/cpu";

const ticks = (m: MatchController, count: number) => { for (let i = 0; i < count; i++) m.tick(); };
const tap = (m: MatchController, code: string) => { m.press(code); m.release(code); };
function fighting(difficulty: Difficulty = "Normal", seed = 1) {
  const m = new MatchController(seed); m.selectDifficulty(difficulty); m.start(); ticks(m, COUNTDOWN_TICKS); return m;
}
// Arrange active legal combat contacts, not a synthetic round-end command.
function ko(m: MatchController, result: RoundResult) {
  const [p, c] = m.fighters, d = facingVector("e");
  Object.assign(p, createCombatFighter("P1", 0, 0, "e"));
  Object.assign(c, createCombatFighter("P2", d.x * 30, d.y * 30, "w"));
  for (const f of m.fighters) {
    f.health = 5;
    if (result === "Draw" || f.id === result) {
      f.action = { type: "attack", kind: "light", airborne: false, frame: f.stats.attacks.ground.light.startup,
        facing: f.facing, stats: f.stats.attacks.ground.light, hitTargets: new Set() } satisfies AttackAction;
    }
  }
  return m.tick();
}

describe("match rules and transitions", () => {
  it("starts at Menu with full health and zero score; Menu never runs combat", () => {
    const m = new MatchController(), initial = structuredClone(m.fighters);
    for (let i = 0; i < 1000; i++) { tap(m, "KeyK"); m.tick(); }
    expect(m.state).toBe("Menu"); expect(m.score).toEqual([0, 0]); expect(m.fighters).toEqual(initial);
  });
  it("counts exactly 180 ticks, gates both fighters, requires new input after Fight", () => {
    const m = new MatchController(); m.start(); const initial = structuredClone(m.fighters);
    m.press("KeyD"); m.press("KeyJ"); m.press("Space");
    ticks(m, COUNTDOWN_TICKS - 1);
    expect(m.state).toBe("Countdown"); expect(m.ticksRemaining).toBe(1); expect(m.fighters).toEqual(initial);
    m.tick(); expect(m.state).toBe("Fighting"); m.tick();
    expect(m.fighters[0]).toEqual(initial[0]);
    m.press("KeyD", true); m.tick(); expect(m.fighters[0].x).toBe(-100);
    m.release("KeyD"); m.press("KeyD"); m.tick(); expect(m.fighters[0].x).toBeGreaterThan(-100);
  });
  it.each(["P1", "P2"] as const)("awards %s one round only and freezes the KO pose", winner => {
    const m = fighting(), hits = ko(m, winner), pose = structuredClone(m.fighters);
    expect(hits).toHaveLength(1); expect(m.state).toBe("Round Over"); expect(m.result).toBe(winner);
    expect(m.score).toEqual(winner === "P1" ? [1, 0] : [0, 1]);
    for (let i = 0; i < ROUND_OVER_TICKS - 1; i++) { tap(m, "KeyK"); m.tick(); }
    expect(m.fighters).toEqual(pose); expect(m.state).toBe("Round Over");
    m.tick(); expect(m.state).toBe("Countdown"); expect(m.round).toBe(2);
    expect(m.fighters).toEqual([createCombatFighter("P1", -100, 0, "e"), createCombatFighter("P2", 100, 0, "w")]);
  });
  it("simultaneous legal hits draw, replay same round and seed, and award no points", () => {
    const m = fighting("Hard", 42), initialVersion = m.resetVersion;
    expect(ko(m, "Draw")).toHaveLength(2);
    expect(m.result).toBe("Draw"); expect(m.score).toEqual([0, 0]);
    ticks(m, ROUND_OVER_TICKS);
    expect(m.round).toBe(1); expect(m.state).toBe("Countdown"); expect(m.result).toBeUndefined();
    expect(m.resetVersion).toBe(initialVersion + 1); expect(m.seed).toBe(42);
    expect(m.fighters.map(f => f.health)).toEqual([100, 100]);
  });
  it.each([["P1", "P1"], ["P2", "P2"], ["P1", "P2", "P1"], ["P2", "P1", "P2"]] as const)("best of three %j", (...winners) => {
    const m = fighting();
    for (const winner of winners) {
      ko(m, winner); expect(m.state).toBe("Round Over"); ticks(m, ROUND_OVER_TICKS);
      if (m.state === "Countdown") ticks(m, COUNTDOWN_TICKS);
    }
    expect(m.state).toBe("Match Over"); expect(m.winner).toBe(winners.at(-1)); expect(m.round).toBe(winners.length);
    const snapshot = structuredClone(m.fighters); ticks(m, 500);
    expect(m.fighters).toEqual(snapshot); expect(Math.max(...m.score)).toBe(2);
  });
  it("a draw at match point cannot end or advance the match", () => {
    const m = fighting(); ko(m, "P1"); ticks(m, ROUND_OVER_TICKS + COUNTDOWN_TICKS);
    ko(m, "Draw"); ticks(m, ROUND_OVER_TICKS);
    expect(m.score).toEqual([1, 0]); expect(m.round).toBe(2); expect(m.winner).toBeUndefined();
    expect(m.state).toBe("Countdown");
  });
  it.each(Object.keys(CPU_PRESETS) as Difficulty[])("%s rematch resets everything and preserves difficulty", difficulty => {
    const m = fighting(difficulty, 0);
    ko(m, "P2"); ticks(m, ROUND_OVER_TICKS + COUNTDOWN_TICKS); ko(m, "P2"); ticks(m, ROUND_OVER_TICKS);
    tap(m, "KeyK"); m.press("KeyD"); m.start();
    expect(m.state).toBe("Countdown"); expect(m.round).toBe(1); expect(m.score).toEqual([0, 0]);
    expect(m.winner).toBeUndefined(); expect(m.result).toBeUndefined(); expect(m.difficulty).toBe(difficulty);
    expect(m.cpuConfig).toEqual(CPU_PRESETS[difficulty]); expect(m.fighters.map(f => f.health)).toEqual([100, 100]);
    ticks(m, COUNTDOWN_TICKS + 1); expect(m.fighters[0]).toEqual(createCombatFighter("P1", -100, 0, "e"));
  });
  it.each(["Menu", "Countdown", "Fighting", "Round Over", "Match Over"] as const)("return to menu from %s resets match", state => {
    const m = new MatchController(); m.selectDifficulty("Hard");
    if (state !== "Menu") m.start();
    if (["Fighting", "Round Over", "Match Over"].includes(state)) ticks(m, COUNTDOWN_TICKS);
    if (["Round Over", "Match Over"].includes(state)) ko(m, "P1");
    if (state === "Match Over") { ticks(m, ROUND_OVER_TICKS + COUNTDOWN_TICKS); ko(m, "P1"); ticks(m, ROUND_OVER_TICKS); }
    expect(m.state).toBe(state);
    tap(m, "KeyJ"); m.menu();
    expect(m.state).toBe("Menu"); expect(m.score).toEqual([0, 0]); expect(m.round).toBe(1);
    expect(m.difficulty).toBe("Hard"); expect(m.fighters.map(f => f.health)).toEqual([100, 100]);
    m.start(); ticks(m, COUNTDOWN_TICKS + 1); expect(m.fighters[0].action.type).toBe("ready");
  });
  it("ignores duplicate starts and difficulty changes outside Menu", () => {
    const m = fighting("Easy"); ko(m, "P1"); const before = structuredClone(m.fighters);
    m.start(); m.selectDifficulty("Hard");
    expect(m.state).toBe("Round Over"); expect(m.score).toEqual([1, 0]); expect(m.fighters).toEqual(before);
    expect(m.difficulty).toBe("Easy"); expect(m.cpuConfig).toEqual(CPU_PRESETS.Easy);
  });
  it("difficulty/controller change atomically on zero-tick selection, rapid changes and blur", () => {
    const m = new MatchController();
    for (const difficulty of ["Hard", "Easy", "Normal", "Hard"] as const) {
      m.selectDifficulty(difficulty); m.advance(0);
      expect(m.difficulty).toBe(difficulty); expect(m.cpuConfig).toEqual(CPU_PRESETS[difficulty]);
    }
    m.setFocused(false); m.start(); m.advance(100);
    expect(m.difficulty).toBe("Hard"); expect(m.ticksRemaining).toBe(COUNTDOWN_TICKS);
    m.setFocused(true); ticks(m, COUNTDOWN_TICKS); expect(m.cpuConfig).toEqual(CPU_PRESETS.Hard);
  });
});

describe("focus, help and input boundaries", () => {
  it.each(["Countdown", "Fighting", "Round Over", "Match Over"] as const)("blur pauses %s without catch-up or queued input", state => {
    const m = new MatchController(); m.start();
    if (state !== "Countdown") ticks(m, COUNTDOWN_TICKS);
    if (["Round Over", "Match Over"].includes(state)) ko(m, "P1");
    if (state === "Match Over") { ticks(m, ROUND_OVER_TICKS + COUNTDOWN_TICKS); ko(m, "P1"); ticks(m, ROUND_OVER_TICKS); }
    const snapshot = structuredClone(m.fighters), remaining = m.ticksRemaining;
    tap(m, "Space"); tap(m, "KeyK"); m.press("KeyD"); m.advance(4); m.setFocused(false);
    for (let i = 0; i < 60; i++) m.advance(1000);
    ticks(m, 50);
    expect(m.fighters).toEqual(snapshot); expect(m.state).toBe(state); expect(m.ticksRemaining).toBe(remaining);
    m.setFocused(true); m.advance(12); expect(m.fighters).toEqual(snapshot);
    m.advance(5); expect(m.fighters[0].action).toEqual(snapshot[0].action); expect(m.fighters[0].z).toBe(snapshot[0].z);
  });
  it("help pauses on the last countdown tick; held attacks never leak on close", () => {
    const m = new MatchController(); m.start(); ticks(m, COUNTDOWN_TICKS - 1);
    m.setHelp(true); m.press("KeyK"); m.press("KeyD"); ticks(m, 1000); m.setHelp(false); m.tick(); m.tick();
    expect(m.state).toBe("Fighting"); expect(m.fighters[0]).toEqual(createCombatFighter("P1", -100, 0, "e"));
    m.release("KeyK"); tap(m, "KeyK"); m.tick(); expect(m.fighters[0].action.type).toBe("attack");
  });
  it("focus cannot unpause an open help dialog", () => {
    const m = fighting(); m.setHelp(true); m.setFocused(false); m.setFocused(true);
    expect(m.paused).toBe(true); const initial = structuredClone(m.fighters); ticks(m, 100);
    expect(m.fighters).toEqual(initial); m.setHelp(false); expect(m.paused).toBe(false);
  });
  it("round-ending tick clears a queued jump and all held movement before next round", () => {
    const m = fighting(); m.press("KeyD"); tap(m, "Space"); ko(m, "P2");
    tap(m, "KeyK"); ticks(m, ROUND_OVER_TICKS + COUNTDOWN_TICKS + 1);
    expect(m.fighters[0]).toEqual(createCombatFighter("P1", -100, 0, "e"));
  });
  it("invalid deltas do nothing and stalls run at most six ticks", () => {
    const m = new MatchController(); m.start();
    for (const delta of [0, -100, NaN, Infinity]) m.advance(delta);
    expect(m.ticksRemaining).toBe(COUNTDOWN_TICKS);
    m.advance(60000); expect(m.ticksRemaining).toBe(COUNTDOWN_TICKS - 6);
  });
});

describe("full match determinism and CPU preservation", () => {
  const cases = (Object.keys(CPU_PRESETS) as Difficulty[]).flatMap(difficulty => [0, 1, 42].map(seed => ({ difficulty, seed })));
  it.each(cases)("$difficulty seed $seed completes a deterministic CPU match and replays after rematch", ({ difficulty, seed }) => {
    const m = fighting(difficulty, seed);
    const run = () => {
      const trace = [];
      for (let i = 0; i < 36000 && m.state !== "Match Over"; i++) {
        m.tick();
        trace.push([m.state, [...m.score], m.fighters.map(f => [f.x, f.y, f.z, f.health, f.facing, structuredClone(f.action)])]);
      }
      expect(m.state).toBe("Match Over"); expect(m.winner).toBe("P2"); expect(m.score).toEqual([0, 2]);
      return trace;
    };
    const first = run(); m.start(); ticks(m, COUNTDOWN_TICKS); expect(run()).toEqual(first);
  });
  it.each(cases)("$difficulty seed $seed still attacks after repeated jumping in match integration", ({ difficulty, seed }) => {
    const m = fighting(difficulty, seed);
    for (let i = 0; i < 300; i++) { if (m.fighters[0].z === 0) tap(m, "Space"); m.tick(); }
    const health = m.fighters[0].health;
    let hit = -1;
    for (let i = 0; i <= 720; i++) { m.tick(); if (m.fighters[0].health < health) { hit = i; break; } }
    expect(hit).toBeGreaterThanOrEqual(0); expect(hit).toBeLessThanOrEqual(720);
  });
  it.each([10, 30, 60, 144, 240])("%i Hz produces the same match as 60 Hz", hz => {
    const a = new MatchController(), b = new MatchController(); a.start(); b.start();
    for (let i = 0; i < hz * 20; i++) a.advance(1000 / hz);
    for (let i = 0; i < 60 * 20; i++) b.advance(1000 / 60);
    expect(a.fighters).toEqual(b.fighters); expect(a.state).toBe(b.state); expect(a.score).toEqual(b.score);
  });
});
