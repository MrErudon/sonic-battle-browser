function createHash(_algorithm:string) { return {data:"",update(s:string){this.data+=s;},async digest(_encoding:string){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(this.data));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}}; }
import { describe, expect, it } from "vitest";
import { createCombatFighter, facingVector, stepCombat, type CombatFighter, type CombatInput, type HitEvent } from "../src/core/combat";
import { CpuController, CPU_PRESETS, type Difficulty } from "../src/core/cpu";
import { NO_INPUT } from "../src/core/movement";

// Recorded on untouched main 75fd73c104ff28fa8e3ed88acf65bcede261352c.
// Snapshots include every pre-M02.3 fighter/action field and ordered hit data;
// new identifiers/recharge state are deliberately excluded from this contract.
const EXPECTED: Record<string,string> = {"Easy-0":"9f0b872c6420c14e5d77ddc8e888740468ae291edeca4356cd5ab44e07850515","Easy-1":"4fd7a8a2d3e5f6a869b1120cadfa4affc1b5eaf61dc80fe855632d7177eb961a","Easy-5":"400f54ea7aebdd128dcf93d09c2dd5e628b903f7225a988d472348c8536e5e38","Easy-42":"58524a1804471f34c2eadfb1094c754d62e988757cef68217b63b354088117fd","Easy-255":"c3a6e9e3ff633937f4c37081a74859e0b949599189c2dd94a39ff2fdbb1c8afe","Normal-0":"c3e1d34cef0f8aa1f7d6d58c786bbc57e411af7fba7235cc358bca879d11adec","Normal-1":"4a3622b0e00323bfe5c7caac42b9afb792522d5d00d9228f350924ee7e5c7e38","Normal-5":"80eb00477b8d50de6db339212f3a301e4ec74a558c7a33a5933ced74fa4d1ca8","Normal-42":"9e5045151fbb129f3cc865018772705a87daa1072bfdc1080b5e08978ecd4170","Normal-255":"477eaa8ce09694adfe605c940c7b0b2682d64eec4b0f65f02b5f1a2a4e3d8c37","Hard-0":"b42ed48d3bb6a5230e8286f02e63bbe746763fe01e17002f09b9b69c78f77978","Hard-1":"02a5d94e4bb50d1b566b4472ee6a9b1292b255a303aa9727ce5ccaaaf2aef485","Hard-5":"2cf4c57a073c32f6c2d607b032b8f26a59d20ac096d5db71e2e21733b8a140a5","Hard-42":"3706b6ff0ef3140d50f6159db5685a736f0978e65574cbd3a87b6096e6728729","Hard-255":"cc0dd4777268e264f506cf6f58a0fec0a33c9fadd183e6ef49e8d34a12e86886","script-e":"84b8f67efdd048f8734cb8395bdf06b44d7cc1b1c1de2991688281a4cdce2f4f","script-se":"cf171b36685b9033fdd23bbad81bb9ab0c19e3cf8bab004658aa4704fac58600","script-s":"3358180cb82033278c3031269a3242982a3cde18c7a099bb3e9996de00a4a3ff","script-sw":"4c9cd602d84c284f068704e89a6dc172926bdf9eff1d82642bf12f59b2df2659","script-w":"417344d8745d0d830c36193d7073db73f269c9c3dcd39c9d54f3edb35131d611","script-nw":"70d5ffe59db2a2371150b70b85fc54a152f6f8c46df4e7e7e5b7b7affee13bc6","script-n":"4e5ce7b29e5c0acf279bf06cc5f7ace79ff2b4bc39a282c1d3eb8a73fc09d9fc","script-ne":"8a871391482979f1541dfb627e49df465807b163e32d9919122c8733accf9ad6"};
function snap(f: CombatFighter) {
  const a=f.action;
  return [f.id,f.x,f.y,f.z,f.vz,f.facing,f.state,f.landingRemaining,f.health,f.cooldown,
    f.knockbackX,f.knockbackY,f.guard,f.comboHits,
    a.type==="attack"?[a.type,a.kind,a.airborne,a.frame,a.facing,a.stats,[...a.hitTargets],
      a.confirmedTargets?[...a.confirmedTargets]:null,a.comboStage,a.buffered]:a];
}
function inp(i: CombatInput) { return [i.x,i.y,i.jump,i.attack,Boolean(i.block)]; }
function hit(h: HitEvent) { return [h.attackerId,h.defenderId,h.damage,h.x,h.y,h.z,h.comboStage,h.comboCount,h.outcome,h.guardDamage]; }
const cases: [string,()=>Promise<string>][]=[];
for(const difficulty of ["Easy","Normal","Hard"] as Difficulty[])for(const seed of [0,1,5,42,255]){
  const name=difficulty+"-"+seed;
  cases.push([name,()=>{
    const d=facingVector("e"),a=createCombatFighter("cpu",0,0,"e"),b=createCombatFighter("human",d.x*44,d.y*44,"w");
    const cpu=new CpuController({...CPU_PRESETS[difficulty]},seed),hash=createHash("sha256");
    for(let tick=0;tick<1200;tick++){
      const x=cpu.tick(a,b),y:CombatInput={...NO_INPUT,
        attack:tick%83===0?"heavy":tick%13===0?"light":undefined,
        block:tick%150>=90&&tick%150<130,jump:tick%197===0};
      const hits=stepCombat([a,b],[x,y]);
      hash.update(JSON.stringify([inp(x),inp(y),snap(a),snap(b),hits.map(hit)]));
      a.health=b.health=100; // renewable training targets; recorded identically on baseline
    }return hash.digest("hex");
  }]);
}
for(const facing of ["e","se","s","sw","w","nw","n","ne"] as const)cases.push(["script-"+facing,()=>{
  const d=facingVector(facing),a=createCombatFighter("a",0,0,facing),b=createCombatFighter("b",d.x*28,d.y*28,["e","se","s","sw","w","nw","n","ne"][(["e","se","s","sw","w","nw","n","ne"].indexOf(facing)+4)%8] as typeof facing);
  const hash=createHash("sha256");
  for(let tick=0;tick<900;tick++){
    const x:CombatInput={...NO_INPUT,attack:tick%3===0?"light":tick%37===0?"heavy":undefined,jump:tick%211===0};
    const y:CombatInput={...NO_INPUT,block:tick%200<90,attack:tick%47===0?"heavy":undefined};
    const hits=stepCombat([a,b],[x,y]);
    hash.update(JSON.stringify([snap(a),snap(b),hits.map(hit)]));a.health=b.health=100;
  }return hash.digest("hex");
}]);
describe("unchanged M02.2 normal-only traces",()=>{
  it.each(cases)("%s", async (name,run)=>{
    const digest=await run();
    expect(digest).toBe(EXPECTED[name]);
  });
});
