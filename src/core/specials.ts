import type { Facing } from "./movement";
import type { CombatFighter, CombatInput } from "./combat";

export const SPECIAL_IDS = ["power", "dash", "projectile"] as const;
export type SpecialId = typeof SPECIAL_IDS[number];
export interface HitPayload {
  damage: number; hitstun: number; knockback: number; launch: number;
  guardDamage: number; blockstun: number;
}
export interface SpecialDefinition extends HitPayload {
  id: SpecialId; startup: number; active: number; recovery: number; recharge: number;
  reach: number; width: number; bottom: number; height: number;
  travel: number; projectileSpeed: number; projectileTravel: number; projectileRadius: number; projectileTicks: number;
  effectId: string;
}
export interface SpecialConfig { sharedLockout: number; generalCooldown: number; definitions: Readonly<Record<SpecialId, Readonly<SpecialDefinition>>> }
const common = { travel: 0, projectileSpeed: 0, projectileTravel: 0, projectileRadius: 0, projectileTicks: 0 };
export const DEFAULT_SPECIALS: Readonly<SpecialConfig> = immutableSpecials({
  sharedLockout: 60, generalCooldown: 4,
  definitions: {
    power: { ...common, id: "power", startup: 15, active: 4, recovery: 24, recharge: 120,
      damage: 20, hitstun: 26, knockback: 360, launch: 200, guardDamage: 35, blockstun: 10,
      reach: 85, width: 64, bottom: 4, height: 44, effectId: "special_power" },
    dash: { ...common, id: "dash", startup: 9, active: 8, recovery: 22, recharge: 150,
      damage: 12, hitstun: 18, knockback: 180, launch: 0, guardDamage: 20, blockstun: 6,
      reach: 32, width: 32, bottom: 6, height: 34, travel: 110, effectId: "special_dash" },
    projectile: { ...common, id: "projectile", startup: 18, active: 1, recovery: 20, recharge: 180,
      damage: 10, hitstun: 14, knockback: 120, launch: 0, guardDamage: 15, blockstun: 6,
      reach: 0, width: 12, bottom: 16, height: 12,
      projectileSpeed: 260, projectileTravel: 300, projectileRadius: 6, projectileTicks: 70, effectId: "special_projectile" },
  },
});
export function immutableSpecials(config: Readonly<SpecialConfig>): Readonly<SpecialConfig> {
  for (const key of ["sharedLockout", "generalCooldown"] as const)
    if (!Number.isInteger(config[key]) || config[key] < 1) throw Error("Invalid special cooldown");
  const definitions = {} as Record<SpecialId, Readonly<SpecialDefinition>>;
  for (const id of SPECIAL_IDS) {
    const s = config.definitions[id];
    if (!s || s.id !== id || !s.effectId) throw Error("Invalid special ID");
    for (const [key, value] of Object.entries(s))
      if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) throw Error("Invalid special number: "+key);
    for (const key of ["startup","active","recovery","recharge","hitstun","blockstun"] as const)
      if (!Number.isInteger(s[key]) || s[key] < 1) throw Error("Invalid special duration: "+key);
    for (const key of ["damage","knockback","launch","guardDamage","reach","width","bottom","height","travel","projectileSpeed","projectileTravel","projectileRadius","projectileTicks"] as const)
      if (!Number.isFinite(s[key]) || s[key] < 0) throw Error("Missing special number: "+key);
    if (s.width <= 0 || s.height <= 0 || s.guardDamage <= 0 || s.blockstun > (id === "power" ? 10 : 6)) throw Error("Invalid special contact");
    if (id !== "projectile" && s.reach <= 0) throw Error("Invalid special reach");
    if (id === "dash" && s.travel <= 0) throw Error("Invalid dash travel");
    if (id === "projectile" && (s.active !== 1 || s.projectileSpeed <= 0 || s.projectileTravel <= 0 || s.projectileRadius <= 0 ||
        !Number.isInteger(s.projectileTicks) || s.projectileTicks < Math.ceil(s.projectileTravel/(s.projectileSpeed/60)))) throw Error("Invalid projectile lifetime");
    // Terminal recovery plus the fastest default normal entry must leave a control gap.
    if (s.recovery + config.generalCooldown + 5 + 1 <= s.hitstun) throw Error("Unsafe special recovery");
    definitions[id] = Object.freeze({ ...s });
  }
  return Object.freeze({ sharedLockout: config.sharedLockout, generalCooldown: config.generalCooldown, definitions: Object.freeze(definitions) });
}
export interface SpecialAction {
  type: "special"; id: SpecialId; instanceId: string; frame: number; facing: Facing;
  definition: Readonly<SpecialDefinition>; hitTargets: Set<string>;
  travelRemaining: number; travelStopped: boolean; spawned: boolean;
}
export interface SpecialRuntime {
  recharge: Record<SpecialId,number>; shared: number; sequence: number;
}
export function createSpecialRuntime(): SpecialRuntime { return { recharge: {power:0,dash:0,projectile:0}, shared:0, sequence:0 }; }
export function specialConfig(f:CombatFighter):Readonly<SpecialConfig>{return f.stats.specials??DEFAULT_SPECIALS;}
export function specialPhase(a: SpecialAction): "startup" | "active" | "recovery" {
  return a.frame <= a.definition.startup ? "startup" : a.frame <= a.definition.startup+a.definition.active ? "active" : "recovery";
}
export function canSpecial(f: CombatFighter, id: SpecialId, hasProjectile = false): boolean {
  return f.health > 0 && f.action.type === "ready" && f.cooldown === 0 && f.guard.breakRemaining === 0 &&
    f.z === 0 && f.state !== "jump" && f.state !== "landing" && f.special.shared === 0 &&
    f.special.recharge[id] === 0 && (id !== "projectile" || !hasProjectile);
}
export function startSpecial(f: CombatFighter, id: SpecialId): void {
  const c=specialConfig(f), s=c.definitions[id];
  f.action={type:"special",id,instanceId:f.id+":"+ ++f.special.sequence,frame:1,facing:f.facing,definition:s,
    hitTargets:new Set(),travelRemaining:s.travel,travelStopped:false,spawned:false};
  f.special.recharge[id]=s.recharge;f.special.shared=c.sharedLockout;
  f.comboHits={count:0,damage:0,remaining:0,active:false};
}
export function tickRecharge(f: CombatFighter): void {
  for(const id of SPECIAL_IDS) if(f.special.recharge[id]>0)f.special.recharge[id]--;
  if(f.special.shared>0)f.special.shared--;
}
/** Same screen-facing conversion as movement, with no walk displacement. */
export function specialAim(f: CombatFighter, input: CombatInput): void {
  if(input.x || input.y){
    const index=(Math.round(Math.atan2(Math.sign(input.y),Math.sign(input.x))/(Math.PI/4))+8)%8;
    f.facing=(["e","se","s","sw","w","nw","n","ne"] as const)[index];
  }
}
