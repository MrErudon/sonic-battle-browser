import { clearComboInput, clearComboFeedback, createCombatFighter, stepCombat, type CombatInput, type HitEvent } from "./combat";
import { CPU_PRESETS, CpuController, type Difficulty } from "./cpu";
import { STEP } from "./movement";

export type MatchState = "Menu" | "Countdown" | "Fighting" | "Round Over" | "Match Over";
export type RoundResult = "P1" | "P2" | "Draw";
export const COUNTDOWN_TICKS = 180;
export const ROUND_OVER_TICKS = 120;
export const COMBAT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyJ", "KeyK"]);

/** DOM-independent edge capture. Clearing invalidates held movement as well as
 * taps. A key held across a boundary must be released before it can act again. */
export class MatchInput {
  private down = new Set<string>();
  private active = new Set<string>();
  private jump = false;
  private attack?: CombatInput["attack"];

  press(code: string, repeat: boolean, enabled: boolean): void {
    if (!COMBAT_KEYS.has(code) || repeat || this.down.has(code)) return;
    this.down.add(code);
    if (!enabled) return;
    this.active.add(code);
    if (code === "Space") this.jump = true;
    if (code === "KeyJ") this.attack ??= "light";
    if (code === "KeyK") this.attack ??= "heavy";
  }
  release(code: string): void { this.down.delete(code); this.active.delete(code); }
  clear(): void { this.active.clear(); this.jump = false; this.attack = undefined; }
  blur(): void { this.clear(); this.down.clear(); }
  consume(): CombatInput {
    const has = (...codes: string[]) => codes.some(code => this.active.has(code));
    const input = {
      x: Number(has("KeyD", "ArrowRight")) - Number(has("KeyA", "ArrowLeft")),
      y: Number(has("KeyS", "ArrowDown")) - Number(has("KeyW", "ArrowUp")),
      jump: this.jump, attack: this.attack,
    };
    this.jump = false; this.attack = undefined;
    return input;
  }
}

/** Owns the complete match at 60 Hz, without Phaser, DOM, or wall-clock timers.
 * UI commands are synchronous transactions; only Menu accepts difficulty changes.
 * Combat resolves every contact before KO adjudication, allowing honest trades. */
export class MatchController {
  private currentState: MatchState = "Menu";
  private selectedDifficulty: Difficulty = "Normal";
  private remaining = 0;
  private accumulator = 0;
  private focused = true;
  private help = false;
  private cpu: CpuController;
  readonly input = new MatchInput();
  fighters = this.newFighters();
  score: [number, number] = [0, 0];
  round = 1;
  result?: RoundResult;
  /** Render adapters clear effects when this changes, including zero-tick commands. */
  resetVersion = 0;

  constructor(readonly seed = 1) { this.cpu = new CpuController(CPU_PRESETS.Normal, seed); }
  get state(): MatchState { return this.currentState; }
  get difficulty(): Difficulty { return this.selectedDifficulty; }
  get cpuConfig() { return this.cpu.config; }
  get ticksRemaining(): number { return this.remaining; }
  get helpOpen(): boolean { return this.help; }
  get paused(): boolean { return !this.focused || this.help; }
  get acceptsInput(): boolean { return this.state === "Fighting" && !this.paused; }
  get winner(): "P1" | "P2" | undefined { return this.score[0] === 2 ? "P1" : this.score[1] === 2 ? "P2" : undefined; }

  private newFighters() {
    return [createCombatFighter("P1", -100, 0, "e"), createCombatFighter("P2", 100, 0, "w")] as const;
  }
  private enter(state: MatchState, ticks = 0): void {
    this.currentState = state; this.remaining = ticks; this.input.clear();
    this.fighters.forEach(f => { clearComboInput(f); clearComboFeedback(f); });
  }
  private resetRound(): void {
    this.fighters = this.newFighters();
    this.cpu = new CpuController(CPU_PRESETS[this.difficulty], this.seed);
    this.result = undefined;
    this.resetVersion++;
    this.enter("Countdown", COUNTDOWN_TICKS);
  }
  selectDifficulty(difficulty: Difficulty): void {
    if (this.state !== "Menu") return;
    this.selectedDifficulty = difficulty;
    this.cpu = new CpuController(CPU_PRESETS[difficulty], this.seed);
    this.input.clear();
  }
  start(): void {
    if (this.state !== "Menu" && this.state !== "Match Over") return;
    this.score = [0, 0]; this.round = 1; this.accumulator = 0;
    this.help = false;
    this.resetRound();
  }
  menu(): void {
    this.score = [0, 0]; this.round = 1; this.accumulator = 0; this.help = false;
    this.resetRound();
    this.enter("Menu");
  }
  setFocused(focused: boolean): void {
    this.focused = focused; this.accumulator = 0; this.input.blur();
    this.fighters.forEach(clearComboInput);
  }
  setHelp(open: boolean): void {
    this.help = open; this.accumulator = 0; this.input.clear();
    this.fighters.forEach(clearComboInput);
  }
  press(code: string, repeat = false): void { this.input.press(code, repeat, this.acceptsInput); }
  release(code: string): void { this.input.release(code); }

  /** At most six ticks after a stall; paused time is never caught up. */
  advance(deltaMs: number): HitEvent[] {
    if (this.paused || !Number.isFinite(deltaMs) || deltaMs <= 0) return [];
    this.accumulator += Math.min(deltaMs / 1000, 0.1);
    const hits: HitEvent[] = [];
    while (this.accumulator + 1e-10 >= STEP) {
      hits.push(...this.tick());
      this.accumulator -= STEP;
    }
    return hits;
  }
  /** Exposed for deterministic simulation tests and alternate host adapters. */
  tick(): HitEvent[] {
    if (this.paused) return [];
    if (this.state === "Countdown") {
      this.input.clear();
      if (--this.remaining === 0) this.enter("Fighting");
      return [];
    }
    if (this.state === "Round Over") {
      if (--this.remaining === 0) {
        if (this.winner) this.enter("Match Over");
        else {
          if (this.result !== "Draw") this.round++;
          this.resetRound();
        }
      }
      return [];
    }
    if (this.state !== "Fighting") { this.input.clear(); return []; }
    const [player, opponent] = this.fighters;
    const hits = stepCombat(this.fighters, [this.input.consume(), this.cpu.tick(opponent, player)]);
    if (player.health === 0 || opponent.health === 0) {
      this.result = player.health === 0 && opponent.health === 0 ? "Draw" : player.health === 0 ? "P2" : "P1";
      if (this.result !== "Draw") this.score[this.result === "P1" ? 0 : 1]++;
      // Freeze the exact KO pose. No further physics or CPU decisions in results.
      this.enter("Round Over", ROUND_OVER_TICKS);
    }
    return hits;
  }
}
