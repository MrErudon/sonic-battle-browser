import { describe, expect, it } from "vitest";
import { createCombatFighter, DEFAULT_FIGHTER_STATS, facingVector, stepCombat, type CombatFighter, type CombatInput, type AttackAction } from "../src/core/combat";
import { DEFAULT_SPECIALS, SPECIAL_IDS, immutableSpecials, specialPhase, type SpecialId } from "../src/core/specials";
import { createCombatState } from "../src/core/projectiles";
import { resolveContacts, type Contact } from "../src/core/contacts";
import { boundaryFraction, sweepAttack, sweepOrb } from "../src/core/collision";
import { DEFAULT_DEFENSE } from "../src/core/defense";
import { CPU_PRESETS, CpuController } from "../src/core/cpu";
import { COUNTDOWN_TICKS, MatchController, MatchInput } from "../src/core/match";
import { DIRECTIONS, NO_INPUT } from "../src/core/movement";

type Writable<T>={-readonly [K in keyof T]:T[K] extends object?Writable<T[K]>:T[K]};
const cloneConfig=()=>structuredClone(DEFAULT_SPECIALS) as Writable<typeof DEFAULT_SPECIALS>;
const hold={...NO_INPUT,block:true};
function pair(distance=30,facing:typeof DIRECTIONS[number]="e"){
  const d=facingVector(facing),opposite=DIRECTIONS[(DIRECTIONS.indexOf(facing)+4)%8];
  return [createCombatFighter("a",0,0,facing),createCombatFighter("b",d.x*distance,d.y*distance,opposite)] as const;
}
function run(fighters:readonly CombatFighter[]){
  const world=createCombatState();
  return {world,tick:(inputs:readonly CombatInput[]=[])=>stepCombat(fighters,inputs,world),
    ticks(n:number,inputs:readonly CombatInput[]=[]){for(let i=0;i<n;i++)stepCombat(fighters,inputs,world);}};
}
function activeNormal(f:CombatFighter,kind:"light"|"heavy"="light"){
  f.action={type:"attack",kind,airborne:false,frame:f.stats.attacks.ground[kind].startup,facing:f.facing,
    stats:f.stats.attacks.ground[kind],hitTargets:new Set(),confirmedTargets:new Set()};
}
function block(f:CombatFighter){const sim=run([f]);sim.ticks(4,[hold]);expect(f.action.type).toBe("blocking");}
function facingAt(f:CombatFighter,dir:typeof DIRECTIONS[number],forward:number,side=0){
  const d=facingVector(dir);return {x:f.x+d.x*forward-d.y*side,y:f.y+d.y*forward+d.x*side};
}
function fighting(){const m=new MatchController();m.start();for(let i=0;i<COUNTDOWN_TICKS;i++)m.tick();return m;}

