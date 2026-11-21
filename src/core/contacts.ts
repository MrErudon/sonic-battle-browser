import { clearComboFeedback, facingVector, type AttackAction, type CombatFighter, type HitEvent } from "./combat";
import { defenseConfig } from "./defense";
import type { HitPayload, SpecialId } from "./specials";
import type { Vector2 } from "./collision";

export interface Contact {
  id: string; attacker: CombatFighter; target: CombatFighter;
  payload: Readonly<HitPayload>; direction: Vector2; blocked: boolean;
  x: number; y: number; z: number;
  normal?: AttackAction; specialId?: SpecialId; source?: "special"|"projectile";
}
/** All contacts use their pre-resolution defensive snapshot. Combined guard
 * exhaustion breaks once; every contact classified blocked still deals chip.
 * Apply one health/guard/reaction transaction per defender, never resurrect KO.
 */
export function resolveContacts(contacts: readonly Contact[], lockedAtStart: ReadonlySet<string>): HitEvent[] {
  const ordered=[...contacts].sort((a,b)=>a.id.localeCompare(b.id,"en")||a.target.id.localeCompare(b.target.id,"en"));
  const groups=new Map<CombatFighter,Contact[]>();
  for(const c of ordered){const group=groups.get(c.target)??[];group.push(c);groups.set(c.target,group);}
  const events=new Map<Contact,HitEvent>();
  for(const [target,group] of groups){
    const cfg=defenseConfig(target);
    let health=target.health,guard=target.guard.value,broken=false;
    for(const c of group){
      const guardDamage=c.blocked?Math.min(guard,c.payload.guardDamage):0;
      guard-=guardDamage;
      const breaks:boolean=c.blocked&&guard===0&&!broken;broken ||= breaks;
      const damage=Math.min(health,c.blocked?Math.ceil(c.payload.damage*cfg.chipRatio):c.payload.damage);
      health-=damage;
      const event:HitEvent={attackerId:c.attacker.id,defenderId:target.id,damage,x:c.x,y:c.y,z:c.z,
        comboStage:c.normal?.comboStage,outcome:breaks?"guard_break":c.blocked?"block":"hit"};
      if(c.blocked)event.guardDamage=guardDamage;
      if(c.specialId){event.specialId=c.specialId;event.instanceId=c.id;event.source=c.source;}
      events.set(c,event);
    }
    target.health=health;target.guard.value=guard;target.guard.regenWait=cfg.regenDelay;
    if(broken&&target.guard.breakRemaining===0)target.guard.breakRemaining=cfg.breakTicks;
    const hits=group.filter(c=>!c.blocked);
    if(health===0){target.action={type:"ko"};target.guard.breakRemaining=0;}
    else if(hits.length){
      const stun=Math.max(...hits.map(c=>c.payload.hitstun));
      target.action={type:"hitstun",remaining:stun};target.cooldown=Math.max(target.cooldown,stun);
    }else if(broken)target.action={type:"guard_break"};
    else target.action={type:"blockstun",remaining:Math.max(...group.map(c=>c.payload.blockstun))};
    // Existing KO strikes still apply their knockback and launch.
    if(health===0&&hits.length)target.cooldown=Math.max(target.cooldown,...hits.map(c=>c.payload.hitstun));
    const strongest=[...group].sort((a,b)=>(b.payload.knockback*(b.blocked?cfg.knockbackRatio:1))-(a.payload.knockback*(a.blocked?cfg.knockbackRatio:1))||a.id.localeCompare(b.id,"en"))[0];
    const speed=strongest.payload.knockback*(strongest.blocked?cfg.knockbackRatio:1);
    target.knockbackX=strongest.direction.x*speed;target.knockbackY=strongest.direction.y*speed;
    const launch=Math.max(0,...hits.map(c=>c.payload.launch));
    if(launch>0){target.vz=launch;target.state="jump";target.landingRemaining=0;}
  }
  // Feedback uses the captured contacts/attack objects, not actions overwritten
  // by reactions. Normal-only single incoming contacts preserve the old trace.
  for(const c of ordered){
    const e=events.get(c)!;
    if(c.blocked||!c.normal){
      clearComboFeedback(c.attacker);clearComboFeedback(c.target);
      if(c.normal)c.normal.confirmedTargets??=new Set();
    }else{
      (c.normal.confirmedTargets??=new Set()).add(c.target.id);
      const counter=c.attacker.comboHits;
      const consecutive=counter.active&&counter.targetId===c.target.id&&lockedAtStart.has(c.target.id);
      counter.count=consecutive?counter.count+1:1;
      counter.damage=consecutive?counter.damage+e.damage:e.damage;
      counter.targetId=c.target.id;counter.remaining=45;counter.active=true;
      e.comboCount=counter.count;clearComboFeedback(c.target);
    }
  }
  for(const c of ordered)clearComboFeedback(c.target);
  return ordered.map(c=>events.get(c)!);
}
/** Projectiles face the incoming path. Dash callers supply interpolated contact
 * positions, so passing the target later in this tick cannot bypass guard. */
export function blocksIncoming(target:CombatFighter, towardSource:Vector2):boolean{
  if(target.guard.breakRemaining||target.z!==0||target.state==="jump"||target.state==="landing"||
    (target.action.type!=="blocking"&&target.action.type!=="blockstun"))return false;
  if(Math.hypot(towardSource.x,towardSource.y)<1e-9)return false;
  const d=facingVector(target.facing);return towardSource.x*d.x+towardSource.y*d.y>=-1e-9;
}
