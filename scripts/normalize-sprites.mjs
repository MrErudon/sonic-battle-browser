import {readFile,writeFile,mkdir,realpath,readdir} from 'node:fs/promises';import {resolve,relative,sep,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {decodePng,encodePng} from './lib/png.mjs';import {loadCore} from './core-loader.mjs';
const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);if(at<0||!args[at+1])throw Error('Required '+name);return resolve(args[at+1]);};
const repo=await realpath(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
function inside(root,path){const p=relative(root,path);return p===''||(!p.startsWith('..'+sep)&&p!=='..'&&!p.startsWith(sep));}
async function external(path,exists=true){const canonical=exists?await realpath(path):resolve(await realpath(dirname(path)),path.split(sep).pop());if(inside(repo,canonical))throw Error('Private inputs/outputs must remain outside the checkout');return canonical;}
const source=await external(option('--source-dir')),recipePath=await external(option('--recipe')),out=await external(option('--out'),false);
if(inside(source,out)||inside(out,source))throw Error('Source and output folders must be separate');
try{if((await readdir(out)).length)throw Error('Output must be empty/new');}catch(e){if(e.code!=='ENOENT')throw e;}
const recipeBytes=await readFile(recipePath),recipe=JSON.parse(recipeBytes),sources={},sourceHashes={};
for(const name of new Set(Object.values(recipe.frames).map(f=>f.source))){if(!/^[\w.-]+\.png$/i.test(name))throw Error('Source must be a selected PNG basename');const path=await realpath(resolve(source,name));if(!inside(source,path))throw Error('Source path escape');const bytes=await readFile(path);sources[name]=decodePng(bytes);sourceHashes[name]=createHash('sha256').update(bytes).digest('hex');}
const load=await loadCore(),{normalizeFrames}=await load('presentation/normalize');let result;
try{result=normalizeFrames(recipe,sources);}catch(e){if(e.report){await mkdir(out,{recursive:true});await writeFile(resolve(out,'rejection-report.json'),JSON.stringify(e.report,null,2)+'\n');}throw e;}
const pages=result.pages.map(encodePng),manifest=JSON.stringify(result.manifest,null,2)+'\n';
const provenance={schemaVersion:1,...recipe.provenance,sourceHashes,recipeSha256:createHash('sha256').update(recipeBytes).digest('hex'),normalizer:'deterministic root translation; no scale/clip/recolor',authorization:'Owner declaration; not independently verified by tooling'};
if(!provenance.rightsHolder||!provenance.source||!provenance.permissionBasis||!['restricted-local','original-fixture'].includes(provenance.redistribution))throw Error('Explicit provenance declaration required');
const report=JSON.stringify(result.report,null,2)+'\n',prov=JSON.stringify(provenance,null,2)+'\n',bytes=pages.reduce((n,p)=>n+p.length,0)+Buffer.byteLength(manifest)+Buffer.byteLength(report)+Buffer.byteLength(prov);
if(bytes>1.5*1024*1024){await mkdir(out,{recursive:true});await writeFile(resolve(out,'rejection-report.json'),JSON.stringify({status:'rejected',issue:'Package ceiling exceeded; no poses discarded',bytes,ceiling:1572864},null,2));throw Error('Package ceiling exceeded');}
await mkdir(out,{recursive:true});for(let i=0;i<pages.length;i++)await writeFile(resolve(out,`atlas-${i}.png`),pages[i]);await writeFile(resolve(out,'manifest.json'),manifest);await writeFile(resolve(out,'provenance.json'),prov);await writeFile(resolve(out,'coverage-report.json'),report);
console.log(JSON.stringify({status:'normalized',sourceFrames:result.report.sourceFrames,uniqueFrames:result.report.uniqueFrames,pages:pages.length,compressedPackageBytes:bytes,decodedBytes:result.report.decodedBytes,targetExceeded:bytes>1048576,sourceAuthorization:'owner-declared; unverified'}));