describe("special definitions and exact timing",()=>{
  it("deeply freezes validated snapshots without retaining caller references",()=>{
    const copy=cloneConfig(),c=immutableSpecials(copy);
    copy.definitions.power.damage=77;
    expect(c.definitions.power.damage).toBe(20);expect(Object.isFrozen(c.definitions.power)).toBe(true);
    expect(Object.isFrozen(c.definitions)).toBe(true);expect(Object.isFrozen(DEFAULT_SPECIALS)).toBe(true);
  });
  it.each([0,-1,NaN,Infinity,1.5])("rejects invalid duration %s",n=>{
    const c=cloneConfig();c.definitions.power.startup=n;
    expect(()=>immutableSpecials(c)).toThrow();
  });
  it("rejects missing/invalid IDs, geometry, damage, finite numbers, projectile life and unsafe recovery",()=>{
    const mutations=[
      (c:any)=>delete c.definitions.dash,(c:any)=>c.definitions.power.id="dash",
      (c:any)=>c.definitions.dash.travel=0,(c:any)=>c.definitions.power.width=0,
      (c:any)=>c.definitions.power.damage=-1,(c:any)=>c.definitions.projectile.projectileSpeed=NaN,
      (c:any)=>c.definitions.projectile.active=2,(c:any)=>c.definitions.projectile.projectileTicks=69,
      (c:any)=>c.definitions.power.hitstun=100,(c:any)=>c.sharedLockout=0,
    ];
    for(const mutate of mutations){const c=cloneConfig();mutate(c);expect(()=>immutableSpecials(c)).toThrow();}
  });
  it.each(SPECIAL_IDS)("%s exact startup/active/recovery/completion",id=>{
    const [a]=pair(),sim=run([a]),s=DEFAULT_SPECIALS.definitions[id];
    sim.tick([{...NO_INPUT,special:id}]);expect(a.action).toMatchObject({type:"special",id,frame:1});
    for(let frame=1;frame<=s.startup+s.active+s.recovery;frame++){
      expect(a.action.type).toBe("special");
      if(a.action.type!=="special")throw Error("missing special");
      expect(a.action.frame).toBe(frame);
      expect(specialPhase(a.action)).toBe(frame<=s.startup?"startup":frame<=s.startup+s.active?"active":"recovery");
      sim.tick();
    }
    expect(a.action.type).toBe("ready");expect(a.cooldown).toBe(4);
  });
  it.each(SPECIAL_IDS)("%s recharge charges once and expires at T+C",id=>{
    const [a]=pair(),sim=run([a]),c=DEFAULT_SPECIALS.definitions[id].recharge;
    sim.tick([{...NO_INPUT,special:id}]);expect(a.special.sequence).toBe(1);expect(a.special.recharge[id]).toBe(c);
    for(let t=1;t<c;t++){sim.tick([{...NO_INPUT,special:id}]);expect(a.special.sequence).toBe(1);}
    expect(a.special.recharge[id]).toBe(1);
    sim.tick([{...NO_INPUT,special:id}]);expect(a.special.sequence).toBe(2);expect(a.special.recharge[id]).toBe(c);
  });
  it("shared lockout expires at 60 while independent recharge remains",()=>{
    const [a]=pair(),sim=run([a]);sim.tick([{...NO_INPUT,special:"power"}]);
    sim.ticks(58);sim.tick([{...NO_INPUT,special:"dash"}]);expect(a.special.shared).toBe(1);expect(a.special.sequence).toBe(1);
    sim.tick([{...NO_INPUT,special:"dash"}]);expect(a.action).toMatchObject({type:"special",id:"dash"});
    expect(a.special.recharge.power).toBe(60);expect(a.special.recharge.dash).toBe(150);
  });
  it("general cooldown is distinct and its final tick still rejects actions",()=>{
    const [a]=pair(),sim=run([a]);a.cooldown=1;
    sim.tick([{...NO_INPUT,special:"power"}]);expect(a.special.shared).toBe(0);expect(a.action.type).toBe("ready");
    sim.tick([{...NO_INPUT,special:"power"}]);expect(a.special.recharge.power).toBe(120);
  });
  it("long special recharge permits normal attacks after recovery",()=>{
    const [a]=pair(),sim=run([a]);sim.tick([{...NO_INPUT,special:"power"}]);sim.ticks(47);
    sim.tick([{...NO_INPUT,attack:"light"}]);expect(a.action.type).toBe("attack");expect(a.special.recharge.power).toBeGreaterThan(0);
  });
  it.each(["attack","hitstun","block_startup","blocking","blockstun","block_recovery","guard_break","air","landing"] as const)("rejects activation in %s without cost or deferred activation",state=>{
    const [a]=pair(),sim=run([a]);
    if(state==="attack")activeNormal(a);
    else if(state==="hitstun")a.action={type:state,remaining:2};
    else if(state==="block_startup")a.action={type:state,frame:1};
    else if(state==="blocking")a.action={type:state};
    else if(state==="blockstun"||state==="block_recovery")a.action={type:state,remaining:2};
    else if(state==="guard_break"){a.guard.breakRemaining=2;a.action={type:state};}
    else if(state==="air"){a.state="jump";a.z=100;}
    else {a.state="landing";a.landingRemaining=2;}
    sim.tick([{...hold,special:"power"}]);expect(a.special.recharge.power).toBe(0);
    sim.ticks(120);expect(a.action.type).toBe("ready");expect(a.special.recharge.power).toBe(0);
  });
  it("does not cancel startup, active or recovery or refund interrupted special cost",()=>{
    const [a,b]=pair(),sim=run([a,b]);sim.tick([{...NO_INPUT,special:"projectile"}]);
    activeNormal(b);sim.tick([NO_INPUT,NO_INPUT]);expect(a.action.type).toBe("hitstun");
    expect(a.special.recharge.projectile).toBe(179);sim.ticks(40);
    expect(sim.world.projectiles).toHaveLength(0);
  });
  it("legacy stateless adapter rejects special activation rather than losing entities",()=>{
    const [a]=pair();expect(()=>stepCombat([a],[{...NO_INPUT,special:"projectile"}])).toThrow(/persistent/);
  });
});

