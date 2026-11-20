import { describe, expect, it } from "vitest";
import { createCombatFighter, DEFAULT_FIGHTER_STATS, facingVector, stepCombat, type AttackAction, type CombatInput } from "../src/core/combat";
import { DEFAULT_DEFENSE, blocksContact, canStartBlock, clearDefense, validateDefense } from "../src/core/defense";
import { CpuController, CPU_PRESETS } from "../src/core/cpu";
import { DEFAULT_COMBO } from "../src/core/combos";
import { COUNTDOWN_TICKS, MatchController, MatchInput } from "../src/core/match";
import { DIRECTIONS, NO_INPUT } from "../src/core/movement";

const hold: CombatInput = { ...NO_INPUT, block: true };
function pair() {
  const d = facingVector("e");
  return [createCombatFighter("a", 0, 0, "e"), createCombatFighter("b", d.x * 30, d.y * 30, "w")] as const;
}
function active(a: ReturnType<typeof createCombatFighter>, kind: "light" | "heavy" = "light", stage?: string, airborne = false) {
  const base = a.stats.attacks[airborne ? "air" : "ground"][kind];
  const overrides = DEFAULT_COMBO.stages.find(s => s.id === stage)?.overrides;
  a.action = { type: "attack", kind, airborne, frame: base.startup, facing: a.facing,
    stats: { ...base, ...overrides }, hitTargets: new Set(), confirmedTargets: new Set(), comboStage: stage };
  // Light 3 has its own longer startup.
  a.action.frame = a.action.stats.startup;
}
function block(b: ReturnType<typeof createCombatFighter>) {
  for (let i = 0; i < 4; i++) stepCombat([b], [hold]);
  expect(b.action.type).toBe("blocking");
}
function fighting() {
  const m = new MatchController(); m.start();
  for (let i = 0; i < COUNTDOWN_TICKS; i++) m.tick();
  return m;
}

describe("defense timing and legality", () => {
  it("has exactly three vulnerable startup frames and blocks on frame four", () => {
    const [a,b] = pair();
    for (let frame = 1; frame <= 3; frame++) {
      stepCombat([b], [hold]); expect(b.action).toMatchObject({ type: "block_startup", frame });
      expect(blocksContact(b,a)).toBe(false);
    }
    stepCombat([b], [hold]); expect(blocksContact(b,a)).toBe(true);
  });
  it.each([1,2,3])("startup frame %i takes full damage", frame => {
    const [a,b] = pair();
    for(let i=1;i<frame;i++) stepCombat([b],[hold]);
    active(a); const hits = stepCombat([a,b],[NO_INPUT,hold]);
    expect(hits[0].outcome).toBe("hit"); expect(b.health).toBe(95);
  });
  it("release starts six full locked recovery ticks and never replays attack/jump", () => {
    const [a,b]=pair(); block(b);
    stepCombat([b],[NO_INPUT]); expect(b.action).toMatchObject({type:"block_recovery",remaining:6});
    const before=[b.x,b.y,b.facing];
    for(let i=0;i<6;i++) {
      stepCombat([b],[{x:1,y:1,jump:true,attack:"heavy",block:true}]);
      expect([b.x,b.y,b.facing]).toEqual(before); expect(b.z).toBe(0);
      expect(b.action.type).toBe(i===5?"ready":"block_recovery");
    }
    stepCombat([b],[NO_INPUT]); expect(b.action.type).toBe("ready");
    stepCombat([b],[hold]); expect(b.action).toMatchObject({type:"block_startup",frame:1});
    expect(a.health).toBe(100);
  });
  it("early release pays recovery; block wins simultaneous neutral attack and jump", () => {
    const [a]=pair();
    stepCombat([a],[{...hold,attack:"light",jump:true}]);
    expect(a.action.type).toBe("block_startup"); expect(a.z).toBe(0);
    stepCombat([a],[NO_INPUT]); expect(a.action).toMatchObject({type:"block_recovery",remaining:6});
  });
  it.each(["startup","active","recovery"] as const)("cannot cancel attack %s into block", phase => {
    const [a]=pair(); active(a);
    const act=a.action as AttackAction; act.frame=phase==="startup"?1:phase==="active"?6:10;
    stepCombat([a],[hold]); expect(a.action.type).toBe("attack");
  });
  it.each(["hitstun","cooldown","airborne","landing"] as const)("cannot block during %s including final locked tick", state => {
    const [a]=pair();
    if(state==="hitstun")a.action={type:"hitstun",remaining:1};
    if(state==="cooldown")a.cooldown=1;
    if(state==="airborne"){a.state="jump";a.z=80;}
    if(state==="landing"){a.state="landing";a.landingRemaining=2;}
    stepCombat([a],[hold]); expect(["block_startup","blocking"]).not.toContain(a.action.type);
  });
  it("held block is reevaluated after hitstun and cooldown without buffering attacks", () => {
    const [a]=pair(); a.action={type:"hitstun",remaining:1}; a.cooldown=1;
    stepCombat([a],[{...hold,attack:"heavy"}]); expect(a.action.type).toBe("ready");
    stepCombat([a],[hold]); expect(a.action.type).toBe("block_startup");
  });
  it.each(DIRECTIONS)("frontal/rear defense uses arena-space facing %s", facing => {
    const b=createCombatFighter("b",0,0,facing),d=facingVector(facing);
    const a=createCombatFighter("a",d.x*30,d.y*30);b.action={type:"blocking"};
    expect(blocksContact(b,a)).toBe(true);a.x*=-1;a.y*=-1;expect(blocksContact(b,a)).toBe(false);
    a.x=0;a.y=0;expect(blocksContact(b,a)).toBe(false);
    a.x=-d.y*30;a.y=d.x*30;expect(blocksContact(b,a)).toBe(true);
  });
});

