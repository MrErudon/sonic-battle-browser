import { DEFAULT_COMBO, validateCombo, type ComboConfig } from "./combos";
import { ARENA } from "./arena";
import { createFighter, DEFAULT_MOVEMENT, DIRECTIONS, NO_INPUT, STEP, stepFighter, type Facing, type Fighter, type MovementConfig, type MovementInput } from "./movement";

export type AttackKind = "light" | "heavy";
export interface AttackStats {
  startup: number; active: number; recovery: number; cooldown: number;
  damage: number; hitstun: number; knockback: number; launch: number;
  reach: number; width: number; bottom: number; height: number;
}
export interface FighterStats {
  combo?: ComboConfig;
  maxHealth: number; hurtRadius: number; hurtHeight: number; knockbackDrag: number;
  movement: Readonly<MovementConfig>;
  attacks: Record<"ground" | "air", Record<AttackKind, Readonly<AttackStats>>>;
}
const light: Readonly<AttackStats> = { startup: 5, active: 3, recovery: 10, cooldown: 4, damage: 5, hitstun: 12, knockback: 150, launch: 0, reach: 58, width: 36, bottom: 6, height: 34 };
const heavy: Readonly<AttackStats> = { startup: 12, active: 4, recovery: 20, cooldown: 8, damage: 15, hitstun: 24, knockback: 320, launch: 180, reach: 76, width: 44, bottom: 4, height: 42 };
/** Proposed prototype values, not measured GBA frame data. */
export const DEFAULT_FIGHTER_STATS: Readonly<FighterStats> = {
  maxHealth: 100, hurtRadius: 16, hurtHeight: 44, knockbackDrag: 600,
  movement: DEFAULT_MOVEMENT,
  attacks: { ground: { light, heavy }, air: {
    light: { ...light, startup: 7, active: 4, recovery: 14, damage: 9, bottom: -12, height: 44 },
    heavy: { ...heavy, startup: 10, damage: 12, bottom: -18, height: 48 },
  } },
};
export interface AttackAction {
  type: "attack"; kind: AttackKind; airborne: boolean; frame: number;
  facing: Facing; stats: Readonly<AttackStats>; hitTargets: Set<string>;
  comboStage?: string;
  buffered?: { kind: AttackKind; remaining: number };
}
export type Action = { type: "ready" } | AttackAction | { type: "hitstun"; remaining: number } | { type: "ko" };
export interface CombatFighter extends Fighter {
  id: string; health: number; stats: Readonly<FighterStats>; action: Action;
  comboHits: { count: number; damage: number; targetId?: string; remaining: number; active: boolean };
  cooldown: number; knockbackX: number; knockbackY: number;
}
export interface CombatInput extends MovementInput { attack?: AttackKind }
export interface HitEvent { attackerId: string; defenderId: string; damage: number; x: number; y: number; z: number; comboStage?: string; comboCount?: number }
export function createCombatFighter(id: string, x: number, y: number, facing: Facing = "s", stats = DEFAULT_FIGHTER_STATS): CombatFighter {
  validateCombo(stats.combo ?? DEFAULT_COMBO, stats.attacks.ground);
  return { ...createFighter(x, y, facing), id, stats, comboHits: { count: 0, damage: 0, remaining: 0, active: false }, health: stats.maxHealth, action: { type: "ready" }, cooldown: 0, knockbackX: 0, knockbackY: 0 };
}
export function attackPhase(a: AttackAction): "startup" | "active" | "recovery" {
  return a.frame <= a.stats.startup ? "startup" : a.frame <= a.stats.startup + a.stats.active ? "active" : "recovery";
}
/** Convert the screen-relative facing to a normalized arena-space direction. */
export function facingVector(facing: Facing) {
  const angle = DIRECTIONS.indexOf(facing) * Math.PI / 4;
  const sx = Math.round(Math.cos(angle)), sy = Math.round(Math.sin(angle));
  const x = sx / 0.65 + sy / 0.32, y = sy / 0.32 - sx / 0.65;
  const length = Math.hypot(x, y);
  return { x: x / length, y: y / length };
}
/** Oriented rectangle versus circular hurt footprint, plus vertical intervals.
 * Touching edges count as hits. No projected pixels or sprite sizes are used. */
