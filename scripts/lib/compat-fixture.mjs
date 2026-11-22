import {mkdir,readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {loadCore} from '../core-loader.mjs';import {encodePng} from './png.mjs';
/** Original pixels generated in external temporary storage; never a Sega source package. */
export async function createCompatibilityFixture(root){
 const load=await loadCore(),{CLIPS,DIRECTION_MAP}=await load('presentation/manifest'),{normalizeFrames}=await load('presentation/normalize');
 const base=JSON.parse(await readFile('public/assets/characters/synthetic/v1/manifest.json','utf8'));
 const image={width:12,height:12,rgba:new Uint8Array(12*12*4)};
 for(let y=2;y<9;y++)for(let x=2;x<8;x++)image.rgba.set([17,93,211,255],(y*12+x)*4);image.rgba.set([255,255,255,255],(3*12+3)*4);image.rgba.set([201,31,91,128],(4*12+3)*4);
 const animations={},coverage={},frames={};for(const d of ['n','ne','e','se','s'])frames['frame-'+d]={source:'source.png',rect:[0,0,12,12],root:[6,10],attachments:{hand:[8,4]}};
 for(const [id,counts] of Object.entries(CLIPS)){coverage[id]=Object.fromEntries(Object.entries(DIRECTION_MAP).map(([d,map])=>[d,{kinds:['direct','held',...(map.mirror?['mirrored']:[]),...(id==='ground.finisher'?['aliased']:[])],verified:true,note:'Verified original synthetic fixture only; not Sonic source coverage'}]));
  animations[id]=id==='ground.finisher'?{alias:'ground.heavy'}:{ticksPerFrame:5,directions:Object.fromEntries(['n','ne','e','se','s'].map(d=>[d,Object.fromEntries((counts.length===3?['startup','active','recovery']:['loop']).map((p,i)=>[p,Array(counts[i]).fill('frame-'+d)]))]))};
 }
 const recipe={schemaVersion:1,character:{id:'local-fixture',version:'1.0.0',displayName:'PRIVATE_PACKAGE_CANARY_32',provenance:'provenance.json',directions:base.directions,attachments:{hand:[34,50]},palette:'native',animations,coverage},frames,provenance:{rightsHolder:'Project original fixture',source:'Procedural original RGBA pixels',permissionBasis:'CC0-1.0 original test fixture',redistribution:'original-fixture'}};
 const result=normalizeFrames(recipe,{'source.png':image}),source=resolve(root,'source'),out=resolve(root,'package');await mkdir(source,{recursive:true});await mkdir(out,{recursive:true});await writeFile(resolve(source,'source.png'),encodePng(image));const recipePath=resolve(root,'recipe.json');await writeFile(recipePath,JSON.stringify(recipe,null,2));
 await writeFile(resolve(out,'manifest.json'),JSON.stringify(result.manifest,null,2));await writeFile(resolve(out,'provenance.json'),JSON.stringify(recipe.provenance));await writeFile(resolve(out,'coverage-report.json'),JSON.stringify(result.report,null,2));for(let i=0;i<result.pages.length;i++)await writeFile(resolve(out,`atlas-${i}.png`),encodePng(result.pages[i]));
 return {recipe,image,result,source,out,recipePath,files:[resolve(out,'manifest.json'),resolve(out,'provenance.json'),resolve(out,'coverage-report.json'),...result.pages.map((_,i)=>resolve(out,`atlas-${i}.png`))]};
}