describe("blocks, chip and guard",()=>{
  it.each([
    ["light","light_1",false,2,18,6],["light","light_2",false,2,22,6],
    ["light","light_3",false,2,26,6],["heavy",undefined,false,4,45,10],
    ["heavy","finisher",false,4,45,10],["light",undefined,true,3,25,6],
    ["heavy",undefined,true,3,35,10],
  ] as const)("%s/%s air=%s applies configured chip/guard/stun", (kind,stage,airborne,chip,cost,stun)=>{
    const [a,b]=pair();block(b);active(a,kind,stage,airborne);
    const events=stepCombat([a,b],[NO_INPUT,hold]);
    expect(events[0]).toMatchObject({outcome:"block",damage:chip,guardDamage:cost});
    expect(b.health).toBe(100-chip);expect(b.guard.value).toBe(100-cost);
    expect(b.action).toMatchObject({type:"blockstun",remaining:stun});
    expect(b.vz).toBe(0);expect(b.z).toBe(0);
    expect(Math.hypot(b.knockbackX,b.knockbackY)).toBeCloseTo((a.action as AttackAction).stats.knockback*.25);
    for(let i=0;i<stun;i++) stepCombat([b],[hold]);
    expect(b.action.type).toBe("blocking");
  });
  it("rear attacks deal full damage and interrupt guard",()=>{
    const [a,b]=pair();block(b);b.facing="e";active(a,"heavy");
    expect(stepCombat([a,b],[NO_INPUT,hold])[0].outcome).toBe("hit");
    expect(b.health).toBe(85);expect(b.state).toBe("jump");
  });
  it("an airborne defender cannot guard; aerial height misses still miss",()=>{
    const [a,b]=pair();block(b);b.z=150;b.state="jump";active(a);
    expect(stepCombat([a,b],[NO_INPUT,hold])).toEqual([]);expect(b.health).toBe(100);
  });
  it("one attack cannot repeat blocked contact or confirm a chain",()=>{
    const [a,b]=pair();block(b);active(a,"light","light_1");
    expect(stepCombat([a,b],[NO_INPUT,hold])).toHaveLength(1);
    const act=a.action as AttackAction; expect(act.hitTargets.has(b.id)).toBe(true);
    expect(act.confirmedTargets?.size).toBe(0);
    for(let i=0;i<10;i++) {
      stepCombat([a,b],[{...NO_INPUT,attack:"light"},hold]);
      expect((a.action as AttackAction).comboStage).toBe("light_1");
    }
    expect(a.comboHits.count).toBe(0);expect(b.health).toBe(98);
  });
  it("chip can KO and clamps to remaining health",()=>{
    const [a,b]=pair();block(b);b.health=1;active(a,"heavy");
    expect(stepCombat([a,b],[NO_INPUT,hold])[0].damage).toBe(1);
    expect(b.health).toBe(0);expect(b.action.type).toBe("ko");expect(canStartBlock(b)).toBe(false);
  });
  it("regen waits sixty ticks then restores .5 only at grounded ready",()=>{
    const [a,b]=pair();block(b);active(a);stepCombat([a,b],[NO_INPUT,hold]);
    b.action={type:"ready"};b.knockbackX=b.knockbackY=0;
    for(let i=0;i<60;i++)stepCombat([b],[NO_INPUT]);
    expect(b.guard.value).toBe(82);stepCombat([b],[NO_INPUT]);expect(b.guard.value).toBe(82.5);
    b.action={type:"blocking"};for(let i=0;i<20;i++)stepCombat([b],[hold]);expect(b.guard.value).toBe(82.5);
  });
  it("validates configurable tuning and bounds",()=>{
    expect(()=>validateDefense(DEFAULT_DEFENSE)).not.toThrow();
    for(const change of [{startup:0},{breakTicks:NaN},{maxGuard:-1},{chipRatio:1.1},{regenPerTick:-1},{blockstun:{light:100,heavy:10}}])
      expect(()=>validateDefense({...DEFAULT_DEFENSE,...change})).toThrow();
    const a=createCombatFighter("a",0,0,"e",{...DEFAULT_FIGHTER_STATS,defense:{...DEFAULT_DEFENSE,maxGuard:150,chipRatio:0}});
    expect(a.guard.value).toBe(150);expect(DEFAULT_DEFENSE.maxGuard).toBe(100);
  });
});

