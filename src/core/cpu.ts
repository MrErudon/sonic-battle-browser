import { canSpecial, specialConfig, type SpecialAction, type SpecialId } from "./specials";
import type { CombatState, Projectile } from "./projectiles";
import { canStartBlock } from "./defense";
import { comboStage, attackOverlaps, facingVector, type AttackAction, type AttackKind, type CombatFighter, type CombatInput } from "./combat";
import { DIRECTIONS, NO_INPUT, stepFighter } from "./movement";

export interface CpuConfig {
  comboChance?: number;
  specialChance?: number; specialReactionFrames?: number;
  blockChance?: number; defenseReactionFrames?: number; maxBlockFrames?: number;
  reactionFrames: number;
  attackInterval: number;
  pauseChance: number;
  pauseFrames: number;
  heavyChance: number;
  aerialChance: number;
  spacing: number;
  spacingSlack: number;
}
export type Difficulty = "Easy" | "Normal" | "Hard";
/** Provisional tuning; difficulty changes decisions, never fighter statistics. */
export const CPU_PRESETS: Readonly<Record<Difficulty, Readonly<CpuConfig>>> = {
  Easy: { specialChance: .10, specialReactionFrames: 24, blockChance: .20, defenseReactionFrames: 24, maxBlockFrames: 24, comboChance: .25, reactionFrames: 24, attackInterval: 70, pauseChance: 0.45, pauseFrames: 45, heavyChance: 0.1, aerialChance: 0.02, spacing: 44, spacingSlack: 12 },
  Normal: { specialChance: .25, specialReactionFrames: 12, blockChance: .45, defenseReactionFrames: 12, maxBlockFrames: 36, comboChance: .60, reactionFrames: 12, attackInterval: 40, pauseChance: 0.2, pauseFrames: 24, heavyChance: 0.35, aerialChance: 0.08, spacing: 44, spacingSlack: 10 },
  Hard: { specialChance: .40, specialReactionFrames: 8, blockChance: .70, defenseReactionFrames: 8, maxBlockFrames: 48, comboChance: .85, reactionFrames: 5, attackInterval: 24, pauseChance: 0.05, pauseFrames: 12, heavyChance: 0.5, aerialChance: 0.15, spacing: 44, spacingSlack: 8 },
};

/** Mulberry32: local state, including a valid zero seed; no global randomness. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inputs = DIRECTIONS.map((_, i) => ({
  x: Math.round(Math.cos(i * Math.PI / 4)),
  y: Math.round(Math.sin(i * Math.PI / 4)), jump: false,
}));

/** Choose among the SAME eight screen inputs as a keyboard player. Predict one
 * legal movement step so inverse projection, air control and wall clamping agree
 * with physics. A blocked direction cannot win over an improving direction. */
export function pursuitInput(self: CombatFighter, target: Pick<CombatFighter, "x" | "y">): CombatInput {
  let best: CombatInput = { ...NO_INPUT };
  let distance = Math.hypot(target.x - self.x, target.y - self.y);
  for (const input of inputs) {
    const next = { ...self };
    stepFighter(next, input, self.stats.movement);
    const candidate = Math.hypot(target.x - next.x, target.y - next.y);
    if (candidate < distance - 0.001) { distance = candidate; best = input; }
  }
  return { ...best };
}

function inRange(self: CombatFighter, target: CombatFighter, kind: AttackKind, horizontalOnly = false): boolean {
  const direction = facingVector(self.facing);
  if ((target.x - self.x) * direction.x + (target.y - self.y) * direction.y < 0) return false;
  const airborne = self.state === "jump";
  const attack: AttackAction = { type: "attack", kind, airborne, frame: 1,
    facing: self.facing, stats: self.stats.attacks[airborne ? "air" : "ground"][kind], hitTargets: new Set() };
  return attackOverlaps(self, horizontalOnly ? { ...target, z: self.z } : target, attack);
}

/** Call once BEFORE each stepCombat, never once per render. Only emits inputs;
 * neither fighter is mutated. No future inputs, health buffs or physics bypass. */
export class CpuController {
  private random: () => number;
  private defenseRandom: () => number;
  private observed?: AttackAction | SpecialAction | Projectile;
  private specialRandom: () => number;
  private specialAge=0; private specialWait=0; private specialCandidate?:SpecialId;
  private defenseAge = 0;
  private defenseDecided = false;
  private blockHeld = 0;
  private wait: number;
  private interval = 0;
  private reaction = 0;
  private approaching = true;
  private continued = new WeakSet<AttackAction>();
  readonly config: Readonly<CpuConfig>;

