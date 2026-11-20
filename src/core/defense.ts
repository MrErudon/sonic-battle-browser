import { facingVector, type AttackAction, type CombatFighter, type CombatInput } from "./combat";

/** All durations are fixed 60 Hz ticks. Proposed tuning, not original GBA data. */
export interface DefenseConfig {
  startup: number; recovery: number; maxGuard: number; chipRatio: number;
  knockbackRatio: number; breakTicks: number; regenDelay: number; regenPerTick: number;
  blockstun: Readonly<Record<"light" | "heavy", number>>;
  guardDamage: Readonly<Record<"light_1" | "light_2" | "light_3" | "heavy" | "air_light" | "air_heavy", number>>;
}
export const DEFAULT_DEFENSE: Readonly<DefenseConfig> = {
  startup: 3, recovery: 6, maxGuard: 100, chipRatio: .25, knockbackRatio: .25,
  breakTicks: 36, regenDelay: 60, regenPerTick: .5,
  blockstun: { light: 6, heavy: 10 },
  guardDamage: { light_1: 18, light_2: 22, light_3: 26, heavy: 45, air_light: 25, air_heavy: 35 },
};
export type DefenseAction =
  | { type: "block_startup"; frame: number }
  | { type: "blocking" }
  | { type: "blockstun"; remaining: number }
  | { type: "block_recovery"; remaining: number }
  | { type: "guard_break" };
export interface GuardState { value: number; regenWait: number; breakRemaining: number }
export function defenseConfig(f: CombatFighter): Readonly<DefenseConfig> { return f.stats.defense ?? DEFAULT_DEFENSE; }
export function validateDefense(c: Readonly<DefenseConfig>): void {
  for (const key of ["startup", "recovery", "maxGuard", "breakTicks", "regenDelay"] as const)
    if (!Number.isInteger(c[key]) || c[key] < 1) throw Error("Invalid defense parameter: " + key);
  for (const value of [c.chipRatio, c.knockbackRatio])
    if (!Number.isFinite(value) || value < 0 || value > 1) throw Error("Invalid defense ratio");
  if (!Number.isFinite(c.regenPerTick) || c.regenPerTick < 0) throw Error("Invalid guard regeneration");
  for (const value of Object.values(c.guardDamage))
    if (!Number.isFinite(value) || value <= 0) throw Error("Invalid guard damage");
  // These bounds preserve a control gap between uncancelled blocked attacks.
  for (const [kind, value] of Object.entries(c.blockstun))
    if (!Number.isInteger(value) || value < 1 || value > (kind === "light" ? 6 : 10)) throw Error("Invalid blockstun");
}
export function isDefenseAction(f: CombatFighter): boolean {
  return ["block_startup", "blocking", "blockstun", "block_recovery", "guard_break"].includes(f.action.type);
}
export function canStartBlock(f: CombatFighter): boolean {
  return f.health > 0 && f.action.type === "ready" && f.cooldown === 0 &&
    f.z === 0 && f.state !== "jump" && f.state !== "landing" && f.guard.breakRemaining === 0;
}
export function clearDefense(f: CombatFighter, reset = false): void {
  if (reset) {
    f.guard = { value: defenseConfig(f).maxGuard, regenWait: 0, breakRemaining: 0 };
    if (isDefenseAction(f)) f.action = { type: "ready" };
  } else if (f.action.type === "blocking" || f.action.type === "block_startup") {
    f.action = { type: "block_recovery", remaining: defenseConfig(f).recovery };
  }
}
/** Returns true when this tick must discard attack/jump/movement, even on unlock. */
export function stepDefense(f: CombatFighter, input: CombatInput, cooling: boolean, stunned: boolean): boolean {
  const c = defenseConfig(f), a = f.action;
  let locked = isDefenseAction(f) || f.guard.breakRemaining > 0;
  if (f.guard.breakRemaining > 0 && --f.guard.breakRemaining === 0) {
    f.guard.value = c.maxGuard;
    if (a.type === "guard_break") f.action = { type: "ready" };
    locked = true;
  }
  if (a.type === "block_startup") {
    if (!input.block) f.action = { type: "block_recovery", remaining: c.recovery };
    else if (++a.frame > c.startup) f.action = { type: "blocking" };
  } else if (a.type === "blocking" && !input.block) {
    f.action = { type: "block_recovery", remaining: c.recovery };
  } else if (a.type === "blockstun" && --a.remaining === 0) {
    f.action = input.block ? { type: "blocking" } : { type: "block_recovery", remaining: c.recovery };
  } else if (a.type === "block_recovery" && --a.remaining === 0) {
    f.action = { type: "ready" };
  }
  if (!locked && !cooling && !stunned && input.block && canStartBlock(f)) {
    f.action = { type: "block_startup", frame: 1 };
    locked = true;
  }
  if (f.guard.regenWait > 0) f.guard.regenWait--;
  else if (!locked && f.action.type === "ready" && f.z === 0 && f.state !== "landing" && f.guard.breakRemaining === 0)
    f.guard.value = Math.min(c.maxGuard, f.guard.value + c.regenPerTick);
  return locked;
}
export function blocksContact(target: CombatFighter, attacker: CombatFighter): boolean {
  if (target.guard.breakRemaining || target.z !== 0 || target.state === "jump" || target.state === "landing" ||
      (target.action.type !== "blocking" && target.action.type !== "blockstun")) return false;
  const dx = attacker.x - target.x, dy = attacker.y - target.y;
  if (Math.hypot(dx, dy) < 1e-9) return false;
  const d = facingVector(target.facing);
  return dx * d.x + dy * d.y >= -1e-9;
}
export function guardCost(f: CombatFighter, a: AttackAction): number {
  const c = defenseConfig(f);
  if (a.airborne) return c.guardDamage[a.kind === "light" ? "air_light" : "air_heavy"];
  if (a.kind === "heavy") return c.guardDamage.heavy;
  return c.guardDamage[a.comboStage === "light_2" ? "light_2" : a.comboStage === "light_3" ? "light_3" : "light_1"];
}