describe("Power Burst and guard integration",()=>{
  it("deals 20 damage on frame 16 only, launches and cannot hit twice",()=>{
    const [a,b]=pair(),sim=run([a,b]);sim.tick([{...NO_INPUT,special:"power"}]);sim.ticks(14);
    expect(b.health).toBe(100);const e=sim.tick();expect(e[0]).toMatchObject({damage:20,specialId:"power",outcome:"hit"});
    expect(b.health).toBe(80);expect(b.action).toMatchObject({type:"hitstun",remaining:26});
    expect(b.vz).toBe(200);expect(Math.hypot(b.knockbackX,b.knockbackY)).toBeCloseTo(360);
    sim.ticks(30);expect(b.health).toBe(80);expect(a.comboHits.count).toBe(0);
  });
  it.each(SPECIAL_IDS)("%s frontal block chips and consumes special-specific guard without normal confirmations",id=>{
    const [a,b]=pair(id==="projectile"?70:id==="dash"?90:30),sim=run([a,b]);block(b);
    sim.tick([{...NO_INPUT,special:id},hold]);let events:any[]=[];
    for(let tick=0;tick<90&&!events.length;tick++)events=sim.tick([NO_INPUT,hold]);
    const s=DEFAULT_SPECIALS.definitions[id];
    expect(events[0]).toMatchObject({outcome:"block",damage:Math.ceil(s.damage*.25),guardDamage:s.guardDamage,specialId:id});
    expect(b.guard.value).toBe(100-s.guardDamage);expect(b.vz).toBe(0);expect(a.comboHits.count).toBe(0);
    expect(b.action).toMatchObject({type:"blockstun",remaining:s.blockstun});
  });
  it.each(SPECIAL_IDS)("%s rear contact bypasses guard and applies full damage",id=>{
    const [a,b]=pair(id==="projectile"?70:id==="dash"?90:30),sim=run([a,b]);block(b);b.facing="e";
    sim.tick([{...NO_INPUT,special:id},hold]);let events:any[]=[];
    for(let tick=0;tick<90&&!events.length;tick++)events=sim.tick([NO_INPUT,hold]);
    expect(events[0]).toMatchObject({outcome:"hit",damage:DEFAULT_SPECIALS.definitions[id].damage});
  });
  it("specials never join normal combo transitions or accept J/K cancels",()=>{
    const [a,b]=pair(),sim=run([a,b]);sim.tick([{...NO_INPUT,special:"power"}]);
    for(let i=0;i<35;i++){sim.tick([{...NO_INPUT,attack:"light"}]);expect(a.action.type).toBe("special");}
    expect(a.comboHits.count).toBe(0);expect(b.health).toBe(80);
  });
});

