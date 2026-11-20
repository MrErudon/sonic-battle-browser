import { describe, it, expect } from "vitest";
import { DEFAULT_COMBO, validateCombo } from "../src/core/combos";
import { createCombatFighter, DEFAULT_FIGHTER_STATS, facingVector, stepCombat, type AttackAction, type AttackKind } from "../src/core/combat";
import { NO_INPUT, DIRECTIONS } from "../src/core/movement";
import { MatchController, COUNTDOWN_TICKS } from "../src/core/match";
import { CpuController, CPU_PRESETS } from "../src/core/cpu";
const input = (attack?: AttackKind) => ({ ...NO_INPUT, attack });
function pair(distance = 30) {
  const d = facingVector("e");
  return [createCombatFighter("P1", 0, 0, "e"), createCombatFighter("P2", distance*d.x, distance*d.y, "w")] as const;
}
function ticks(f: ReturnType<typeof pair>, n: number) { for (let i=0;i<n;i++) stepCombat(f, []); }
function activeStage(stage = 0, distance = 30) {
  const f=pair(distance), s=DEFAULT_COMBO.stages[stage];
  f[0].action={ type:"attack", kind:s.kind, airborne:false, frame:1, facing:"e",
    stats:{...f[0].stats.attacks.ground[s.kind],...s.overrides},hitTargets:new Set(),comboStage:s.id };
  return f;
}
describe("combo data validation",()=>{
  it("accepts approved defaults",()=>expect(()=>validateCombo(DEFAULT_COMBO,DEFAULT_FIGHTER_STATS.attacks.ground)).not.toThrow());
  it.each([0,-1,1.5,NaN,61])("rejects invalid buffer %s",n=>expect(()=>validateCombo({...DEFAULT_COMBO,bufferTicks:n},DEFAULT_FIGHTER_STATS.attacks.ground)).toThrow());
  it("rejects cycles, duplicates, missing successors, invalid windows and durations",()=>{
    for(const mutate of [
      (c:any)=>c.stages[0].next="light_1",
      (c:any)=>c.stages[1].id="light_1",
      (c:any)=>c.stages[0].next="missing",
      (c:any)=>c.stages[0].cancel=[8,11],
      (c:any)=>c.stages[0].cancel=[11,9],
      (c:any)=>c.stages[0].overrides.startup=0,
      (c:any)=>c.stages[0].overrides.damage=-1,
      (c:any)=>c.stages[0].overrides.reach=NaN,
    ]){const c=structuredClone(DEFAULT_COMBO);mutate(c);expect(()=>validateCombo(c,DEFAULT_FIGHTER_STATS.attacks.ground)).toThrow();}
  });
});
describe("cancel and buffer timing",()=>{
  const stages=[0,1,2];
  it.each(stages)("stage %i first/last inclusive cancel and late failure",index=>{
    const s=DEFAULT_COMBO.stages[index];
    for(const frame of [s.cancel![0],s.cancel![1],s.cancel![1]+1]){
      const f=activeStage(index); ticks(f,frame-2);
      stepCombat(f,[input("light")]);
      expect((f[0].action as AttackAction).comboStage).toBe(frame<=s.cancel![1]?s.next:s.id);
      if(frame<=s.cancel![1])expect((f[0].action as AttackAction).frame).toBe(1);
    }
  });
  it.each([3,4,5,6,7,8])("six-tick buffer captured on frame %i",capture=>{
    const f=activeStage();ticks(f,capture-2);stepCombat(f,[input("light")]);ticks(f,9-capture);
    expect((f[0].action as AttackAction).comboStage).toBe(capture>=4?"light_2":"light_1");
  });
  it("never cancels a whiff or replays expired input as a neutral attack",()=>{
    const f=activeStage(0,300);ticks(f,6);stepCombat(f,[input("light")]);ticks(f,120);
    expect(f[0].action.type).toBe("ready");expect(f[1].health).toBe(100);
  });
  it("ignores heavy at early stages and keeps first eligible edge",()=>{
    const f=activeStage();ticks(f,6);stepCombat(f,[input("light")]);stepCombat(f,[input("heavy")]);
    expect((f[0].action as AttackAction).comboStage).toBe("light_2");
  });
  it.each(["light","heavy"] as const)("stage 3 accepts %s for terminal heavy",kind=>{
    const f=activeStage(2);ticks(f,9);stepCombat(f,[input(kind)]);
    expect(f[0].action).toMatchObject({kind:"heavy",comboStage:"finisher",frame:1});
  });
  it("terminal finisher cannot chain and clears to neutral",()=>{
    const f=activeStage(3);for(let i=0;i<44;i++)stepCombat(f,[input("light")]);
    expect(f[0].action.type).toBe("ready");
  });
  it("damage interrupts an attack and destroys queued continuation",()=>{
    const f=activeStage();ticks(f,4);stepCombat(f,[input("light")]);
    const enemy=f[1];enemy.action={type:"attack",kind:"light",airborne:false,frame:5,facing:"w",stats:enemy.stats.attacks.ground.light,hitTargets:new Set()};
    stepCombat(f,[]);expect(f[0].action.type).toBe("hitstun");ticks(f,100);expect(f[0].action.type).toBe("ready");
  });
});
describe("full combo, aerial preservation and feedback",()=>{
  it("executes 5/6/8/15 damage through real contacts and returns neutral",()=>{
    const f=pair(), damage:number[]=[], stages:string[]=[];
    for(let tick=0;tick<120;tick++){
      const a=f[0].action;
      const next=a.type==="attack"&&a.comboStage?DEFAULT_COMBO.stages.find(s=>s.id===a.comboStage):undefined;
      const attack=tick===0||next?.cancel&&a.type==="attack"&&a.frame+1===next.cancel[0]?"light":undefined;
      for(const e of stepCombat(f,[input(attack)])){damage.push(e.damage);stages.push(e.comboStage!);}
    }
    expect(damage).toEqual([5,6,8,15]);expect(stages).toEqual(["light_1","light_2","light_3","finisher"]);
    expect(f[1].health).toBe(66);expect(f[0].action.type).toBe("ready");expect(f[0].comboHits.count).toBe(0);
  });
  it("incoming damage on the cancel tick interrupts the successor",()=>{
    const f=activeStage();ticks(f,7);
    const q=f[1];
    q.action={type:"attack",kind:"light",airborne:false,frame:5,facing:"w",stats:q.stats.attacks.ground.light,hitTargets:new Set()};
    stepCombat(f,[input("light")]);
    expect(f[0].action.type).toBe("hitstun");expect(f[0].comboHits.count).toBe(0);
    ticks(f,120);expect(f[0].action.type).toBe("ready");
  });
  it("counter counts only hits before defender unlocks",()=>{
    const f=activeStage();ticks(f,5);expect(f[0].comboHits.count).toBe(1);
    ticks(f,2);stepCombat(f,[input("light")]);ticks(f,5);
    expect(f[0].comboHits).toMatchObject({count:2,damage:11,active:true});
    ticks(f,20);expect(f[0].comboHits.active).toBe(false);
  });
  it("standalone heavy and aerial moves never gain combo continuations",()=>{
    for(const attack of ["light","heavy"] as const){
      const f=pair();stepCombat(f,[{...input(attack),jump:true}]);
      expect(f[0].action).toMatchObject({airborne:true});
      expect((f[0].action as AttackAction).comboStage).toBeUndefined();
      ticks(f,8);stepCombat(f,[input("light")]);expect((f[0].action as AttackAction).comboStage).toBeUndefined();
    }
    const f=pair();stepCombat(f,[input("heavy")]);expect((f[0].action as AttackAction).comboStage).toBeUndefined();
  });
});
describe("wall/corner escape and CPU legality",()=>{
  it.each(DIRECTIONS)("repeated maximum pressure leaves control gaps at %s boundary",facing=>{
    const d=facingVector(facing), f=pair(0);
    const bx=d.x>=0?324:-324, by=d.y>=0?194:-194;
    Object.assign(f[1],{x:bx,y:by,health:100000});
    Object.assign(f[0],{x:bx-d.x*25,y:by-d.y*25,facing});
    let escapes=0,hits=0;
    for(let t=0;t<3000;t++){
      if(f[1].action.type==="ready")escapes++;
      hits+=stepCombat(f,[input("light")]).length;
    }
    expect(hits).toBeGreaterThan(4);expect(escapes).toBeGreaterThan(20);
  });
  it.each(["Easy","Normal","Hard"] as const)("%s CPU uses actual legal combo stages",difficulty=>{
    let chains=0;
    for(const seed of [0,1,5,42,255]){
      const f=pair(),cpu=new CpuController(CPU_PRESETS[difficulty],seed);
      f[0].health=f[1].health=100000;
      for(let t=0;t<3000;t++){
        const before=f[0].action;
        const i=cpu.tick(f[0],f[1]);
        if(before.type==="attack"&&i.attack){
          const stage=DEFAULT_COMBO.stages.find(s=>s.id===before.comboStage)!;
          expect(before.hitTargets.has(f[1].id)).toBe(true);
          expect(before.frame+1).toBeGreaterThanOrEqual(stage.cancel![0]);expect(before.frame+1).toBeLessThanOrEqual(stage.cancel![1]);chains++;
        }
        stepCombat(f,[i]);
      }
    }
    expect(chains).toBeGreaterThan(0);
  });
});
describe("match boundaries and render scheduling",()=>{
  it.each(["focus","help","menu"] as const)("%s clears combat buffer",boundary=>{
    const m=new MatchController();m.start();for(let t=0;t<COUNTDOWN_TICKS;t++)m.tick();
    const f=activeStage();m.fighters=f; ticks(f,4);stepCombat(f,[input("light")]);
    expect((f[0].action as AttackAction).buffered).toBeDefined();
    if(boundary==="focus"){m.setFocused(false);m.setFocused(true);}
    if(boundary==="help"){m.setHelp(true);m.setHelp(false);}
    if(boundary==="menu")m.menu();
    if(m.fighters[0].action.type==="attack")expect(m.fighters[0].action.buffered).toBeUndefined();
    else expect(m.state).toBe("Menu");
  });
  it.each([10,30,60,144,240])("%i Hz produces identical full combo traces",hz=>{
    function run(rate:number){
      const m=new MatchController();m.start();for(let t=0;t<180;t++)m.tick();
      m.fighters=pair();
      Object.assign(m,{cpu:{tick:()=>NO_INPUT}});
      const tick=m.tick.bind(m),trace:unknown[]=[],damage:number[]=[];
      let index=0;
      m.tick=()=>{
        if([0,8,16,26].includes(index)){m.press("KeyJ");m.release("KeyJ");}
        const hits=tick();damage.push(...hits.map(e=>e.damage));
        trace.push(structuredClone(m.fighters));index++;return hits;
      };
      for(let t=0;t<rate*3;t++)m.advance(1000/rate);
      expect(damage).toEqual([5,6,8,15]);return trace;
    }
    expect(run(hz)).toEqual(run(60));
  });
});
