import { ARENA } from "./arena";
export interface Point3 { x:number; y:number; z:number }
export interface Vector2 { x:number; y:number }
type Interval = [number,number];
function slab(p:number,v:number,lo:number,hi:number): Interval|undefined {
  if(Math.abs(v)<1e-12)return p>=lo-1e-10&&p<=hi+1e-10?[0,1]:undefined;
  const a=(lo-p)/v,b=(hi-p)/v,t0=Math.max(0,Math.min(a,b)),t1=Math.min(1,Math.max(a,b));
  return t0<=t1+1e-10?[t0,t1]:undefined;
}
function intersect(a:Interval|undefined,b:Interval|undefined): Interval|undefined {
  if(!a||!b)return;const lo=Math.max(a[0],b[0]),hi=Math.min(a[1],b[1]);
  return lo<=hi+1e-10?[lo,hi]:undefined;
}
function circle(px:number,py:number,vx:number,vy:number,cx:number,cy:number,r:number):Interval|undefined {
  const x=px-cx,y=py-cy,A=vx*vx+vy*vy,C=x*x+y*y-r*r;
  if(A<1e-20)return C<=1e-9?[0,1]:undefined;
  const B=2*(x*vx+y*vy),D=B*B-4*A*C;if(D < -1e-9)return;
  const root=Math.sqrt(Math.max(0,D)),lo=Math.max(0,(-B-root)/(2*A)),hi=Math.min(1,(-B+root)/(2*A));
  return lo<=hi+1e-10?[lo,hi]:undefined;
}
/** Exact horizontal segment vs rounded rectangle, with linear relative vertical
 * interval overlap. Uses both fighters' tick endpoints, never render coordinates. */
export function sweepAttack(from:Point3,to:Point3,targetFrom:Point3,targetTo:Point3,
  direction:Vector2,reach:number,width:number,bottom:number,height:number,radius:number,hurtHeight:number):number|undefined {
  const rx=targetFrom.x-from.x,ry=targetFrom.y-from.y;
  const vx=(targetTo.x-targetFrom.x)-(to.x-from.x),vy=(targetTo.y-targetFrom.y)-(to.y-from.y);
  const x=rx*direction.x+ry*direction.y,y=-rx*direction.y+ry*direction.x;
  const dx=vx*direction.x+vy*direction.y,dy=-vx*direction.y+vy*direction.x,w=width/2;
  const vertical=slab(targetFrom.z-from.z,(targetTo.z-targetFrom.z)-(to.z-from.z),bottom-hurtHeight,bottom+height);
  const ranges: (Interval|undefined)[]=[
    intersect(slab(x,dx,0,reach),slab(y,dy,-w-radius,w+radius)),
    intersect(slab(x,dx,-radius,reach+radius),slab(y,dy,-w,w)),
  ];
  for(const cx of [0,reach])for(const cy of [-w,w])ranges.push(circle(x,y,dx,dy,cx,cy,radius));
  let first:number|undefined;
  for(const range of ranges){const t=intersect(range,vertical)?.[0];if(t!==undefined&&(first===undefined||t<first))first=Math.max(0,Math.min(1,t));}
  return first;
}
export function sweepOrb(from:Point3,to:Point3,targetFrom:Point3,targetTo:Point3,radius:number,hurtRadius:number,hurtHeight:number):number|undefined {
  const vx=(to.x-from.x)-(targetTo.x-targetFrom.x),vy=(to.y-from.y)-(targetTo.y-targetFrom.y);
  return intersect(circle(from.x-targetFrom.x,from.y-targetFrom.y,vx,vy,0,0,radius+hurtRadius),
    slab(targetFrom.z-from.z,(targetTo.z-targetFrom.z)-(to.z-from.z),-hurtHeight-radius,radius))?.[0];
}
export function lerpPoint(a:Point3,b:Point3,t:number):Point3 { return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t}; }
/** First boundary intersection, so a committed dash never slides along a wall. */
export function boundaryFraction(from:Point3,to:Point3,radius:number):number {
  let t=1;const lx=ARENA.width/2-radius,ly=ARENA.depth/2-radius;
  for(const [p,v,limit] of [[from.x,to.x-from.x,lx],[from.y,to.y-from.y,ly]]){
    if(v>0)t=Math.min(t,(limit-p)/v);else if(v<0)t=Math.min(t,(-limit-p)/v);
  }
  return Math.max(0,Math.min(1,t));
}
