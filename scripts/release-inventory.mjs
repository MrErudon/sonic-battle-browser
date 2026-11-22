import {readFile,readdir,lstat,stat} from 'node:fs/promises';import {resolve,relative} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const hash=data=>createHash('sha256').update(data).digest('hex');
async function walk(root){const out=[];async function visit(dir){for(const name of (await readdir(dir)).sort()){const path=resolve(dir,name),s=await lstat(path);if(s.isSymbolicLink())throw Error('Release inventory rejects symbolic links');if(s.isDirectory())await visit(path);else out.push(path);}}try{await visit(root);}catch(e){if(e.code!=='ENOENT')throw e;}return out;}
export async function checkReleaseInputs(root=process.cwd()){
 const inventory=JSON.parse(await readFile(resolve(root,'reports/public-asset-inventory.json'),'utf8')),seen=new Set();
 for(const path of await walk(resolve(root,'public'))){const key=relative(root,path).split('\\').join('/');if(!inventory.files[key]||hash(await readFile(path))!==inventory.files[key])throw Error('Unapproved public release asset: '+key);seen.add(key);}
 if(seen.size!==Object.keys(inventory.files).length)throw Error('Approved public asset missing');
 if(hash(await readFile(resolve(root,'src/presentation/character-registry.json')))!==inventory.registrySha256)throw Error('Public registry changed');
 const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);for(const path of tracked)if(/\.(png|gif|jpe?g|webp|svg|zip|gba|rom|bin)$/i.test(path)&&!inventory.files[path])throw Error('Unapproved tracked binary asset: '+path);
 return inventory;
}
export async function checkArtifacts(root=process.cwd(),forbidden=[]){const inventory=await checkReleaseInputs(root),denied=new Set(forbidden.map(hash));let files=0;
 for(const tree of ['dist','artifacts'])for(const path of await walk(resolve(root,tree))){const bytes=await readFile(path),key=relative(resolve(root,tree),path).split('\\').join('/');files++;
  if(denied.has(hash(bytes))||bytes.includes(Buffer.from('PRIVATE_PACKAGE_CANARY_32')))throw Error('Local package material entered release/artifacts');
  if(tree==='dist'&&/\.(png|gif|jpe?g|webp|svg|zip|gba|rom|bin)$/i.test(key)){const approved=inventory.files['public/'+key];if(!approved||hash(bytes)!==approved)throw Error('Unapproved built binary asset: '+key);}
  if(tree==='dist'&&/\.(js|html|css)$/.test(key)&&(bytes.includes(Buffer.from('LOCAL_IMPORT_INTERFACE'))||bytes.includes(Buffer.from('local-sprite-files'))))throw Error('Private import interface entered production output');
  if(tree==='artifacts'&&key.startsWith('local-import/')&&!key.endsWith('.json'))throw Error('Only synthetic aggregate test metrics may be published from local import tests');
 }
 return {checkedFiles:files,publicFiles:Object.keys(inventory.files).length,privateMaterialFound:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const at=process.argv.indexOf('--forbid-package'),denied=at<0?[]:await Promise.all((await walk(resolve(process.argv[at+1]))).map(p=>readFile(p)));console.log(JSON.stringify(await checkArtifacts(process.cwd(),denied)));}
