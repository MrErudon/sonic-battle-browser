import { notify, type PresentationSink } from "../presentation/snapshot";
import { specialConfig, immutableSpecials, createSpecialRuntime, tickRecharge, canSpecial, startSpecial, specialAim, specialPhase, type SpecialConfig, type SpecialRuntime, type SpecialId, type SpecialAction } from "./specials";
import { createCombatState, spawnProjectile, stepProjectiles, type CombatState } from "./projectiles";
import { resolveContacts, blocksIncoming, type Contact } from "./contacts";
import { boundaryFraction, lerpPoint, sweepAttack, type Point3 } from "./collision";
import { DEFAULT_DEFENSE, blocksContact, defenseConfig, guardCost, stepDefense, validateDefense, type DefenseAction, type DefenseConfig, type GuardState } from "./defense";
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
  specials?: Readonly<SpecialConfig>;
  defense?: Readonly<DefenseConfig>;
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
  instanceId?: string;
  /** Contacts are consumed once; only unblocked damage confirms a continuation. */
  confirmedTargets?: Set<string>;
  buffered?: { kind: AttackKind; remaining: number };
}
export type Action = { type: "ready" } | AttackAction | { type: "hitstun"; remaining: number } | { type: "ko" } | DefenseAction | SpecialAction;
export interface CombatFighter extends Fighter {
  guard: GuardState;
  special: SpecialRuntime;
  id: string; health: number; stats: Readonly<FighterStats>; action: Action;
  comboHits: { count: number; damage: number; targetId?: string; remaining: number; active: boolean };
  cooldown: number; knockbackX: number; knockbackY: number;
}
export interface CombatInput extends MovementInput { attack?: AttackKind; block?: boolean; special?: SpecialId }
/** Scalar diagnostic event; consumers cannot mutate simulation objects. */
export interface AcceptedAttack { readonly ownerId:string; readonly instanceId:string; readonly kind:string }
export interface HitEvent { attackKind?: string; attackerId: string; defenderId: string; damage: number; x: number; y: number; z: number; comboStage?: string; comboCount?: number; outcome?: "hit" | "block" | "guard_break"; guardDamage?: number; specialId?: SpecialId; instanceId?: string; source?: "special"|"projectile" }
export function createCombatFighter(id: string, x: number, y: number, facing: Facing = "s", stats = DEFAULT_FIGHTER_STATS): CombatFighter {
  validateCombo(stats.combo ?? DEFAULT_COMBO, stats.attacks.ground);
  validateDefense(stats.defense ?? DEFAULT_DEFENSE);
  const immutableStats=stats.specials?{...stats,specials:immutableSpecials(stats.specials)}:stats;
  return { ...createFighter(x, y, facing), id, stats:immutableStats, special: createSpecialRuntime(), guard: { value: (stats.defense ?? DEFAULT_DEFENSE).maxGuard, regenWait: 0, breakRemaining: 0 }, comboHits: { count: 0, damage: 0, remaining: 0, active: false }, health: stats.maxHealth, action: { type: "ready" }, cooldown: 0, knockbackX: 0, knockbackY: 0 };
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
    stats: { ...f.stats.attacks.ground[stage.kind], ...stage.overrides }, instanceId: f.id+":"+ ++f.special.sequence, hitTargets: new Set(), confirmedTargets: new Set(), comboStage: id };
}

/** One fixed 60 Hz tick. Inputs are press edges consumed by the caller once.
 * Resolve all contacts before applying hits: simultaneous active attacks trade. */
