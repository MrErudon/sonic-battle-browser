import { beforeEach, describe, expect, it } from "vitest";
import { STEP } from "../src/core/movement";
import { createCombatFighter } from "../src/core/combat";
import { COUNTDOWN_TICKS, MatchController } from "../src/core/match";

describe("match input across render frames (M01.2–M01.4 regressions)", () => {
  let match: MatchController;
  const player = () => match.fighters[0];
  const frame = (ms = STEP * 1000) => match.advance(ms);
  const key = (type: string, repeat = false, code = "Space") => {
    if (type === "keydown") match.press(code, repeat);
    else match.release(code);
  };
  const tap = () => { key("keydown"); key("keyup"); };
  const blur = () => { match.setFocused(false); match.setFocused(true); };
  beforeEach(() => {
    match = new MatchController(); match.start();
    for (let i = 0; i < COUNTDOWN_TICKS; i++) match.tick();
    // Isolate keyboard regressions from independently tested CPU hits.
    Object.assign(match, { cpu: { tick: () => ({ x: 0, y: 0, jump: false }) } });
  });

  it("captures a Space press and release between rendered frames", () => {
    frame(); tap();
    expect(player().state).toBe("idle");
    frame();
    expect(player().state).toBe("jump");
    expect(player().z).toBeGreaterThan(0);
  });
  it("retains a press across high-refresh frames with no simulation tick", () => {
    tap();
    for (let i = 0; i < 3; i++) frame(1000 / 240);
    expect(player().state).toBe("idle");
    frame(1000 / 240);
    expect(player().state).toBe("jump");
  });
  it("consumes only on the first tick of a multi-tick render frame", () => {
    Object.assign(player(), { state: "landing", landingRemaining: 2 });
    tap(); frame(100);
    // First tick discards during recovery; a repeated input would jump on tick two.
    expect(player()).toMatchObject({ state: "idle", z: 0 });
  });
  it("suppresses held-key repeats, including after landing and blur", () => {
    key("keydown"); frame();
    for (let i = 0; i < 120; i++) { key("keydown", true); frame(); }
    expect(player().state).toBe("idle");
    blur();
    key("keydown", true); frame();
    expect(player().state).toBe("idle");
    key("keyup"); tap(); frame();
    expect(player().state).toBe("jump");
  });
  it("clears pending jump, held movement and partial tick on window blur", () => {
    tap(); key("keydown", false, "KeyD"); frame(5);
    blur();
    expect(match.input.consume().x).toBe(0);
    frame(12);
    expect(player()).toEqual(createCombatFighter("P1", -100, 0, "e"));
    frame();
    expect(player().state).toBe("idle");
  });
  it("never turns a single press into multiple jumps", () => {
    tap();
    let jumps = 0;
    for (let i = 0; i < 180; i++) {
      const before = player().state; frame();
      if (before !== "jump" && player().state === "jump") jumps++;
    }
    expect(jumps).toBe(1);
    expect(player().state).toBe("idle");
  });
  it("discards airborne presses instead of buffering until grounded", () => {
    tap(); frame(); tap(); frame();
    for (let i = 0; i < 120; i++) frame();
    expect(player().state).toBe("idle");
  });
  it("ignores other keys and coalesces taps before the next tick", () => {
    key("keydown", false, "Enter"); frame();
    expect(player().state).toBe("idle");
    tap(); tap(); frame();
    expect(player().state).toBe("jump");
    for (let i = 0; i < 120; i++) frame();
    expect(player().state).toBe("idle");
  });
  it.each(["KeyJ", "KeyK"])("captures short %s taps between frames and retains them without a tick", code => {
    key("keydown", false, code); key("keyup", false, code);
    frame(4); frame(4); frame(4);
    expect(player().action.type).toBe("ready");
    frame(5);
    expect(player().action).toMatchObject({ type: "attack", kind: code === "KeyJ" ? "light" : "heavy", frame: 1 });
  });
  it("consumes attack edges once across multi-tick frames and never auto-chains", () => {
    key("keydown", false, "KeyJ"); frame(100);
    expect(player().action).toMatchObject({ type: "attack", frame: 6 });
    for (let i = 0; i < 120; i++) { key("keydown", true, "KeyJ"); frame(); }
    expect(player().action.type).toBe("ready");
  });
  it("clears pending attacks on focus loss", () => {
    key("keydown", false, "KeyK");
    blur();
    frame(); expect(player().action.type).toBe("ready");
  });
  it("discards presses during recovery rather than replaying them when ready", () => {
    key("keydown", false, "KeyJ"); frame();
    for (let i = 0; i < 10; i++) frame();
    key("keydown", false, "KeyK"); frame(100);
    for (let i = 0; i < 100; i++) frame();
    expect(player().action.type).toBe("ready");
  });
  it("keeps the first attack edge when both buttons arrive before the tick", () => {
    key("keydown", false, "KeyK"); key("keydown", false, "KeyJ"); frame();
    expect(player().action).toMatchObject({ type: "attack", kind: "heavy" });
  });
  it("jump plus attack on the same tick selects the aerial attack", () => {
    tap(); key("keydown", false, "KeyJ"); frame();
    expect(player().action).toMatchObject({ type: "attack", airborne: true });
    expect(player().z).toBeGreaterThan(0);
  });
  it("reset restores health and clears pending attacks", () => {
    player().health = 5;
    key("keydown", false, "KeyJ"); match.menu(); match.start(); frame();
    expect(player()).toEqual(createCombatFighter("P1", -100, 0, "e"));
  });
});