describe("Dash Strike swept travel and directional guard",()=>{
  it.each(DIRECTIONS)("%s travels exactly 110 over eight active ticks and locks facing",facing=>{
    const a=createCombatFighter("a",0,0,facing),sim=run([a]);sim.tick([{...NO_INPUT,special:"dash"}]);sim.ticks(8);
    expect(Math.hypot(a.x,a.y)).toBe(0);const d=facingVector(facing);
    for(let i=1;i<=8;i++){
      sim.tick([{x:-1,y:1,jump:true}]);expect(a.x).toBeCloseTo(d.x*13.75*i);expect(a.y).toBeCloseTo(d.y*13.75*i);
      expect(a.facing).toBe(facing);expect(a.z).toBe(0);
    }
    sim.tick();expect(Math.hypot(a.x,a.y)).toBeCloseTo(110);
  });
  it.each(DIRECTIONS)("%s clips at actual frontal block contact before passing defender",facing=>{
    const [a,b]=pair(90,facing),sim=run([a,b]);block(b);sim.tick([{...NO_INPUT,special:"dash"},hold]);
    let events:any[]=[];for(let i=0;i<20&&!events.length;i++)events=sim.tick([NO_INPUT,hold]);
    expect(events[0].outcome).toBe("block");expect(Math.hypot(a.x,a.y)).toBeCloseTo(42);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThan(40);const at=[a.x,a.y];
    sim.ticks(10,[NO_INPUT,hold]);expect([a.x,a.y]).toEqual(at);expect(b.health).toBe(97);
  });
  it.each(DIRECTIONS)("%s diagonal side tangent hits; outside rounded volume misses",facing=>{
    const hit=(side:number)=>{
      const [a,b]=pair(90,facing);Object.assign(b,facingAt(a,facing,90,side));
      const sim=run([a,b]);sim.tick([{...NO_INPUT,special:"dash"}]);let damage=0;
      for(let i=0;i<30;i++)damage+=sim.tick().reduce((n,e)=>n+e.damage,0);
      return damage;
    };
    expect(hit(32)).toBe(12);expect(hit(32.001)).toBe(0);
  });
  it.each(DIRECTIONS)("%s stops at every wall/corner without sliding, escaping or NaN",facing=>{
    for(const [x,y] of [[323,0],[-323,0],[0,193],[0,-193],[323,193],[-323,193],[323,-193],[-323,-193]]){
      const a=createCombatFighter("a",x,y,facing),sim=run([a]),d=facingVector(facing);
      const expected=boundaryFraction(a,{x:x+d.x*110,y:y+d.y*110,z:0},16)*110;
      sim.tick([{...NO_INPUT,special:"dash"}]);sim.ticks(20);
      expect(Math.hypot(a.x-x,a.y-y)).toBeCloseTo(expected);
      expect(Math.abs(a.x)).toBeLessThanOrEqual(324.000001);expect(Math.abs(a.y)).toBeLessThanOrEqual(194.000001);
      expect((a.x-x)*d.y-(a.y-y)*d.x).toBeCloseTo(0);
    }
  });
  it("sweep catches high travel and a moving target that would tunnel between endpoints",()=>{
    const [original,b]=pair(80),config=cloneConfig();config.definitions.dash.travel=1000;
    const a=createCombatFighter("a",0,0,"e",{...DEFAULT_FIGHTER_STATS,specials:config}),sim=run([a,b]);
    sim.tick([{...NO_INPUT,special:"dash"}]);sim.ticks(8);const events=sim.tick();
    expect(events[0].damage).toBe(12);expect(Math.hypot(a.x,a.y)).toBeCloseTo(32);
    expect(sweepAttack({x:0,y:0,z:0},{x:100,y:0,z:0},{x:60,y:50,z:0},{x:60,y:-50,z:0},{x:1,y:0},32,32,6,34,16,44)).toBeDefined();
    expect(original.health).toBe(100);
  });
});

