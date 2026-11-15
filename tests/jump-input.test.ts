import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "eventemitter3";
import { STEP } from "../src/core/movement";
import { createCombatFighter, type CombatFighter } from "../src/core/combat";

vi.mock("phaser", () => ({ default: {
  Scene: class {}, Geom: { Point: class {} },
  Core: { Events: { BLUR: "blur" } }, Scenes: { Events: { SHUTDOWN: "shutdown" } },
} }));
vi.mock("../src/rendering/FighterView", () => ({ FighterView: class { sync() {} } }));
vi.mock("../src/rendering/CombatView", () => ({ CombatView: class { sync() {} hit() {} clear() {} } }));
import { ArenaScene } from "../src/scenes/ArenaScene";

describe("scene jump input across render frames", () => {
  let scene: ArenaScene;
  let target: EventTarget;
  let keys: Record<string, { isDown: boolean }>;
  const player = () => (scene as unknown as { player: CombatFighter }).player;
  const frame = (ms = STEP * 1000) => scene.update(0, ms);
  const key = (type: string, repeat = false, code = "Space") => {
    target.dispatchEvent(Object.assign(new Event(type), { code, repeat }));
  };
  const tap = () => { key("keydown"); key("keyup"); };

  beforeEach(() => {
    target = new EventTarget();
    vi.stubGlobal("window", target);
    keys = Object.fromEntries("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE".split(",").map(k => [k, { isDown: false }]));
    const graphics = { fillStyle() {}, lineStyle() {}, fillPoints() {}, strokePoints() {}, lineBetween() {} };
    scene = new ArenaScene();
    Object.assign(scene, {
      add: { graphics: () => graphics, text: () => ({ setDepth() {} }) },
      input: { keyboard: {
        addKeys: () => keys,
        resetKeys: () => Object.values(keys).forEach(k => { k.isDown = false; }),
      } },
      game: { events: new EventEmitter() }, events: new EventEmitter(),
    });
    scene.create();
  });
  afterEach(() => { scene.events.emit("shutdown"); vi.unstubAllGlobals(); });

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
    target.dispatchEvent(new Event("blur"));
    key("keydown", true); frame();
    expect(player().state).toBe("idle");
    key("keyup"); tap(); frame();
    expect(player().state).toBe("jump");
  });
  it("clears pending jump, held movement and partial tick on window blur", () => {
    tap(); keys.D.isDown = true; frame(5);
    target.dispatchEvent(new Event("blur"));
    expect(keys.D.isDown).toBe(false);
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
  it("preserves Phaser blur reset and removes listeners on shutdown/restart", () => {
    tap(); scene.game.events.emit("blur"); frame();
    expect(player().state).toBe("idle");
    tap(); scene.events.emit("shutdown");
    tap(); frame();
    expect(player().state).toBe("idle");
    expect(scene.game.events.listenerCount("blur")).toBe(0);
    scene.create(); tap(); frame();
    expect(player().state).toBe("jump");
    expect(scene.game.events.listenerCount("blur")).toBe(1);
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
  it.each(["window", "phaser", "shutdown"])("clears pending attacks on %s", source => {
    key("keydown", false, "KeyK");
    if (source === "window") target.dispatchEvent(new Event("blur"));
    else if (source === "phaser") scene.game.events.emit("blur");
    else scene.events.emit("shutdown");
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
    key("keydown", false, "KeyJ"); key("keydown", false, "KeyR"); frame();
    expect(player()).toEqual(createCombatFighter("P1", -100, 0, "e"));
  });
});
