import Phaser from "phaser";
import { projectArena } from "../core/arena";
import { facingVector, type CombatFighter } from "../core/combat";
import { specialPhase } from "../core/specials";
import type { CombatState } from "../core/projectiles";

/** Original procedural indicators. Animation IDs are definition.effectId + phase;
 * all positions, phases and lifetimes come from the simulation. */
export class SpecialView {
  private casts: Phaser.GameObjects.Graphics[];
  private orbs=new Map<string,Phaser.GameObjects.Graphics>();
  constructor(private scene:Phaser.Scene){this.casts=[scene.add.graphics(),scene.add.graphics()];}
  sync(fighters:readonly CombatFighter[],world:Readonly<CombatState>):void{
    fighters.forEach((f,i)=>{
      const g=this.casts[i];g.clear();
      if(f.action.type!=="special")return;
      const a=f.action,s=a.definition,phase=specialPhase(a),d=facingVector(a.facing),p=projectArena(f.x,f.y);
      const color=i===0?0x55dced:0xffbf69,active=phase==="active";
      g.setDepth(p.y+.03).lineStyle(active?5:2,phase==="recovery"?0x8398ab:color,active?1:.5);
      const tip=projectArena(f.x+d.x*(s.reach||24),f.y+d.y*(s.reach||24));
      if(a.id==="power"){
        g.lineBetween(p.x,p.y-22,tip.x,tip.y-22);
        g.strokeEllipse(tip.x,tip.y-22,active?54:20,active?28:12);
      }else if(a.id==="dash"){
        const tail=projectArena(f.x-d.x*(active?35:12),f.y-d.y*(active?35:12));
        g.lineBetween(tail.x,tail.y-18,tip.x,tip.y-18);
        g.strokeTriangle(tip.x,tip.y-23,tip.x-7,tip.y-15,tip.x+7,tip.y-15);
      }else g.strokeCircle(p.x,p.y-22,phase==="startup"?6+8*a.frame/s.startup:12);
    });
    const live=new Set(world.projectiles.map(p=>p.id));
    for(const [id,g] of this.orbs)if(!live.has(id)){g.destroy();this.orbs.delete(id);}
    for(const orb of world.projectiles){
      let g=this.orbs.get(orb.id);if(!g){g=this.scene.add.graphics();this.orbs.set(orb.id,g);}
      const p=projectArena(orb.x,orb.y),owner=fighters.findIndex(f=>f.id===orb.ownerId);
      g.clear().setDepth(p.y+.04).lineStyle(2,owner===0?0x55dced:0xffbf69,1);
      g.strokeCircle(p.x,p.y-orb.z,8).fillStyle(0xe9f5ff,1).fillCircle(p.x,p.y-orb.z,3);
      const tail=projectArena(orb.x-orb.direction.x*12,orb.y-orb.direction.y*12);
      g.lineBetween(tail.x,tail.y-orb.z,p.x,p.y-orb.z);
    }
  }
  clear():void{this.casts.forEach(g=>g.clear());this.orbs.forEach(g=>g.destroy());this.orbs.clear();}
}