describe("simulation-owned Energy Projectile",()=>{
  it("spawns exactly once on frame 19 and first moves on the next tick",()=>{
    const [a]=pair(),sim=run([a]);sim.tick([{...NO_INPUT,special:"projectile"}]);sim.ticks(17);
    expect(sim.world.projectiles).toHaveLength(0);sim.tick();
    expect(sim.world.projectiles).toHaveLength(1);const p=sim.world.projectiles[0];
    expect([p.x,p.y,p.z,p.remainingDistance,p.remainingTicks]).toEqual([0,0,22,300,70]);
    sim.tick();expect(Math.hypot(p.x,p.y)).toBeCloseTo(260/60);expect(sim.world.projectiles).toHaveLength(1);
    sim.ticks(20);expect(sim.world.projectiles).toHaveLength(1);
  });
  it("travels 299 in 69 steps then a final 1 unit and expires on step 70",()=>{
    const a=createCombatFighter("a",-160,0,"se"),sim=run([a]);sim.tick([{...NO_INPUT,special:"projectile"}]);sim.ticks(18);
    const p=sim.world.projectiles[0],origin={x:p.x,y:p.y};sim.ticks(69);
    expect(Math.hypot(p.x-origin.x,p.y-origin.y)).toBeCloseTo(299);expect(p.remainingTicks).toBe(1);
    sim.tick();expect(Math.hypot(p.x-origin.x,p.y-origin.y)).toBeCloseTo(300);expect(sim.world.projectiles).toHaveLength(0);
  });
  it("hits on initial overlap once, ignores owner and cannot be respawned by holding active frames",()=>{
    const [a,b]=pair(10),sim=run([a,b]);sim.tick([{...NO_INPUT,special:"projectile"}]);sim.ticks(17);
    const events=sim.tick();expect(events[0]).toMatchObject({damage:10,source:"projectile"});
    expect(a.health).toBe(100);expect(b.health).toBe(90);expect(sim.world.projectiles).toHaveLength(0);
    sim.ticks(25);expect(b.health).toBe(90);
  });
  it("finite wall expiration and projectile crossing do not create clashes",()=>{
    const a=createCombatFighter("a",-80,0,"se"),b=createCombatFighter("b",80,0,"nw"),sim=run([a,b]);
    // Offset height of the fighters after spawn to isolate projectile crossing.
    sim.tick([{...NO_INPUT,special:"projectile"},{...NO_INPUT,special:"projectile"}]);sim.ticks(18);
    expect(sim.world.projectiles).toHaveLength(2);
    a.z=b.z=150;a.state=b.state="jump";a.vz=b.vz=300;
    sim.ticks(20);expect(sim.world.projectiles).toHaveLength(2);
    sim.ticks(70);expect(sim.world.projectiles).toHaveLength(0);
    const c=createCombatFighter("c",320,0,"se"),edge=run([c]);edge.tick([{...NO_INPUT,special:"projectile"}]);edge.ticks(18);
    edge.ticks(4);expect(edge.world.projectiles).toHaveLength(0);
  });
  it("sweeps moving and jumping targets using vertical overlap at contact",()=>{
    expect(sweepOrb({x:0,y:0,z:22},{x:100,y:0,z:22},{x:50,y:50,z:0},{x:50,y:-50,z:0},6,16,44)).toBeDefined();
    expect(sweepOrb({x:0,y:0,z:22},{x:100,y:0,z:22},{x:50,y:0,z:100},{x:50,y:0,z:90},6,16,44)).toBeUndefined();
  });
  it("owner interruption after emission leaves projectile alive; owner KO clears it",()=>{
    const [a,b]=pair(100),sim=run([a,b]);sim.tick([{...NO_INPUT,special:"projectile"}]);sim.ticks(18);
    a.action={type:"hitstun",remaining:12};sim.tick();expect(sim.world.projectiles).toHaveLength(1);
    a.health=0;a.action={type:"ko"};sim.tick();expect(sim.world.projectiles).toHaveLength(0);
  });
  it("emission-tick contact trades with an incoming normal attack",()=>{
    const [a,b]=pair(10),sim=run([a,b]);sim.tick([{...NO_INPUT,special:"projectile"}]);sim.ticks(17);
    activeNormal(b);const events=sim.tick();expect(events).toHaveLength(2);
    expect(a.health).toBe(95);expect(b.health).toBe(90);expect(a.action.type).toBe("hitstun");
  });
  it("blocking follows incoming direction even after owner moves behind defender",()=>{
    const [a,b]=pair(100),sim=run([a,b]);block(b);sim.tick([{...NO_INPUT,special:"projectile"},hold]);sim.ticks(18,[NO_INPUT,hold]);
    const d=facingVector("e");a.x=b.x+d.x*100;a.y=b.y+d.y*100;
    let events:any[]=[];for(let i=0;i<40&&!events.length;i++)events=sim.tick([NO_INPUT,hold]);
    expect(events[0]).toMatchObject({outcome:"block",damage:3});
  });
  it("rejects a second live projectile without charging the activation",()=>{
    const cfg=cloneConfig();cfg.definitions.projectile.recharge=1;
    const a=createCombatFighter("a",-160,0,"se",{...DEFAULT_FIGHTER_STATS,specials:cfg}),sim=run([a]);
    sim.tick([{...NO_INPUT,special:"projectile"}]);sim.ticks(59);
    sim.tick([{...NO_INPUT,special:"projectile"}]);
    expect(a.special.sequence).toBe(1);expect(a.special.shared).toBe(0);expect(a.special.recharge.projectile).toBe(0);
  });
});

