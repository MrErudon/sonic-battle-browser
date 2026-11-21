import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {loadCore} from './core-loader.mjs';
const load=await loadCore(),{validateManifest,CLIPS}=await load('presentation/manifest');
const registry=JSON.parse(await readFile('src/presentation/character-registry.json','utf8'));
if(registry.schemaVersion!==1||!registry.slots?.P1||!registry.slots?.P2)throw Error('Invalid registry');
const results=[];
for(const path of new Set(Object.values(registry.slots))){
 if(typeof path!=='string'||path.includes('..')||path.startsWith('/')||path.includes(':'))throw Error('Unsafe registry path');
 const file=resolve('public/assets',path),raw=await readFile(file),m=validateManifest(JSON.parse(raw)),root=dirname(file);
 let decoded=0,transfer=raw.length;
 const provenance=JSON.parse(await readFile(resolve(root,m.provenance),'utf8'));
 if(!provenance.creator||!provenance.license||!provenance.source||!Array.isArray(provenance.thirdPartyInputs))throw Error('Incomplete provenance');
 for(const page of m.pages){const image=await readFile(resolve(root,page.image));
  if(image.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||image.readUInt32BE(16)!==page.width||image.readUInt32BE(20)!==page.height)throw Error('PNG dimensions/format mismatch');
  if(m.id==='synthetic'&&createHash('sha256').update(image).digest('hex')!==provenance.sha256)throw Error('Synthetic provenance hash mismatch');
  decoded+=page.width*page.height*4;transfer+=image.length;
 }
 if(transfer>1.5*1024*1024)throw Error('Character transfer budget exceeded');
 results.push({id:m.id,version:m.version,clips:Object.keys(CLIPS).length,frames:Object.keys(m.frames).length,pages:m.pages.length,transferBytes:transfer,decodedBytes:decoded,estimatedGpuBytes:decoded});
}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/character-assets.json',JSON.stringify(results,null,2)+'\n');console.table(results);
