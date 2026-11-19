import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

const engine = process.env.BROWSER || "chromium";
assert.ok(["chromium", "firefox", "webkit"].includes(engine), "supported browser");
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4175", "--strictPort"], { stdio: "pipe" });
let browser;
const results = [], errors = [], responses = [];
let current = "startup";
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("preview startup timed out")), 20000);
    server.stdout.on("data", data => { if (data.toString().includes("4175")) { clearTimeout(timer); resolve(); } });
    server.once("error", error => { clearTimeout(timer); reject(error); });
    server.once("exit", code => { clearTimeout(timer); reject(Error("preview exited " + code)); });
  });
  await mkdir("artifacts/production-" + engine, { recursive: true });
  browser = await ({ chromium, firefox, webkit })[engine].launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", r => { if (r.status() >= 400) responses.push(r.status() + " " + r.url()); });
  await page.clock.install();
  await page.goto("http://127.0.0.1:4175");
  await page.locator(".match-ui[data-state='Menu']").waitFor();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  const check = (ok, name) => { assert.ok(ok, name); results.push(name); };
  const state = () => page.locator(".match-ui").getAttribute("data-state");
  const step = ms => page.clock.runFor(ms);
  const snapshot = name => page.screenshot({ path: "artifacts/production-" + engine + "/" + name + ".png" });
  const health = () => page.locator("#p1-bar").getAttribute("value");
  const start = async () => {
    await page.getByRole("button", { name: /Start Game/ }).click();
    assert.equal(await state(), "Countdown");
    await step(3200);
    assert.equal(await state(), "Fighting");
  };
  current = "assets";
  check((await page.locator("canvas").count()) === 1, "production canvas boots");
  const html = await readFile("dist/index.html", "utf8");
  check(!html.includes("/src/"), "built HTML references compiled assets");
  check((await readFile("dist/_headers", "utf8")).includes("immutable"), "Pages header manifest copied to dist");
  check((await readFile("dist/robots.txt", "utf8")).includes("Disallow"), "no-index manifest copied to dist (not authentication)");
  current = "responsive menus";
  for (const [width, height] of [[1920,1080], [1366,768], [1280,800], [1024,768], [800,600], [390,844], [844,390]]) {
    await page.setViewportSize({ width, height }); await step(100);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), width + "x" + height + " no horizontal overflow");
    await page.getByRole("button", { name: /Start Game/ }).scrollIntoViewIfNeeded();
    const button = await page.locator("#start-game").boundingBox();
    check(button && button.width > 100 && button.height >= 40, width + "x" + height + " usable Start button");
    await snapshot("menu-" + width + "x" + height);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  current = "difficulty and input";
  for (const difficulty of ["Easy", "Normal", "Hard"]) {
    await page.getByRole("button", { name: difficulty, exact: true }).click();
    check(await page.getByRole("button", { name: difficulty, exact: true }).getAttribute("aria-pressed") === "true", difficulty + " selected");
    await start();
    check((await page.locator("#cpu-label").textContent()).includes(difficulty), difficulty + " HUD");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  }
  await page.getByRole("button", { name: "Normal", exact: true }).click();
  await start();
  await page.keyboard.press("KeyJ"); await step(100);
  await page.getByRole("button", { name: "Debug", exact: true }).click();
  check(await page.locator(".debug-readout").isVisible(), "optional diagnostics visible");
  check((await page.locator(".debug-readout").textContent()).includes("attack"), "production keyboard attack reaches combat");
  await page.getByRole("button", { name: "Debug", exact: true }).click();
  check(!(await page.locator(".debug-readout").isVisible()), "normal play hides diagnostics");
  current = "help and blur";
  await page.getByRole("button", { name: "Controls / Help" }).click();
  const frozen = await health(); await step(5000);
  check(await health() === frozen && await page.locator("dialog").isVisible(), "help pauses simulation");
  await page.keyboard.press("Escape"); await step(100);
  check(!(await page.locator("dialog").isVisible()), "Escape closes help");
  // Browser adapter focus events are the boundary under test; no simulation mutation.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const pausedHp = await health(); await step(5000);
  check(await health() === pausedHp && await page.locator(".pause-message").isVisible(), "blur pauses gameplay");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await step(100);
  check(!(await page.locator(".pause-message").isVisible()), "focus resumes gameplay");
  current = "HUD layouts";
  for (const [width, height] of [[1920,1080], [1366,768], [1024,768], [800,600], [390,844], [844,390]]) {
    await page.setViewportSize({ width, height }); await step(100);
    check(await page.evaluate(() => {
      const [a,b] = [...document.querySelectorAll(".fighter-health")].map(e => e.getBoundingClientRect());
      return a.left >= 0 && b.right <= innerWidth && a.right <= b.left && document.documentElement.scrollWidth <= innerWidth;
    }), width + "x" + height + " HUD stays separate and within viewport");
    await snapshot("hud-" + width + "x" + height);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  current = "complete legal CPU match";
  // All gameplay uses the shipped CPU and real keyboard events. The clock only
  // accelerates browser time; health, score, positions and game state are never set.
  let ko = false;
  for (let i = 0; i < 120 && await state() !== "Match Over"; i++) {
    await step(1000);
    if (await state() === "Round Over") ko = true;
  }
  check(await state() === "Match Over", "production full match reaches results");
  check(ko, "production KO transition observed");
  check(await page.locator("#result-title").textContent() === "Defeat", "production defeat shown");
  check((await page.locator("#p2-rounds").textContent()).includes("2 / 2"), "production best-of-three ends at two CPU wins");
  await snapshot("defeat");
  current = "rematch";
  await page.getByRole("button", { name: "Rematch", exact: true }).click();
  check(await state() === "Countdown" && await health() === "100", "production rematch resets health");
  check((await page.locator("#p2-rounds").textContent()).includes("0 / 2"), "production rematch resets score");
  await step(3200); check(await state() === "Fighting", "production rematch returns to Fighting");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  check(await state() === "Menu", "production return to menu");
  // Coarse-pointer emulation checks mobile messaging, not touch gameplay.
  current = "mobile shell";
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const mobilePage = await mobile.newPage();
  mobilePage.on("pageerror", e => errors.push(e.message));
  await mobilePage.goto("http://127.0.0.1:4175");
  await mobilePage.locator(".match-ui").waitFor();
  check(await mobilePage.locator(".keyboard-notice").isVisible(), "mobile explicitly requires keyboard");
  await mobilePage.screenshot({ path: "artifacts/production-" + engine + "/mobile.png" });
  await mobile.close();
  assert.deepEqual(errors, [], "no runtime exceptions");
  assert.deepEqual(responses, [], "no failed production asset requests");
  results.push("no runtime exceptions or failed assets");
  console.log(engine + " production checks passed: " + results.length);
  results.forEach(r => console.log("PASS " + r));
} catch (error) {
  errors.push(current + ": " + error.message);
  throw error;
} finally {
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/production-" + engine + ".json", JSON.stringify({ engine, current, results, errors, responses }, null, 2));
  await browser?.close(); server.kill();
}
