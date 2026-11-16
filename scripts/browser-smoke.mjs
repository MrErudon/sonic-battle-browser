import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Real Phaser scene and DOM events, with controlled render deltas for reproducibility.
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4174", "--strictPort"], { stdio: "pipe" });
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Vite startup timed out")), 15000);
    server.stdout.on("data", data => { if (data.toString().includes("4174")) { clearTimeout(timer); resolve(); } });
    server.once("error", reject);
    server.once("exit", code => { clearTimeout(timer); reject(new Error(`Vite exited: ${code}`)); });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:4174");
  await page.waitForFunction(async () => {
    const { game } = await import("/src/main.ts");
    return game.scene.isActive("Arena");
  });
  await page.locator("canvas").click();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  assert.ok(await page.evaluate(async () => (await import("/src/main.ts")).game.scene.getScene("Arena").player.x > -100), "real keyboard moves P1");
  await page.keyboard.press("Space");
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(async () => (await import("/src/main.ts")).game.scene.getScene("Arena").player.z > 0), "real keyboard jumps");

  const results = await page.evaluate(async () => {
    const { game } = await import("/src/main.ts");
    const { facingVector } = await import("/src/core/combat.ts");
    const scene = game.scene.getScene("Arena");
    game.loop.stop();
    const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
    const results = [];
    let time = 0;
    const frame = delta => { time += delta; scene.update(time, delta); };
    const tap = (code, repeat = false) => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code, repeat }));
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    };
    const reset = () => {
      window.dispatchEvent(new Event("blur")); tap("KeyR"); frame(1000 / 60);
      scene.cpu = { tick: () => ({ x: 0, y: 0, jump: false }) };
      scene.player.x = 0; scene.player.y = 0;
      const d = facingVector("e"); scene.opponent.x = d.x * 45; scene.opponent.y = d.y * 45;
    };
    for (const hz of [10, 30, 60, 144, 240]) {
      reset(); tap("KeyJ");
      for (let i = 0; i < hz; i++) frame(1000 / hz);
      check(scene.opponent.health === 95, `${hz} Hz short light tap: exactly one hit`);
      check(scene.player.action.type === "ready", `${hz} Hz attack finishes recovery`);
      reset(); tap("Space");
      for (let i = 0; i < Math.ceil(hz / 5); i++) frame(1000 / hz);
      check(scene.player.z > 0, `${hz} Hz short jump tap retained`);
    }
    reset(); tap("KeyK"); frame(4); frame(4); frame(4);
    check(scene.player.action.type === "ready", "no tick at 12ms"); frame(5);
    check(scene.player.action.type === "attack" && scene.player.action.frame === 1, "pending heavy retained to next tick");
    for (let i = 0; i < 120; i++) { tap("KeyK", true); frame(1000 / 60); }
    check(scene.opponent.health === 85 && scene.player.action.type === "ready", "held repeats do not chain");
    check(scene.opponent.z === 0 && scene.opponent.state === "idle", "launched target lands after knockback");
    check(scene.combatView.labels[1].text.includes("85 / 100"), "rendered HUD follows damage");
    reset(); tap("KeyJ"); tap("Space"); window.dispatchEvent(new Event("blur")); frame(100);
    check(scene.player.action.type === "ready" && scene.player.z === 0, "blur clears pending attack and jump");
    reset(); scene.player.z = 100; scene.player.vz = 0; scene.player.state = "jump";
    tap("KeyJ"); for (let i = 0; i < 8; i++) frame(1000 / 60);
    check(scene.opponent.health === 100, "high aerial attack misses grounded target");
    reset(); tap("KeyK"); for (let i = 0; i < 13; i++) frame(1000 / 60);
    check(scene.opponent.health === 85 && scene.opponent.action.type === "hitstun", "heavy impact and hitstun visible");
    check(scene.combatView.sparks.length === 1, "impact spark created");
    const { CpuController, CPU_PRESETS } = await import("/src/core/cpu.ts");
    const { createCombatFighter } = await import("/src/core/combat.ts");
    const snapshots = [];
    for (const hz of [10, 30, 60, 144, 240]) {
      window.dispatchEvent(new Event("blur")); tap("Digit2"); frame(1000 / 60);
      for (let i = 0; i < hz * 8; i++) frame(1000 / hz);
      check(scene.player.health < 100, `${hz} Hz CPU independently damages P1`);
      snapshots.push(JSON.stringify([scene.player, scene.opponent]));
    }
    check(snapshots.every(value => value === snapshots[0]), "CPU simulation identical across render rates");
    for (const [code, difficulty] of [["Digit1", "Easy"], ["Digit2", "Normal"], ["Digit3", "Hard"]]) {
      tap(code); frame(1000 / 60);
      check(scene.difficultyLabel.text.includes(`CPU: ${difficulty}`), `${difficulty} selection displayed`);
      check(scene.player.health === 100 && scene.opponent.health === 100, `${difficulty} selection resets health`);
      check(scene.cpu.config.reactionFrames === CPU_PRESETS[difficulty].reactionFrames, `${difficulty} controller configured`);
    }
    // A real P1 heavy interrupts CPU, then CPU resumes through normal physics.
    scene.player = createCombatFighter("P1", 0, 0, "e");
    const direction = facingVector("e");
    scene.opponent = createCombatFighter("P2", direction.x * 44, direction.y * 44, "w");
    scene.cpu = new CpuController(CPU_PRESETS.Easy, 8);
    tap("KeyK");
    for (let i = 0; i < 13; i++) frame(1000 / 60);
    check(scene.opponent.action.type === "hitstun", "CPU receives P1 hitstun and launch");
    for (let i = 0; i < 900; i++) frame(1000 / 60);
    check(scene.player.health < 100, "CPU resumes after interruption and damages P1");
    check(scene.combatView.labels[0].text.includes(`${scene.player.health} / 100`), "P1 health HUD follows CPU damage");
    tap("Digit2"); frame(1000 / 60);
    for (let i = 0; i < 150; i++) frame(1000 / 60);
    // Render the inspected state; manual update calls alone do not redraw WebGL.
    scene.update = () => {};
    game.loop.start(game.step.bind(game));
    return results;
  });
  await mkdir("artifacts", { recursive: true });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: "artifacts/m01-4-cpu.png" });
  assert.deepEqual(errors, [], "no browser runtime exceptions");
  console.log(`Browser checks passed: ${results.length + 3} (keyboard movement/jump, ${results.length} scene checks, no runtime errors)`);
  results.forEach(result => console.log(`PASS ${result}`));
} finally {
  await browser?.close();
  server.kill();
}