describe("guard break and simultaneous resolution",()=>{
  it("breaking strike chips; follow-up damage never restarts the 36-tick timer",()=>{
    const [a,b]=pair();block(b);b.guard.value=18;active(a);
    expect(stepCombat([a,b],[NO_INPUT,hold])[0]).toMatchObject({outcome:"guard_break",damage:2});
    expect(b.guard.breakRemaining).toBe(36);expect(b.action.type).toBe("guard_break");
    for(let i=1;i<=36;i++){
      if(i===10)active(a,"light");
      const input=i===10?NO_INPUT:{...NO_INPUT};
      stepCombat(i===10?[a,b]:[b],i===10?[input,hold]:[hold]);
      expect(b.guard.breakRemaining).toBe(36-i);
      if(i<36)expect(canStartBlock(b)).toBe(false);
    }
    expect(b.guard.value).toBe(100);expect(b.health).toBe(93);expect(b.action.type).toBe("ready");
    stepCombat([b],[hold]);expect(b.action.type).toBe("block_startup");
  });
  it("late follow-up hitstun survives guard refill and completes normally",()=>{
    const [a,b]=pair();block(b);b.guard.value=1;active(a);stepCombat([a,b],[NO_INPUT,hold]);
    for(let i=0;i<35;i++)stepCombat([b],[hold]);
    active(a,"heavy");stepCombat([a,b],[NO_INPUT,hold]);
    expect(b.guard.breakRemaining).toBe(0);expect(b.guard.value).toBe(100);
    expect(b.action.type).toBe("hitstun");expect(b.health).toBe(83);
  });
  it("simultaneous lethal attacks still trade with block intents and reverse order",()=>{
    const run=(reverse:boolean)=>{
      const [a,b]=pair();a.health=b.health=5;active(a);active(b);
      const fs=reverse?[b,a]:[a,b];stepCombat(fs,[hold,hold]);
      return [a.health,b.health,a.action.type,b.action.type];
    };
    expect(run(false)).toEqual([0,0,"ko","ko"]);expect(run(true)).toEqual(run(false));
  });
  it("snapshots blocked contacts before other simultaneous reactions",()=>{
    const run=(reverse:boolean)=>{
      const [a,b]=pair();const d=facingVector("w");
      const c=createCombatFighter("c",b.x+d.x*25,b.y+d.y*25,"e");
      block(b);active(a);active(c);
      const fs=reverse?[c,b,a]:[a,b,c];const events=stepCombat(fs,fs.map(f=>f===b?hold:NO_INPUT));
      return {health:b.health,guard:b.guard.value,outcomes:events.filter(e=>e.defenderId==="b").map(e=>e.outcome).sort()};
    };
    expect(run(true)).toEqual(run(false));expect(run(false).outcomes).toEqual(["block","block"]);
  });
  it.each([[-324,0],[324,0],[0,-194],[0,194],[-324,-194],[324,194],[-324,194],[324,-194]])("wall/corner %i/%i pressure leaves control gaps",(x,y)=>{
    const b=createCombatFighter("b",x,y,x>0?"w":"e");
    const d=facingVector(b.facing),a=createCombatFighter("a",x+d.x*25,y+d.y*25,x>0?"e":"w");
    // Long legal repeated neutral attacks, not injected contacts.
    let ready=0,damage=0,breaks=0;
    for(let i=0;i<1800;i++){
      const events=stepCombat([a,b],[{...NO_INPUT,attack:"light"},hold]);
      damage+=events.reduce((n,e)=>n+e.damage,0);breaks+=events.filter(e=>e.outcome==="guard_break").length;
      if(b.action.type==="ready")ready++;
      if(b.health===0)break;
    }
    expect(damage).toBeGreaterThan(0);expect(breaks).toBeGreaterThan(0);expect(ready).toBeGreaterThan(0);
  });
});