describe("deterministic simultaneous contact aggregation",()=>{
  function setup(health=100,guard=20){
    const [a,b]=pair(),c=createCombatFighter("c",-10,0,"e");block(b);b.health=health;b.guard.value=guard;
    const payload=DEFAULT_SPECIALS.definitions.power;
    const contact=(owner:CombatFighter,id:string):Contact=>({id,attacker:owner,target:b,payload,direction:facingVector("e"),
      blocked:true,x:b.x,y:b.y,z:22,specialId:"power",source:"special"});
    return {a,b,c,contacts:[contact(a,"a:1"),contact(c,"c:1")]};
  }
  it("simultaneous exhaustion uses one snapshot: all blocked contacts chip, one guard break",()=>{
    const run=(reverse:boolean)=>{
      const {b,contacts}=setup();const events=resolveContacts(reverse?contacts.reverse():contacts,new Set());
      return {health:b.health,guard:b.guard,action:b.action,events};
    };
    expect(run(false)).toEqual(run(true));const r=run(false);
    expect(r.health).toBe(90);expect(r.guard.value).toBe(0);expect(r.guard.breakRemaining).toBe(36);
    expect(r.events.map(e=>e.outcome)).toEqual(["guard_break","block"]);
    expect(r.events.reduce((n,e)=>n+(e.guardDamage??0),0)).toBe(20);
  });
  it("simultaneous lethal chip clamps event totals and never resurrects KO",()=>{
    const {b,contacts}=setup(3),events=resolveContacts(contacts,new Set());
    expect(events.reduce((n,e)=>n+e.damage,0)).toBe(3);expect(b.health).toBe(0);
    expect(b.action.type).toBe("ko");expect(b.guard.breakRemaining).toBe(0);
  });
  it("mixed rear hit and frontal guard break retain fixed break duration and normal hitstun",()=>{
    const {b,contacts}=setup();contacts[1]={...contacts[1],blocked:false,payload:DEFAULT_SPECIALS.definitions.dash};
    resolveContacts(contacts,new Set());expect(b.health).toBe(83);
    expect(b.action).toMatchObject({type:"hitstun",remaining:18});expect(b.guard.breakRemaining).toBe(36);
    const sim=run([b]);sim.ticks(18);expect(b.action.type).toBe("guard_break");expect(b.guard.breakRemaining).toBe(18);
    sim.ticks(18);expect(b.guard.value).toBe(100);expect(b.action.type).toBe("ready");
  });
  it("chooses max incoming stun/launch and strongest knockback with stable ties",()=>{
    const {b,contacts}=setup();contacts[0].blocked=contacts[1].blocked=false;
    contacts[1]={...contacts[1],payload:DEFAULT_SPECIALS.definitions.dash,direction:{x:-1,y:0}};
    resolveContacts(contacts,new Set());expect(b.action).toMatchObject({type:"hitstun",remaining:26});
    expect(b.vz).toBe(200);expect(Math.hypot(b.knockbackX,b.knockbackY)).toBeCloseTo(360);
  });
  it("opposing lethal specials trade identically when fighter order is reversed",()=>{
    const play=(reverse:boolean)=>{
      const [a,b]=pair();a.health=b.health=20;const fs=reverse?[b,a]:[a,b],sim=runPair(fs);
      return [a.health,b.health,a.action.type,b.action.type,sim];
    };
    function runPair(fs:CombatFighter[]){const sim=run(fs);sim.tick(fs.map(()=>({...NO_INPUT,special:"power" as const})));sim.ticks(15);return sim.world.projectiles.length;}
    expect(play(false)).toEqual([0,0,"ko","ko",0]);expect(play(true)).toEqual(play(false));
  });
});