export function attackOverlaps(attacker: CombatFighter, target: CombatFighter, a: AttackAction): boolean {
  const d = facingVector(a.facing), dx = target.x - attacker.x, dy = target.y - attacker.y;
  const forward = dx * d.x + dy * d.y, side = -dx * d.y + dy * d.x;
  const nearestForward = Math.max(0, Math.min(a.stats.reach, forward));
  const nearestSide = Math.max(-a.stats.width / 2, Math.min(a.stats.width / 2, side));
  const horizontal = Math.hypot(forward - nearestForward, side - nearestSide) <= target.stats.hurtRadius;
  const bottom = attacker.z + a.stats.bottom, top = bottom + a.stats.height;
  return horizontal && top >= target.z && bottom <= target.z + target.stats.hurtHeight;
}

function move(f: CombatFighter, input: CombatInput): void {
  const locked = f.action.type !== "ready";
  const facing = f.facing;
  // Attacks retain air steering; ground attacks and hit reactions lock voluntary movement.
  const movement = !locked ? input : f.action.type === "attack" && f.state === "jump" ? { ...input, jump: false } : NO_INPUT;
  stepFighter(f, movement, f.stats.movement);
  if (locked) f.facing = facing;
  const limitX = ARENA.width / 2 - f.stats.movement.radius;
  const limitY = ARENA.depth / 2 - f.stats.movement.radius;
  f.x = Math.max(-limitX, Math.min(limitX, f.x + f.knockbackX * STEP));
  f.y = Math.max(-limitY, Math.min(limitY, f.y + f.knockbackY * STEP));
  const speed = Math.hypot(f.knockbackX, f.knockbackY);
  const scale = speed ? Math.max(0, speed - f.stats.knockbackDrag * STEP) / speed : 0;
  f.knockbackX = scale ? f.knockbackX * scale : 0;
  f.knockbackY = scale ? f.knockbackY * scale : 0;
}

export function clearComboInput(f: CombatFighter): void {
  if (f.action.type === "attack") f.action.buffered = undefined;
}
export function clearComboFeedback(f: CombatFighter): void {
  f.comboHits = { count: 0, damage: 0, remaining: 0, active: false };
}
export function comboStage(f: CombatFighter) {
  return f.action.type === "attack" && !f.action.airborne
    ? (f.stats.combo ?? DEFAULT_COMBO).stages.find(s => s.id === (f.action as AttackAction).comboStage)
    : undefined;
}
function stageAction(f: CombatFighter, id: string, facing: Facing): AttackAction {
  const stage = (f.stats.combo ?? DEFAULT_COMBO).stages.find(s => s.id === id)!;
  return { type: "attack", kind: stage.kind, airborne: false, frame: 1, facing,
    stats: { ...f.stats.attacks.ground[stage.kind], ...stage.overrides }, hitTargets: new Set(), comboStage: id };
}

/** One fixed 60 Hz tick. Inputs are press edges consumed by the caller once.
 * Resolve all contacts before applying hits: simultaneous active attacks trade. */