describe("CPU defense uses delayed observed actions and legal inputs",()=>{
  it.each(["Easy","Normal","Hard"] as const)("%s honors delay, seeded decisions and defense duration",difficulty=>{
    const run=(seed:number)=>{
      const [target,self]=pair();const preset=CPU_PRESETS[difficulty];
      const cpu=new CpuController({...preset,blockChance:1},seed);
      active(target,"heavy");const seen=[];
      for(let i=0;i<=preset.defenseReactionFrames!;i++){
        const before=structuredClone([self,target]),input=cpu.tick(self,target);
        expect([self,target]).toEqual(before);seen.push(input);
        if(i<preset.defenseReactionFrames!)expect(input.block).not.toBe(true);
        else expect(input.block).toBe(true);
      }
      return seen;
    };
    expect(run(1)).toEqual(run(1));
  });
  it.each(["Easy","Normal","Hard"] as const)("%s can defend default and slow real heavy attacks with ordinary inputs",difficulty=>{
    for (const startup of [12,40]) {
    let blocked=0;
    // Start facing and ready. Slow repeated attacks allow the configured reaction window.
    for(const seed of Array.from({length:32},(_,i)=>i)){
      const b=createCombatFighter("b",324,-194,"w"), d=facingVector("e");
      const original=createCombatFighter("a",b.x-d.x*30,b.y-d.y*30,"e");
      const stats={...DEFAULT_FIGHTER_STATS,attacks:{...DEFAULT_FIGHTER_STATS.attacks,ground:{...DEFAULT_FIGHTER_STATS.attacks.ground,heavy:{...DEFAULT_FIGHTER_STATS.attacks.ground.heavy,startup}}}};
      const a=createCombatFighter(original.id,original.x,original.y,original.facing,stats);
      const cpu=new CpuController(CPU_PRESETS[difficulty],seed);
      for(let i=0;i<2400;i++){
        const events=stepCombat([a,b],[{...NO_INPUT,attack:"heavy"},cpu.tick(b,a)]);
        blocked+=events.filter(e=>e.defenderId===b.id&&e.outcome==="block").length;
        if(a.health===0||b.health===0)break;
      }
    }
    // Easy's long reaction cannot block the first heavy's active frames; can
    // establish guard during its visible recovery for a later attack.
    expect(blocked, difficulty+" startup "+startup).toBeGreaterThan(0);
    }
  });
  it("CPU hold ends at its configured maximum, without rerolling one observed attack",()=>{
    const [original,b]=pair();
    const a=createCombatFighter("a",original.x,original.y,"e",{...DEFAULT_FIGHTER_STATS,
      attacks:{...DEFAULT_FIGHTER_STATS.attacks,ground:{...DEFAULT_FIGHTER_STATS.attacks.ground,
        heavy:{...DEFAULT_FIGHTER_STATS.attacks.ground.heavy,startup:100}}}});
    const cpu=new CpuController({...CPU_PRESETS.Easy,blockChance:1,defenseReactionFrames:2,maxBlockFrames:7},1);
    let held=0;
    for(let tick=0;tick<24;tick++){
      const input=cpu.tick(b,a);if(input.block)held++;
      stepCombat([a,b],[{...NO_INPUT,attack:tick===0?"heavy":undefined},input]);
    }
    expect(held).toBe(7);expect(b.action.type).toBe("ready");
  });
  it("guard release restarts a full regeneration delay after long holds",()=>{
    const [b]=pair();b.guard.value=20;block(b);
    for(let i=0;i<120;i++)stepCombat([b],[hold]);
    stepCombat([b],[NO_INPUT]);for(let i=0;i<6;i++)stepCombat([b],[NO_INPUT]);
    for(let i=0;i<60;i++)stepCombat([b],[NO_INPUT]);
    expect(b.guard.value).toBe(20);stepCombat([b],[NO_INPUT]);expect(b.guard.value).toBe(20.5);
  });
  it("hits during release recovery bypass guard and restore ordinary hitstun",()=>{
    const [a,b]=pair();block(b);stepCombat([b],[NO_INPUT]);active(a);
    expect(stepCombat([a,b],[NO_INPUT,hold])[0].outcome).toBe("hit");
    expect(b.action.type).toBe("hitstun");expect(b.health).toBe(95);
  });
  it("same seed replays defense, different seeds produce distinct decisions",()=>{
    const run=(seed:number)=>{
      const [a,b]=pair(),cpu=new CpuController({...CPU_PRESETS.Normal,defenseReactionFrames:1},seed),out=[];
      for(let i=0;i<30;i++){
        active(a,"heavy");out.push(Boolean(cpu.tick(b,a).block));
        out.push(Boolean(cpu.tick(b,a).block));b.action={type:"ready"};
      }return out;
    };
    expect(run(42)).toEqual(run(42));expect(run(1)).not.toEqual(run(5));
  });
  it("never starts guard during an attack or hitstun, even on guaranteed decision",()=>{
    const [a,b]=pair();active(a,"heavy");active(b);
    const cpu=new CpuController({...CPU_PRESETS.Hard,blockChance:1,defenseReactionFrames:1});
    cpu.tick(b,a);expect(cpu.tick(b,a).block).not.toBe(true);
    b.action={type:"hitstun",remaining:3};active(a);cpu.tick(b,a);
    expect(cpu.tick(b,a).block).not.toBe(true);
  });
});