describe("special input priority, lifecycle and deterministic scheduling",()=>{
  it("selection is captured at I keydown; release/repeat cannot activate twice",()=>{
    const input=new MatchInput();input.press("Digit2",false,true);input.release("Digit2");
    input.press("KeyI",false,true);input.press("Digit3",false,true);
    expect(input.consume().special).toBe("dash");expect(input.selectedSpecial).toBe("projectile");
    input.press("KeyI",true,true);expect(input.consume().special).toBeUndefined();
    input.release("KeyI");input.press("KeyI",false,true);expect(input.consume().special).toBe("projectile");
  });
  it.each(["J-first","I-first","K-first","I-before-K"] as const)("%s deterministically gives J/K priority over I",order=>{
    const m=fighting();const normal=order.includes("K")?"KeyK":"KeyJ";
    if(order.startsWith("I")){m.press("KeyI");m.press(normal);}else{m.press(normal);m.press("KeyI");}
    m.tick();expect(m.fighters[0].action).toMatchObject({type:"attack",kind:normal==="KeyK"?"heavy":"light"});
    expect(m.fighters[0].special.shared).toBe(0);
  });
  it("block and jump retain priority; directional special aims without walk displacement",()=>{
    const [a]=pair(),sim=run([a]);sim.tick([{...hold,special:"power"}]);expect(a.action.type).toBe("block_startup");expect(a.special.shared).toBe(0);
    const [b]=pair(),air=run([b]);air.tick([{...NO_INPUT,jump:true,special:"power"}]);expect(b.state).toBe("jump");expect(b.special.shared).toBe(0);
    const [c]=pair(),aim=run([c]);aim.tick([{x:0,y:1,jump:false,special:"power"}]);expect(c.facing).toBe("s");expect([c.x,c.y]).toEqual([0,0]);
  });
  it("short I tap survives zero-tick frames but cannot buffer through hitstun",()=>{
    const m=fighting();m.press("KeyI");m.release("KeyI");m.advance(4);m.advance(4);expect(m.fighters[0].action.type).toBe("ready");
    m.advance(9);expect(m.fighters[0].action).toMatchObject({type:"special",frame:1});
    const n=fighting();n.fighters[0].action={type:"hitstun",remaining:3};n.press("KeyI");n.release("KeyI");
    for(let i=0;i<6;i++)n.tick();expect(n.fighters[0].special.shared).toBe(0);
  });
  it.each(["help","focus"] as const)("%s freezes projectiles/recharge and discards queued I while resuming accepted action",boundary=>{
    const m=fighting();m.selectSpecial("projectile");m.press("KeyI");m.release("KeyI");for(let i=0;i<19;i++)m.tick();
    expect(m.combat.projectiles).toHaveLength(1);m.press("KeyI");
    if(boundary==="help")m.setHelp(true);else m.setFocused(false);
    const before=structuredClone([m.fighters,m.combat]);m.advance(10000);expect([m.fighters,m.combat]).toEqual(before);
    if(boundary==="help")m.setHelp(false);else m.setFocused(true);
    m.press("KeyI",true);m.tick();expect(m.fighters[0].special.sequence).toBe(1);
    expect(m.combat.projectiles[0].remainingDistance).toBeLessThan(300);
  });
  it("double KO is adjudicated after special contacts; round/menu/rematch clear all entities/recharge",()=>{
    const m=fighting(),[a,b]=m.fighters,d=facingVector("e");
    a.x=a.y=0;b.x=d.x*30;b.y=d.y*30;a.facing="e";b.facing="w";a.health=b.health=20;
    let emitted=false;Object.assign(m,{cpu:{tick:()=>{if(emitted)return NO_INPUT;emitted=true;return {...NO_INPUT,special:"power"};}}});
    m.press("KeyI");for(let i=0;i<16;i++)m.tick();
    expect(m.result).toBe("Draw");expect(m.score).toEqual([0,0]);expect(m.state).toBe("Round Over");
    expect(m.combat.projectiles).toHaveLength(0);expect(a.special.shared).toBe(0);
    for(let i=0;i<120;i++)m.tick();expect(m.state).toBe("Countdown");expect(m.round).toBe(1);
    expect(m.fighters.every(f=>f.special.recharge.power===0&&f.special.shared===0)).toBe(true);
    m.menu();expect(m.input.selectedSpecial).toBe("power");expect(m.combat.projectiles).toHaveLength(0);
    Object.assign(m,{currentState:"Match Over"});m.start();expect(m.combat.tick).toBe(0);
  });
  it.each([10,30,60,144,240])("%i Hz matches exact special/projectile/guard/contact traces",hz=>{
    const runRate=(rate:number)=>{
      const [a,b]=pair(160);const sim=run([a,b]);let acc=0,tick=0;const trace=[];
      for(let frame=0;frame<rate*12;frame++){acc+=1/rate;while(acc+1e-10>=1/60){
        const id=SPECIAL_IDS[Math.floor(tick/180)%3];
        const hits=sim.tick([{...NO_INPUT,special:tick%180===0?id:undefined},tick%120<90?hold:NO_INPUT]);
        trace.push(structuredClone([a,b,sim.world,hits]));tick++;acc-=1/60;
      }}return trace;
    };expect(runRate(hz)).toEqual(runRate(60));
  });
});

