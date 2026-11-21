// Reproducible original diagnostic artwork, not a character-art deliverable.
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {loadCore} from './core-loader.mjs';
const load=await loadCore(),{CLIPS}=await load('presentation/manifest');
const root='public/assets/characters/synthetic/v1';await mkdir(root,{recursive:true});
const width=544,height=272,pixels=Buffer.alloc(width*height*4);
function rect(x,y,w,h,color){for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++){const p=((y+dy)*width+x+dx)*4;pixels.set(color,p);}}
const directions=['n','ne','e','se','s'],frames={};
for(let d=0;d<5;d++)for(let pose=0;pose<6;pose++){
 const n=d*6+pose,x=(n%8)*68+2,y=Math.floor(n/8)*68+2,name=`synthetic/${directions[d]}/${pose}`;
 frames[name]={page:'body',x,y,width:64,height:64,trimmed:false,rotated:false};
 rect(x+19,y+15,26,35,[216,224,235,255]);rect(x+22,y+20,20,10,[24,37,56,255]);
 rect(x+18,y+50,12,6,[248,248,248,255]);rect(x+34,y+50,12,6,[248,248,248,255]);
 rect(x+18,y+35,28,3,[70+pose*25,125,205,255]);
 // Distinct direction marker plus pose-index bars; visible anchors are deliberate diagnostics.
 rect(x+24+d*3,y+22,3,5,[255,255,255,255]);rect(x+28,y+54,8,2,[255,80,120,255]);
 rect(x+45,y+30-pose,3,12,[240,220,140,255]);
}
let crcTable;function crc(b){crcTable??=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});let c=0xffffffff;for(const n of b)c=crcTable[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,sum]);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
const scan=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)pixels.copy(scan,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan,{level:9})),chunk('IEND',Buffer.alloc(0))]);
const animations={};for(const [id,counts] of Object.entries(CLIPS)){
 if(id==='ground.finisher'){animations[id]={alias:'ground.heavy'};continue;}
 const phases=counts.length===3?['startup','active','recovery']:['loop'];let start=0;const sequences={};
 phases.forEach((phase,i)=>{sequences[phase]=Array.from({length:counts[i]},(_,j)=>(start+j)%6);start+=counts[i];});
 animations[id]={ticksPerFrame:id==='move'?5:id==='victory'?8:id.startsWith('jump')?6:10,directions:Object.fromEntries(directions.map(d=>[d,Object.fromEntries(Object.entries(sequences).map(([p,nums])=>[p,nums.map(n=>`synthetic/${d}/${n}`)]))]))};
}
const manifest={schemaVersion:1,id:'synthetic',version:'1.0.0',displayName:'Diagnostic training robot',frameSize:[64,64],pivot:[32,56],provenance:'provenance.json',pages:[{id:'body',image:'atlas-0.png',width,height}],frames,directions:{n:{source:'n',mirror:false},ne:{source:'ne',mirror:false},e:{source:'e',mirror:false},se:{source:'se',mirror:false},s:{source:'s',mirror:false},sw:{source:'se',mirror:true},w:{source:'e',mirror:true},nw:{source:'ne',mirror:true}},attachments:{hand:[46,34],head:[32,20]},animations};
const provenance={schemaVersion:1,id:'synthetic',creator:'Sonic Battle Browser project / Codex',method:'Original programmatic diagnostic rectangles and markers',source:'scripts/generate-synthetic-atlas.mjs',license:'CC0-1.0',thirdPartyInputs:[],generativeImageTools:false,sha256:createHash('sha256').update(png).digest('hex'),purpose:'Infrastructure test fixture only. Not Trestle or Vela artwork.'};
const outputs={'atlas-0.png':png,'manifest.json':JSON.stringify(manifest,null,2)+'\n','provenance.json':JSON.stringify(provenance,null,2)+'\n'};
for(const [file,data] of Object.entries(outputs)){if(process.argv.includes('--check')){if(!Buffer.from(data).equals(await readFile(root+'/'+file)))throw Error('Synthetic asset differs: '+file);}else await writeFile(root+'/'+file,data);}
console.log('Synthetic atlas: 30 untrimmed frames, '+png.length+' PNG bytes; reproducible '+(process.argv.includes('--check')?'check':'export'));
