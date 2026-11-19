import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

// Real DOM controls, keyboard edges, Phaser scene and production combat. Controlled
// render deltas accelerate matches; no health, position, score or CPU-state cheats.
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4174", "--strictPort"], { stdio: "pipe" });
let browser;
const results = [];
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
  await page.waitForFunction(async () => (await import("/src/main.ts")).game.scene.isActive("Arena"));
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/m01-5-menu.png" });
  await page.evaluate(async () => {
    const { game } = await import("/src/main.ts");
    const scene = game.scene.getScene("Arena");
    game.loop.stop();
    let time = 0;
    window.harness = {
      game, scene, frame(delta = 1000 / 60) { time += delta; scene.update(time, delta); },
      tap(code, repeat = false) {
        window.dispatchEvent(new KeyboardEvent("keydown", { code, repeat, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
      },
      focus() { window.dispatchEvent(new Event("focus")); },
    };
  });
  const capture = async name => {
    await page.evaluate(() => {
      const { game, scene } = window.harness;
      window.harness.savedUpdate = scene.update;
      scene.update = () => {};
      game.loop.start(game.step.bind(game));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `artifacts/m01-5-${name}.png` });
    await page.evaluate(() => {
      const { game, scene, savedUpdate } = window.harness;
      game.loop.stop(); scene.update = savedUpdate;
    });
  };
  const checks = async fn => results.push(...await page.evaluate(fn));
  await checks(() => {
    const { scene, frame, tap, focus } = window.harness, m = scene.match, out = [];
    const check = (condition, label) => { if (!condition) throw Error(label); out.push(label); };
    check(m.state === "Menu", "initial Menu");
    for (const difficulty of ["Hard", "Easy", "Normal", "Hard"]) {
      document.querySelector(`[data-difficulty="${difficulty}"]`).click(); frame(0);
      check(m.difficulty === difficulty && m.cpuConfig.reactionFrames === ({ Easy: 24, Normal: 12, Hard: 5 })[difficulty], `zero-tick ${difficulty}: label and controller agree`);
    }
    window.dispatchEvent(new Event("blur")); frame(100);
    check(m.difficulty === "Hard" && document.querySelector('[data-difficulty="Hard"]').getAttribute("aria-pressed") === "true", "selection survives immediate blur consistently");
    focus(); document.querySelector("#start-game").click();
    tap("Space"); tap("KeyK"); window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
    for (let i = 0; i < 180; i++) frame();
    frame(); check(m.state === "Fighting" && m.fighters[0].x === -100 && m.fighters[0].z === 0 && m.fighters[0].action.type === "ready", "countdown gates held movement and attack/jump taps");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" })); frame();
    check(m.fighters[0].x > -100, "fresh movement after countdown works");
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
    tap("KeyK"); tap("Space"); frame(4); window.dispatchEvent(new Event("blur"));
    const before = JSON.stringify(m.fighters); for (let i = 0; i < 60; i++) frame(100);
    check(JSON.stringify(m.fighters) === before, "blur freezes real scene");
    focus(); frame(12); check(JSON.stringify(m.fighters) === before, "focus clears partial tick without catch-up");
    frame(5); check(m.fighters[0].z === 0 && m.fighters[0].action.type === "ready", "blur discards pending taps");
    document.querySelector("#help").click(); const helpPose = JSON.stringify(m.fighters); frame(100);
    check(m.helpOpen && JSON.stringify(m.fighters) === helpPose && document.querySelector("dialog").open, "native help dialog pauses match");
    window.dispatchEvent(new Event("blur")); focus(); frame(100);
    check(JSON.stringify(m.fighters) === helpPose, "focus does not bypass help pause");
    return out;
  });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("dialog").open && !window.harness.scene.match.helpOpen);
  await checks(() => {
    const { scene, frame } = window.harness;
    if (scene.match.helpOpen) throw Error("Escape must close help");
    document.querySelector("#debug").click(); frame(0);
    if (document.querySelector(".debug-readout").hidden || !scene.views[0].label.text.includes("ready")) throw Error("debug toggle");
    document.querySelector("#debug").click(); document.querySelector("#menu").click(); frame(0);
    if (scene.views[0].label.text !== "YOU") throw Error("normal play hides diagnostic labels");
    if (scene.combatView.sparks.length || scene.match.state !== "Menu") throw Error("menu reset clears effects");
    return ["Escape closes help and resumes", "debug toggle works and normal play hides fighter diagnostics", "menu reset clears effects"];
  });
  for (const difficulty of ["Easy", "Normal", "Hard"]) {
    await page.getByRole("button", { name: difficulty, exact: true }).click();
    await page.getByRole("button", { name: /Start Game/ }).click();
    const outcome = await page.evaluate(async difficulty => {
      const { CpuController, CPU_PRESETS } = await import("/src/core/cpu.ts");
      const { scene, frame, tap, focus } = window.harness; focus();
      const m = scene.match;
      // The test player uses only public legal key inputs; faster decisions are
      // a test driver, not a shipped difficulty, combat ability or stat change.
      let bot, version = -1, held = new Set(), hits = 0, rounds = new Set();
      const directions = [["ArrowRight", "ArrowLeft", "x"], ["ArrowDown", "ArrowUp", "y"]];
      for (let tick = 0; tick < 36000 && m.state !== "Match Over"; tick++) {
        if (version !== m.resetVersion) {
          for (const code of held) window.dispatchEvent(new KeyboardEvent("keyup", { code }));
          held = new Set(); version = m.resetVersion;
          bot = new CpuController({ ...CPU_PRESETS.Hard, reactionFrames: 1, attackInterval: 1, pauseChance: 0, aerialChance: 0, heavyChance: 0 }, 7);
        }
        if (m.state === "Fighting") {
          const input = bot.tick(m.fighters[0], m.fighters[1]);
          const next = new Set();
          for (const [positive, negative, axis] of directions) {
            if (input[axis] > 0) next.add(positive);
            if (input[axis] < 0) next.add(negative);
          }
          for (const code of held) if (!next.has(code)) window.dispatchEvent(new KeyboardEvent("keyup", { code }));
          for (const code of next) if (!held.has(code)) window.dispatchEvent(new KeyboardEvent("keydown", { code }));
          held = next;
          if (input.jump) tap("Space");
          if (input.attack) tap(input.attack === "light" ? "KeyJ" : "KeyK");
        }
        const hp = m.fighters[1].health; frame(); if (m.fighters[1].health < hp) hits++;
        if (m.state === "Round Over") rounds.add(m.round);
      }
      for (const code of held) window.dispatchEvent(new KeyboardEvent("keyup", { code }));
      if (m.state !== "Match Over" || m.winner !== "P1") throw Error(`${difficulty} playthrough: ${m.state}, winner ${m.winner}, score ${m.score}, HP ${m.fighters.map(f => f.health)}`);
      if (document.querySelector("#result-title").textContent !== "Victory!") throw Error("victory rendering");
      return { difficulty, score: [...m.score], hits, rounds: [...rounds], title: document.querySelector("#result-title").textContent };
    }, difficulty);
    results.push(`${difficulty} legal-key playthrough: victory ${outcome.score.join("-")}, ${outcome.hits} damaging hits, ${outcome.rounds.length} rounds`);
    await capture(`${difficulty.toLowerCase()}-victory`);
    await page.getByRole("button", { name: "Rematch", exact: true }).click();
    await checks(() => {
      const { scene, frame } = window.harness, m = scene.match;
      frame();
      if (m.state !== "Countdown" || m.score.join() !== "0,0" || m.fighters.some(f => f.health !== 100) || scene.combatView.sparks.length) throw Error("rematch full reset");
      for (let i = 0; i < 179; i++) frame();
      if (m.state !== "Fighting") throw Error("rematch begins fighting");
      const difficulty = m.difficulty;
      // Let the actual CPU complete the rematch to cover defeat without cheats.
      for (let i = 0; i < 36000 && m.state !== "Match Over"; i++) frame();
      if (m.winner !== "P2" || document.querySelector("#result-title").textContent !== "Defeat") throw Error("CPU defeat playthrough");
      document.querySelector("#result-menu").click(); frame(0);
      if (m.state !== "Menu" || m.difficulty !== difficulty) throw Error("return menu preserves difficulty");
      return [`${difficulty} rematch restores health/score/CPU/effects and reaches Fighting`, `${difficulty} CPU wins completed rematch; Defeat shown`, `${difficulty} return to menu preserves difficulty`];
    });
  }
  // Short-tap/render cadence regressions now start through the real menu.
  await checks(() => {
    const { scene, frame, tap, focus } = window.harness, m = scene.match, out = [];
    for (const hz of [10, 30, 60, 144, 240]) {
      document.querySelector("#start-game").click(); focus(); for (let i = 0; i < 180; i++) frame();
      tap("Space"); for (let i = 0; i < Math.ceil(hz / 5); i++) frame(1000 / hz);
      if (m.fighters[0].z <= 0) throw Error(`${hz} Hz short jump lost`);
      document.querySelector("#menu").click();
      document.querySelector("#start-game").click(); for (let i = 0; i < 180; i++) frame();
      tap("KeyJ"); for (let i = 0; i < Math.ceil(hz / 10); i++) frame(1000 / hz);
      if (m.fighters[0].action.type !== "attack") throw Error(`${hz} Hz short attack lost`);
      document.querySelector("#menu").click();
      out.push(`${hz} Hz short jump and attack captured`);
    }
    for (const difficulty of ["Easy", "Normal", "Hard"]) {
      document.querySelector(`[data-difficulty="${difficulty}"]`).click(); document.querySelector("#start-game").click();
      for (let i = 0; i < 180; i++) frame();
      for (let i = 0; i < 300; i++) { if (m.fighters[0].z === 0) tap("Space"); frame(); }
      const hp = m.fighters[0].health; let hit = -1;
      for (let i = 0; i < 720; i++) { frame(); if (m.fighters[0].health < hp) { hit = i; break; } }
      if (hit < 0) throw Error(`${difficulty} starvation regression`);
      out.push(`${difficulty} repeated-jump recovery: new damage after ${hit + 1} ticks`);
      document.querySelector("#menu").click();
    }
    return out;
  });
  await page.evaluate(() => { document.querySelector("#start-game").click(); window.harness.frame(0); });
  await capture("countdown");
  await checks(() => {
    const { scene, frame } = window.harness, m = scene.match;
    for (let i = 0; i < 180; i++) frame();
    for (let i = 0; i < 18000 && m.state === "Fighting"; i++) frame();
    if (m.state !== "Round Over" || document.querySelector("#status-title").textContent !== "KO" || m.score.join() !== "0,1") throw Error("KO presentation");
    return ["countdown and legal CPU KO presentation verified"];
  });
  await capture("ko");
  await page.evaluate(() => { for (let i = 0; i < 300; i++) window.harness.frame(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("narrow-fighting");
  await checks(() => {
    const bars = [...document.querySelectorAll(".fighter-health")].map(node => node.getBoundingClientRect());
    if (bars.some(rect => rect.left < 0 || rect.right > innerWidth) || bars[0].right > bars[1].left) throw Error("narrow HUD overlap");
    document.querySelector("#menu").click();
    return ["390px fighting HUD fits without overlap"];
  });
  await page.setViewportSize({ width: 1100, height: 760 });
  // Resume normal Phaser scheduling and use actual Playwright keyboard events.
  await page.evaluate(() => { const { game } = window.harness; game.loop.start(game.step.bind(game)); });
  await page.getByRole("button", { name: /Start Game/ }).click();
  await page.waitForFunction(() => window.harness.scene.match.state === "Fighting");
  await page.keyboard.down("ArrowLeft"); await page.waitForTimeout(150); await page.keyboard.up("ArrowLeft");
  assert.ok(await page.evaluate(() => window.harness.scene.match.fighters[0].x < -100), "real keyboard movement");
  await page.keyboard.press("Space"); await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => window.harness.scene.match.fighters[0].z > 0), "real keyboard jump");
  await page.screenshot({ path: "artifacts/m01-5-fighting.png" });
  await page.getByRole("button", { name: "Controls / Help" }).click();
  await page.screenshot({ path: "artifacts/m01-5-help.png" });
  await page.getByRole("button", { name: "Back to game" }).click();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/m01-5-narrow-menu.png" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "narrow viewport fits");
  await page.setViewportSize({ width: 1100, height: 760 });
  const listeners = await page.evaluate(() => {
    const { game, scene } = window.harness;
    const count = game.events.listenerCount("blur");
    scene.scene.restart(); return count;
  });
  await page.waitForFunction(() => window.harness.scene.match.state === "Menu" && document.querySelectorAll(".match-ui").length === 1);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.harness.game.events.listenerCount("blur")), listeners, "scene restart does not accumulate blur listeners");
  await page.evaluate(() => {
    const { scene } = window.harness;
    document.querySelector("#start-game").click();
    scene.game.events.emit("blur");
    const ticks = scene.match.ticksRemaining; scene.update(0, 100);
    if (!scene.match.paused || scene.match.ticksRemaining !== ticks) throw Error("Phaser blur pauses countdown");
    scene.game.events.emit("focus");
    if (scene.match.paused) throw Error("Phaser focus resumes");
  });
  results.push("scene restart cleans up DOM and focus listeners", "Phaser blur/focus pauses and resumes countdown");
  assert.deepEqual(errors, [], "no browser runtime exceptions");
  results.push("real-time keyboard movement and jump", "390px viewport has no horizontal overflow", "no runtime exceptions");
  await writeFile("artifacts/browser-results.json", JSON.stringify({ results, errors }, null, 2));
  console.log(`Browser checks passed: ${results.length}`);
  results.forEach(result => console.log(`PASS ${result}`));
} finally {
  await browser?.close(); server.kill();
}