describe("CPU special use and defense",()=>{
  it("preset probabilities produce distinct seeded special frequencies at equal opportunities",()=>{
    const counts=[];
    for(const difficulty of ["Easy","Normal","Hard"] as const){
      const [a,b]=pair(40),world=createCombatState();
      const cpu=new CpuController({...CPU_PRESETS[difficulty],reactionFrames:1,specialReactionFrames:1,attackInterval:1,pauseChance:1,pauseFrames:1},42);
      let count=0;for(let i=0;i<6000;i++)if(cpu.tick(a,b,world).special)count++;
      counts.push(count);
    }
    expect(counts[0]).toBeGreaterThan(0);expect(counts[1]).toBeGreaterThan(counts[0]);expect(counts[2]).toBeGreaterThan(counts[1]);
  });
  it.each(["Easy","Normal","Hard"] as const)("%s waits configured delay, selects range-aware specials and emits legal inputs",difficulty=>{
    for(const [distance,id] of [[40,"power"],[100,"dash"],[200,"projectile"]] as const){
      const [a,b]=pair(distance),world=createCombatState(),config={...CPU_PRESETS[difficulty],specialChance:1,pauseChance:1};
      const cpu=new CpuController(config,42);let chosen:CombatInput|undefined;
      for(let tick=0;tick<=config.specialReactionFrames!;tick++){
        const before=structuredClone([a,b]),input=cpu.tick(a,b,world);expect([a,b]).toEqual(before);
        if(tick<config.specialReactionFrames!)expect(input.special).toBeUndefined();else chosen=input;
      }
      expect(chosen?.special).toBe(id);stepCombat([a,b],[chosen!,NO_INPUT],world);
      expect(a.action).toMatchObject({type:"special",id});expect(a.special.recharge[id]).toBe(DEFAULT_SPECIALS.definitions[id].recharge);
      expect(cpu.tick(a,b,world).special).toBeUndefined();
    }
  });
  it.each(["Easy","Normal","Hard"] as const)("%s actually connects specials through combat with deterministic seeded replay",difficulty=>{
    const runSeed=(seed:number)=>{
      const [a,b]=pair(40),sim=run([a,b]);const cpu=new CpuController({...CPU_PRESETS[difficulty],specialChance:1,pauseChance:1},seed);
      const trace=[];let hits=0;
      for(let i=0;i<300;i++){
        const input=cpu.tick(a,b,sim.world),events=sim.tick([input,NO_INPUT]);
        hits+=events.filter(e=>e.specialId).length;trace.push([input,a.x,a.y,b.health,events]);if(b.health===0)break;
      }return {hits,trace};
    };
    const result=runSeed(42);expect(result.hits).toBeGreaterThan(0);expect(runSeed(42)).toEqual(result);
  });
  it("cannot use specials backwards, airborne, during recharge/attack/hitstun or on a future threat",()=>{
    const [a,b]=pair(40),world=createCombatState(),cpu=new CpuController({...CPU_PRESETS.Hard,specialChance:1,specialReactionFrames:1});
    a.facing="w";for(let i=0;i<3;i++)expect(cpu.tick(a,b,world).special).toBeUndefined();
    a.facing="e";a.special.shared=30;for(let i=0;i<3;i++)expect(cpu.tick(a,b,world).special).toBeUndefined();
    a.special.shared=0;a.action={type:"hitstun",remaining:10};for(let i=0;i<3;i++)expect(cpu.tick(a,b,world).special).toBeUndefined();
    expect(b.action.type).toBe("ready");
  });
  it("observes emitted projectiles with delayed defense, not the owner's new position",()=>{
    const [owner,self]=pair(200),sim=run([owner,self]);sim.tick([{...NO_INPUT,special:"projectile"}]);sim.ticks(18);
    const d=facingVector("e");owner.x=self.x+d.x*100;owner.y=self.y+d.y*100;
    const cpu=new CpuController({...CPU_PRESETS.Hard,blockChance:1,defenseReactionFrames:2},42);
    let block=false;
    for(let i=0;i<3;i++){const input=cpu.tick(self,owner,sim.world);if(i<2)expect(input.block).not.toBe(true);block ||= Boolean(input.block);}
    expect(block).toBe(true);
  });
});
