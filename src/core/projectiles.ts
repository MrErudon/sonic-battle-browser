import { facingVector, type CombatFighter } from "./combat";
import { boundaryFraction, lerpPoint, sweepOrb, type Point3, type Vector2 } from "./collision";
import { blocksIncoming, type Contact } from "./contacts";
import type { SpecialDefinition } from "./specials";

export interface Projectile extends Point3 {
  id:string;ownerId:string;direction:Vector2;definition:Readonly<SpecialDefinition>;
  remainingDistance:number;remainingTicks:number;bornTick:number;
}
export interface CombatState { tick:number;projectiles:Projectile[] }
export function createCombatState():CombatState{return {tick:0,projectiles:[]};}
export function spawnProjectile(state:CombatState,owner:CombatFighter):void{
  const a=owner.action;if(a.type!=="special"||a.id!=="projectile"||a.spawned)return;
  a.spawned=true;
  if(state.projectiles.some(p=>p.ownerId===owner.id)||state.projectiles.length>=2)return;
  state.projectiles.push({id:a.instanceId,ownerId:owner.id,x:owner.x,y:owner.y,z:a.definition.bottom+a.definition.height/2,
    direction:facingVector(a.facing),definition:a.definition,remainingDistance:a.definition.projectileTravel,
    remainingTicks:a.definition.projectileTicks,bornTick:state.tick});
}
export function stepProjectiles(state:CombatState,fighters:readonly CombatFighter[],starts:ReadonlyMap<string,Point3>):Contact[]{
  const contacts:Contact[]=[],alive:Projectile[]=[];
  for(const p of [...state.projectiles].sort((a,b)=>a.id.localeCompare(b.id,"en"))){
    const owner=fighters.find(f=>f.id===p.ownerId);if(!owner||owner.health<=0)continue;
    const fresh=p.bornTick===state.tick;
    const distance=fresh?0:Math.min(p.definition.projectileSpeed/60,p.remainingDistance);
    const from={x:p.x,y:p.y,z:p.z},desired={x:p.x+p.direction.x*distance,y:p.y+p.direction.y*distance,z:p.z};
    const wall=boundaryFraction(from,desired,p.definition.projectileRadius),to=lerpPoint(from,desired,wall);
    let first:{target:CombatFighter;t:number}|undefined;
    for(const target of [...fighters].sort((a,b)=>a.id.localeCompare(b.id,"en"))){
      if(target.id===p.ownerId||target.health<=0)continue;
      const previous=fresh?target:(starts.get(target.id)??target);
      const targetAtWall=fresh?target:lerpPoint(previous,target,wall);
      const t=sweepOrb(from,to,previous,targetAtWall,p.definition.projectileRadius,target.stats.hurtRadius,target.stats.hurtHeight);
      if(t!==undefined&&(!first||t<first.t-1e-10))first={target,t};
    }
    if(first){
      const at=lerpPoint(from,to,first.t),target=first.target;
      contacts.push({id:p.id,attacker:owner,target,payload:p.definition,direction:p.direction,
        blocked:blocksIncoming(target,{x:-p.direction.x,y:-p.direction.y}),
        x:at.x,y:at.y,z:at.z,specialId:"projectile",source:"projectile"});
      continue;
    }
    p.x=to.x;p.y=to.y;p.remainingDistance=Math.max(0,p.remainingDistance-distance*wall);
    if(!fresh)p.remainingTicks--;
    if(wall===1&&p.remainingDistance>1e-9&&p.remainingTicks>0)alive.push(p);
  }
  state.projectiles=alive;return contacts;
}