export function stepCombat(fighters: readonly CombatFighter[], inputs: readonly CombatInput[], state?: CombatState, accepted?: (event:AcceptedAttack)=>void, presentation?: PresentationSink): HitEvent[] {
  if(!state && inputs.some(i=>i?.special)) throw Error("Specials require persistent CombatState");
  const world=state??createCombatState(); world.tick++;
  const accept=(event:AcceptedAttack)=>{accepted?.(event);notify(presentation,{type:"accepted",attack:event,tick:world.tick});};
  const starts=new Map(fighters.map(f=>[f.id,{x:f.x,y:f.y,z:f.z}]));
  const lockedAtStart = new Set(fighters.filter(f => f.action.type === "hitstun").map(f => f.id));
  for (const f of fighters) {
    if (f.comboHits.remaining > 0 && --f.comboHits.remaining === 0) clearComboFeedback(f);
    if (f.comboHits.active && !lockedAtStart.has(f.comboHits.targetId!)) f.comboHits.active = false;
  }
  for (let i = 0; i < fighters.length; i++) {
    const f = fighters[i], input = inputs[i] ?? NO_INPUT;
    tickRecharge(f);
    const cooling = f.cooldown > 0;
    if (cooling) f.cooldown--;
    const stunned = f.action.type === "hitstun";
    const wasAirborne = f.state === "jump";
    const defenseLocked = stepDefense(f, input, cooling, stunned);
    if (f.action.type === "attack") {
      f.action.frame++;
      const a = f.action;
      if (a.frame > a.stats.startup + a.stats.active + a.stats.recovery) {
        f.cooldown = a.stats.cooldown;
        f.action = { type: "ready" };
      }
    }
    if(f.action.type==="special"){
      const a=f.action;a.frame++;
      if(a.frame>a.definition.startup+a.definition.active+a.definition.recovery){
        f.cooldown=specialConfig(f).generalCooldown;f.action={type:"ready"};
      }
    }
    if(input.special && !input.attack && !input.jump && !defenseLocked && !stunned && !cooling &&
        canSpecial(f,input.special,world.projectiles.some(p=>p.ownerId===f.id))){
      specialAim(f,input);startSpecial(f,input.special);
      accept(Object.freeze({ownerId:f.id,instanceId:(f.action as SpecialAction).instanceId!,kind:input.special}));
    }
    // The final hitstun tick still locks controls and discards attack/jump presses.
    move(f, defenseLocked ? NO_INPUT : input);
    if (wasAirborne && f.state !== "jump") clearComboInput(f);
    if (f.action.type === "attack") {
      const a = f.action, stage = comboStage(f);
      if (stage?.next && stage.cancel && f.state !== "landing") {
        if (input.attack && stage.inputs!.includes(input.attack) && !a.buffered)
          a.buffered = { kind: input.attack, remaining: (f.stats.combo ?? DEFAULT_COMBO).bufferTicks };
        if (a.buffered && a.frame >= stage.cancel[0] && a.frame <= stage.cancel[1] && (a.confirmedTargets ?? a.hitTargets).size > 0) {
          f.action = stageAction(f, stage.next, a.facing);
          accept(Object.freeze({ownerId:f.id,instanceId:f.action.instanceId!,kind:f.action.comboStage!}));
        } else if (a.buffered && --a.buffered.remaining === 0) a.buffered = undefined;
      } else a.buffered = undefined;
    }
    if (f.action.type === "hitstun" && --f.action.remaining <= 0)
      f.action = f.guard.breakRemaining > 0 ? { type: "guard_break" } : { type: "ready" };
    if (input.attack && f.action.type === "ready" && !defenseLocked && !stunned && !cooling && f.cooldown === 0 && f.state !== "landing") {
      const airborne = f.state === "jump";
      f.action = { type: "attack", kind: input.attack, airborne, frame: 1, facing: f.facing,
        stats: f.stats.attacks[airborne ? "air" : "ground"][input.attack], instanceId: f.id+":"+ ++f.special.sequence, hitTargets: new Set(), confirmedTargets: new Set() };
      if (!airborne && input.attack === "light") f.action = stageAction(f, (f.stats.combo ?? DEFAULT_COMBO).stages[0].id, f.facing);
      if(f.action.type==="attack")accept(Object.freeze({ownerId:f.id,instanceId:f.action.instanceId!,kind:f.action.comboStage??(airborne?"air_":"ground_")+input.attack}));
    }
  }
  const contacts:Contact[]=[];
  // Plan both dash paths before collecting swept contacts. A hit clips travel
  // at time of impact; normals/projectiles subsequently see the clipped endpoint.
  const dashPlans=new Map<CombatFighter,{from:Point3;to:Point3;wall:number}>();
  for(const f of fighters){
    const a=f.action;
    if(a.type!=="special"||specialPhase(a)!=="active"||a.id!=="dash"||a.travelStopped)continue;
    const d=facingVector(a.facing),distance=Math.min(a.definition.travel/a.definition.active,a.travelRemaining);
    const from={x:f.x,y:f.y,z:f.z},desired={x:f.x+d.x*distance,y:f.y+d.y*distance,z:f.z};
    const wall=boundaryFraction(from,desired,f.stats.movement.radius);
    dashPlans.set(f,{from,to:lerpPoint(from,desired,wall),wall});
  }
  for(const [f,plan] of dashPlans){
    const a=f.action as SpecialAction,d=facingVector(a.facing),s=a.definition;
    let first:{target:CombatFighter;t:number;from:Point3;to:Point3}|undefined;
    for(const target of [...fighters].sort((a,b)=>a.id.localeCompare(b.id,"en"))){
      if(target===f||target.health<=0||a.hitTargets.has(target.id))continue;
      const targetFrom=starts.get(target.id)!,targetTo=dashPlans.get(target)?.to??target;
      const t=sweepAttack(plan.from,plan.to,targetFrom,targetTo,d,s.reach,s.width,s.bottom,s.height,target.stats.hurtRadius,target.stats.hurtHeight);
      if(t!==undefined&&(!first||t<first.t-1e-10))first={target,t,from:targetFrom,to:targetTo};
    }
    const t=first?.t??1,at=lerpPoint(plan.from,plan.to,t);
    f.x=at.x;f.y=at.y;
    a.travelRemaining=Math.max(0,a.travelRemaining-Math.hypot(at.x-plan.from.x,at.y-plan.from.y));
    if(first){
      const targetAt=lerpPoint(first.from,first.to,first.t);
      a.hitTargets.add(first.target.id);a.travelStopped=true;
      contacts.push({id:a.instanceId,attacker:f,target:first.target,payload:s,direction:d,
        blocked:blocksIncoming({...first.target,...targetAt},{x:at.x-targetAt.x,y:at.y-targetAt.y}),
        x:targetAt.x,y:targetAt.y,z:targetAt.z+first.target.stats.hurtHeight/2,specialId:"dash",source:"special"});
    }
    if(plan.wall<1||a.travelRemaining<=1e-9)a.travelStopped=true;
  }
  for(const attacker of fighters){
    const a=attacker.action;
    if(a.type==="special"){
      if(specialPhase(a)!=="active")continue;
      if(a.id==="projectile"){
        const before=world.projectiles.length;spawnProjectile(world,attacker);
        if(presentation&&world.projectiles.length>before){const p=world.projectiles[world.projectiles.length-1];notify(presentation,{type:"projectile",tick:world.tick,projectile:{id:p.id,ownerId:p.ownerId,x:p.x,y:p.y,z:p.z,dx:p.direction.x,dy:p.direction.y,bornTick:p.bornTick}});}
        continue;
      }
      if(a.id==="dash")continue; // travel sweep owns dash contacts
      const s=a.definition,d=facingVector(a.facing);
      for(const target of fighters){
        if(target===attacker||target.health<=0||a.hitTargets.has(target.id))continue;
        if(sweepAttack(attacker,attacker,target,target,d,s.reach,s.width,s.bottom,s.height,target.stats.hurtRadius,target.stats.hurtHeight)===undefined)continue;
        a.hitTargets.add(target.id);
        contacts.push({id:a.instanceId,attacker,target,payload:s,direction:d,blocked:blocksContact(target,attacker),
          x:target.x,y:target.y,z:target.z+target.stats.hurtHeight/2,specialId:"power",source:"special"});
      }
    }else if(a.type==="attack"&&attackPhase(a)==="active"){
      for(const target of fighters){
        if(target===attacker||target.health===0||a.hitTargets.has(target.id)||!attackOverlaps(attacker,target,a))continue;
        a.hitTargets.add(target.id);
        contacts.push({id:a.instanceId??attacker.id+":legacy",attacker,target,normal:a,
          payload:{...a.stats,guardDamage:guardCost(target,a),blockstun:defenseConfig(target).blockstun[a.kind]},
          direction:facingVector(a.facing),blocked:blocksContact(target,attacker),
          x:target.x,y:target.y,z:target.z+target.stats.hurtHeight/2});
      }
    }
  }
  contacts.push(...stepProjectiles(world,fighters,starts));
  const events=resolveContacts(contacts,lockedAtStart);
  if(presentation)for(const hit of events)notify(presentation,{type:"contact",hit:{...hit},tick:world.tick});
  if(fighters.some(f=>f.health===0))world.projectiles=[];
  return events;
}