  constructor(config: Readonly<CpuConfig> = CPU_PRESETS.Normal, seed = 1) {
    for (const [key, value] of Object.entries(config)) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid CPU parameter: ${key}`);
    }
    for (const key of ["reactionFrames", "attackInterval", "pauseFrames"] as const) {
      if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`Invalid CPU frame count: ${key}`);
    }
    for (const key of ["pauseChance", "heavyChance", "aerialChance", "comboChance", "blockChance", "specialChance"] as const) {
      if ((config[key] ?? 0) > 1) throw new Error(`Invalid CPU probability: ${key}`);
    }
    for (const key of ["defenseReactionFrames", "maxBlockFrames", "specialReactionFrames"] as const)
      if (config[key] !== undefined && (!Number.isInteger(config[key]) || config[key]! < 1)) throw Error("Invalid defensive CPU duration");
    this.specialRandom = seededRandom(seed ^ 0xbb67ae85);
    this.defenseRandom = seededRandom(seed ^ 0x6a09e667);
    this.config = Object.freeze({ ...config });
    this.random = seededRandom(seed);
    this.wait = config.reactionFrames;
  }

  tick(self: CombatFighter, target: CombatFighter, world?:Readonly<CombatState>): CombatInput {
    const idle = { ...NO_INPUT };
    if(this.specialWait>0)this.specialWait--;
    if (this.interval > 0) this.interval--;
    if (self.health <= 0 || target.health <= 0) return idle;
    if (self.action.type === "attack") {
      const a = self.action, stage = comboStage(self);
      if (stage?.next && stage.cancel && (a.confirmedTargets ?? a.hitTargets).has(target.id) &&
          a.frame + 1 >= stage.cancel[0] && a.frame + 1 <= stage.cancel[1] && !this.continued.has(a)) {
        this.continued.add(a);
        const chance = this.config.comboChance ?? .60;
        if (this.random() < chance) return { ...idle, attack: "light" };
      }
    }
    // Observe only the present, published action and geometry. A new attack must
    // age through the configured reaction delay before a single seeded roll.
    const incoming=world?.projectiles.filter(p=>p.ownerId!==self.id).sort((a,b)=>Math.hypot(a.x-self.x,a.y-self.y)-Math.hypot(b.x-self.x,b.y-self.y)||a.id.localeCompare(b.id,"en"))[0];
    const threat:AttackAction|SpecialAction|Projectile|undefined = incoming ??
      (target.action.type==="attack"||target.action.type==="special" ? target.action : undefined);
    if (!threat) {
      // Remember an observed threat briefly while recovering from its hit. This
      // permits a delayed legal guard; it never buffers guard through hitstun.
      if (++this.defenseAge > (this.config.defenseReactionFrames ?? this.config.reactionFrames) + (this.config.maxBlockFrames ?? 36)) this.observed = undefined;
    } else if (this.observed !== threat) {
      this.observed = threat; this.defenseAge = 0; this.defenseDecided = false;
    } else this.defenseAge++;
    if (this.blockHeld > 0) {
      if (["block_startup", "blocking", "blockstun"].includes(self.action.type)) {
        this.blockHeld--; return { ...idle, block: true };
      }
      this.blockHeld = 0;
    }
    if (this.observed && !this.defenseDecided && canStartBlock(self) &&
        this.defenseAge >= (this.config.defenseReactionFrames ?? this.config.reactionFrames)) {
      this.defenseDecided = true;
      const attempt = this.defenseRandom() < (this.config.blockChance ?? 0);
      const facing = facingVector(self.facing);
      const dx = "ownerId" in this.observed ? -this.observed.direction.x : target.x - self.x;
      const dy = "ownerId" in this.observed ? -this.observed.direction.y : target.y - self.y;
      if (attempt && canStartBlock(self) && dx * facing.x + dy * facing.y >= 0 &&
          this.defensiveReach(self,target,this.observed)) {
        this.blockHeld = (this.config.maxBlockFrames ?? 36) - 1;
        return { ...idle, block: true };
      }
    }
    if(world){
      const candidate=this.specialChoice(self,target,world);
      if(candidate!==this.specialCandidate){this.specialCandidate=candidate;this.specialAge=0;}
      else if(candidate)this.specialAge++;
      if(candidate && this.specialAge >= (this.config.specialReactionFrames??this.config.reactionFrames) &&
          this.specialWait===0 && this.interval===0){
        this.specialAge=0;this.specialWait=this.config.attackInterval;
        if(this.specialRandom()<(this.config.specialChance??0)){
          this.interval=this.config.attackInterval;return {...idle,special:candidate};
        }
      }
    }
    if (self.action.type !== "ready" || self.cooldown > 0 || self.state === "landing") {
      this.reaction = 0;
      this.wait = this.config.reactionFrames;
      return idle;
    }
    if (this.wait > 0) { this.wait--; return idle; }
    const distance = Math.hypot(target.x - self.x, target.y - self.y);
    if (distance > this.config.spacing + this.config.spacingSlack) this.approaching = true;
    if (distance <= this.config.spacing) this.approaching = false;
    const horizontal = inRange(self, target, "light", true) || inRange(self, target, "heavy", true);
    if (this.approaching) return pursuitInput(self, target);
    if (!horizontal) {
      // Only turn when the resulting legal step still faces the target. This
      // excludes overshooting presses that reverse again on the following tick.
      for (const input of inputs) {
        const next = { ...self };
        stepFighter(next, input, self.stats.movement);
        if (inRange(next, target, "light", true) || inRange(next, target, "heavy", true)) return { ...input };
      }
      // At sub-step overlap, make room for one legal turn. This is a bounded
      // facing correction, not tactical retreat or direct position control.
      const scale = this.config.spacing / distance;
      return pursuitInput(self, { x: self.x + (self.x - target.x) * scale, y: self.y + (self.y - target.y) * scale });
    }
    const light = inRange(self, target, "light"), heavy = inRange(self, target, "heavy");
    // Height cannot be fixed by horizontal pursuit. Hold spacing and preserve
    // accumulated reaction time until an attack becomes vertically reachable.
    if (!light && !heavy) return idle;
    if (++this.reaction <= this.config.reactionFrames || this.interval > 0) return idle;
    this.reaction = 0;
    if (this.random() < this.config.pauseChance) { this.wait = this.config.pauseFrames; return idle; }
    let kind: AttackKind = this.random() < this.config.heavyChance ? "heavy" : "light";
    if (kind === "light" && !light) kind = "heavy";
    if (kind === "heavy" && !heavy) kind = "light";
    this.interval = this.config.attackInterval;
    // Jump+attack is the same legal edge combination available to P1. Startup
    // and changing height can still cause misses; the CPU cannot guarantee hits.
    return { ...idle, attack: kind, jump: self.z === 0 && this.random() < this.config.aerialChance };
  }

  private specialChoice(self:CombatFighter,target:CombatFighter,world:Readonly<CombatState>):SpecialId|undefined{
    const d=facingVector(self.facing),dx=target.x-self.x,dy=target.y-self.y,forward=dx*d.x+dy*d.y,side=Math.abs(-dx*d.y+dy*d.x);
    const id:SpecialId|undefined=forward>=0&&forward<=70?"power":forward>70&&forward<=140?"dash":forward>140&&forward<=280?"projectile":undefined;
    if(!id||!canSpecial(self,id,world.projectiles.some(p=>p.ownerId===self.id)))return;
    const s=specialConfig(self).definitions[id];
    if(side>(id==="projectile"?s.projectileRadius:s.width/2)+target.stats.hurtRadius||
      target.z>s.bottom+s.height||target.z+target.stats.hurtHeight<s.bottom)return;
    return id;
  }
  private defensiveReach(self:CombatFighter,target:CombatFighter,threat:AttackAction|SpecialAction|Projectile):boolean{
    if("ownerId" in threat){
      const dx=self.x-threat.x,dy=self.y-threat.y,d=threat.direction;
      return dx*d.x+dy*d.y>=0&&Math.abs(-dx*d.y+dy*d.x)<=self.stats.hurtRadius+threat.definition.projectileRadius&&
        Math.hypot(dx,dy)<=threat.remainingDistance+self.stats.hurtRadius;
    }
    if(threat.type==="attack")return attackOverlaps(target,self,threat);
    const s=threat.definition;
    return attackOverlaps(target,self,{type:"attack",kind:"heavy",airborne:false,frame:1,facing:threat.facing,
      hitTargets:new Set(),stats:{...s,cooldown:0,reach:s.reach+s.travel}});
  }
}