describe("defense input, pause, match lifecycle and scheduling",()=>{
  it("hold uses current state; short tap and repeats do not latch",()=>{
    const input=new MatchInput();
    input.press("KeyL",false,true);expect(input.consume().block).toBe(true);
    expect(input.consume().block).toBe(true);input.release("KeyL");expect(input.consume().block).toBe(false);
    input.press("KeyL",false,true);input.release("KeyL");expect(input.consume().block).toBe(false);
    input.press("KeyL",true,true);expect(input.consume().block).toBe(false);
    input.press("KeyL",false,true);input.clear();input.press("KeyL",false,true);
    expect(input.consume().block).toBe(false);input.release("KeyL");input.press("KeyL",false,true);
    expect(input.consume().block).toBe(true);
  });
  it.each(["help","focus"] as const)("%s freezes timers, clears held block and needs a fresh press",boundary=>{
    const m=fighting();m.press("KeyL");for(let i=0;i<4;i++)m.tick();
    expect(m.fighters[0].action.type).toBe("blocking");
    if(boundary==="help")m.setHelp(true);else m.setFocused(false);
    const before=structuredClone(m.fighters);
    m.advance(5000);expect(m.fighters).toEqual(before);
    if(boundary==="help")m.setHelp(false);else m.setFocused(true);
    m.press("KeyL",true);for(let i=0;i<8;i++)m.tick();
    expect(m.fighters[0].action.type).toBe("ready");
    m.release("KeyL");m.press("KeyL");m.tick();expect(m.fighters[0].action.type).toBe("block_startup");
  });
  it("menu, KO transition, round reset and rematch clear defense and restore guard",()=>{
    const m=fighting(),p=m.fighters[0];
    p.guard.value=1;p.guard.breakRemaining=30;p.action={type:"guard_break"};m.menu();
    expect(m.fighters[0].guard).toEqual({value:100,regenWait:0,breakRemaining:0});
    m.start();for(let i=0;i<COUNTDOWN_TICKS;i++)m.tick();
    m.fighters[0].health=0;m.fighters[1].action={type:"blocking"};m.tick();
    expect(m.state).toBe("Round Over");expect(m.fighters[1].action.type).toBe("ready");
    for(let i=0;i<120;i++)m.tick();expect(m.state).toBe("Countdown");
    expect(m.fighters.every(f=>f.guard.value===100&&f.guard.breakRemaining===0)).toBe(true);
    m.fighters[0].guard.value=1;Object.assign(m,{currentState:"Match Over"});m.start();
    expect(m.fighters[0].guard.value).toBe(100);expect(m.input.consume().block).toBe(false);
  });
  it.each([10,30,60,144,240])("%i Hz has identical defense, break and hit traces",hz=>{
    const run=(rate:number)=>{
      const [a,b]=pair();let acc=0,tick=0;const trace=[];
      for(let render=0;render<rate*12;render++){
        acc+=1/rate;
        while(acc+1e-10>=1/60){
          const hits=stepCombat([a,b],[{...NO_INPUT,attack:tick%50===0?"heavy":undefined},tick%180<150?hold:NO_INPUT]);
          trace.push([tick,a.health,b.health,b.guard.value,b.guard.breakRemaining,structuredClone(b.action),hits]);
          tick++;acc-=1/60;
        }
      }return trace;
    };
    expect(run(hz)).toEqual(run(60));
  });
});