export function stepCombat(fighters: readonly CombatFighter[], inputs: readonly CombatInput[]): HitEvent[] {
  const lockedAtStart = new Set(fighters.filter(f => f.action.type === "hitstun").map(f => f.id));
  for (const f of fighters) {
    if (f.comboHits.remaining > 0 && --f.comboHits.remaining === 0) clearComboFeedback(f);
    if (f.comboHits.active && !lockedAtStart.has(f.comboHits.targetId!)) f.comboHits.active = false;
  }
  for (let i = 0; i < fighters.length; i++) {
    const f = fighters[i], input = inputs[i] ?? NO_INPUT;
    const cooling = f.cooldown > 0;
    if (cooling) f.cooldown--;
    const stunned = f.action.type === "hitstun";
    const wasAirborne = f.state === "jump";
    if (f.action.type === "attack") {
      f.action.frame++;
      const a = f.action;
      if (a.frame > a.stats.startup + a.stats.active + a.stats.recovery) {
        f.cooldown = a.stats.cooldown;
        f.action = { type: "ready" };
      }
    }
    // The final hitstun tick still locks controls and discards attack/jump presses.
    move(f, input);
    if (wasAirborne && f.state !== "jump") clearComboInput(f);
    if (f.action.type === "attack") {
      const a = f.action, stage = comboStage(f);
      if (stage?.next && stage.cancel && f.state !== "landing") {
        if (input.attack && stage.inputs!.includes(input.attack) && !a.buffered)
          a.buffered = { kind: input.attack, remaining: (f.stats.combo ?? DEFAULT_COMBO).bufferTicks };
        if (a.buffered && a.frame >= stage.cancel[0] && a.frame <= stage.cancel[1] && a.hitTargets.size > 0) {
          f.action = stageAction(f, stage.next, a.facing);
        } else if (a.buffered && --a.buffered.remaining === 0) a.buffered = undefined;
      } else a.buffered = undefined;
    }
    if (f.action.type === "hitstun" && --f.action.remaining <= 0) f.action = { type: "ready" };
    if (input.attack && f.action.type === "ready" && !stunned && !cooling && f.cooldown === 0 && f.state !== "landing") {
      const airborne = f.state === "jump";
      f.action = { type: "attack", kind: input.attack, airborne, frame: 1, facing: f.facing,
        stats: f.stats.attacks[airborne ? "air" : "ground"][input.attack], hitTargets: new Set() };
      if (!airborne && input.attack === "light") f.action = stageAction(f, (f.stats.combo ?? DEFAULT_COMBO).stages[0].id, f.facing);
    }
  }
  const contacts: { attacker: CombatFighter; target: CombatFighter; attack: AttackAction }[] = [];
  for (const attacker of fighters) {
    const a = attacker.action;
    if (a.type !== "attack" || attackPhase(a) !== "active") continue;
    for (const target of fighters) {
      if (target === attacker || target.health === 0 || a.hitTargets.has(target.id) || !attackOverlaps(attacker, target, a)) continue;
      a.hitTargets.add(target.id);
      contacts.push({ attacker, target, attack: a });
    }
  }
  const events = contacts.map(({ attacker, target, attack }) => {
    const damage = Math.min(target.health, attack.stats.damage);
    const counter = attacker.comboHits;
    const consecutive = counter.active && counter.targetId === target.id && lockedAtStart.has(target.id);
    counter.count = consecutive ? counter.count + 1 : 1;
    counter.damage = consecutive ? counter.damage + damage : damage;
    counter.targetId = target.id; counter.remaining = 45; counter.active = true;
    clearComboFeedback(target);
    target.health -= damage;
    target.action = target.health === 0 ? { type: "ko" } : { type: "hitstun", remaining: attack.stats.hitstun };
    target.cooldown = Math.max(target.cooldown, attack.stats.hitstun);
    const d = facingVector(attack.facing);
    target.knockbackX = d.x * attack.stats.knockback;
    target.knockbackY = d.y * attack.stats.knockback;
    if (attack.stats.launch > 0) {
      target.vz = attack.stats.launch;
      target.state = "jump";
      target.landingRemaining = 0;
    }
    return { attackerId: attacker.id, defenderId: target.id, damage, x: target.x, y: target.y, z: target.z + target.stats.hurtHeight / 2, comboStage: attack.comboStage, comboCount: attacker.comboHits.count };
  });
}
