import { describe, expect, it } from "vitest";
import { createCombatFighter, DEFAULT_FIGHTER_STATS, facingVector, stepCombat, type AttackAction } from "../src/core/combat";
import { createCombatState } from "../src/core/projectiles";
import { SPECIAL_IDS } from "../src/core/specials";
import { NO_INPUT } from "../src/core/movement";
const hold={...NO_INPUT,block:true};
describe("combined live projectile and melee contacts",()=>{
  it.each([false,true])("one defensive snapshot for live orb + normal; reversed=%s",reverse=>{
    const d=facingVector("e"),a=createCombatFighter("a",0,0,"e"),b=createCombatFighter("b",150*d.x,150*d.y,"w"),world=createCombatState();
    for(let i=0;i<4;i++)stepCombat([b],[hold]);
    stepCombat([a,b],[{...NO_INPUT,special:"projectile"},hold],world);
    for(let i=0;i<47;i++)stepCombat([a,b],[NO_INPUT,hold],world);
    expect(a.action.type).toBe("ready");expect(world.projectiles).toHaveLength(1);
    expect(Math.hypot(world.projectiles[0].x,world.projectiles[0].y)).toBeCloseTo(29*260/60);
    // Prepare a legal active normal contact independently of the orb's instance.
    a.x=b.x-d.x*30;a.y=b.y-d.y*30;
    a.action={type:"attack",kind:"light",airborne:false,frame:5,facing:"e",
      stats:a.stats.attacks.ground.light,hitTargets:new Set(),confirmedTargets:new Set()};
    const normal=a.action as AttackAction;b.guard.value=20;
    const events=stepCombat(reverse?[b,a]:[a,b],reverse?[hold,NO_INPUT]:[NO_INPUT,hold],world);
    expect(events).toHaveLength(2);expect(events.map(e=>e.outcome)).toEqual(["block","guard_break"]);
    expect(events.reduce((n,e)=>n+e.damage,0)).toBe(5);expect(b.health).toBe(95);
    expect(b.guard.value).toBe(0);expect(b.guard.breakRemaining).toBe(36);
    expect(normal.confirmedTargets?.size).toBe(0);expect(a.comboHits.count).toBe(0);
    expect(world.projectiles).toHaveLength(0);
  });
  it("opposing live projectiles cross and deliver a simultaneous lethal trade",()=>{
    const d=facingVector("e"),a=createCombatFighter("a",0,0,"e"),b=createCombatFighter("b",100*d.x,100*d.y,"w"),world=createCombatState();
    a.health=b.health=10;
    stepCombat([a,b],[{...NO_INPUT,special:"projectile"},{...NO_INPUT,special:"projectile"}],world);
    let hits=0;
    for(let i=0;i<60&&a.health>0&&b.health>0;i++){
      const events=stepCombat([a,b],[NO_INPUT,NO_INPUT],world);
      if(events.length){expect(events).toHaveLength(2);hits+=events.length;}
    }
    expect(hits).toBe(2);expect(a.health).toBe(0);expect(b.health).toBe(0);
    expect(world.projectiles).toHaveLength(0);
  });
  it.each([[-324,-194],[324,194],[-324,194],[324,-194]])("rotating specials and normals at corner %s/%s allow actual defensive escape", (x,y)=>{
    const facing=x>0?"e":"w",d=facingVector(facing),a=createCombatFighter("a",x-d.x*30,y-d.y*30,facing);
    const b=createCombatFighter("b",x,y,x>0?"w":"e",{...DEFAULT_FIGHTER_STATS,maxHealth:10000}),world=createCombatState();
    let broke=false,escaped=false;
    for(let tick=0;tick<2400&&!escaped;tick++){
      const special=tick%60===0?SPECIAL_IDS[Math.floor(tick/60)%3]:undefined;
      const escape=broke&&b.action.type==="ready"&&b.guard.breakRemaining===0;
      const events=stepCombat([a,b],[{...NO_INPUT,special,attack:special?undefined:"light"},escape?{...NO_INPUT,jump:true}:hold],world);
      broke ||= events.some(e=>e.outcome==="guard_break");
      escaped=escape&&b.state==="jump"&&b.z>0;
    }
    expect(broke).toBe(true);expect(escaped).toBe(true);
  });
});
