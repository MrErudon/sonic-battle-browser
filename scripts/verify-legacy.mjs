import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const m=JSON.parse(await readFile('reports/M02.4-preserved-files.json','utf8'));
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
for(const [p,expected] of Object.entries(m.sha256))if(await hash(p)!==expected)throw Error('Preserved baseline file changed: '+p);
if(await hash('reports/M02.4-baseline.json')!==m.recordedBaselineSha256)throw Error('Recorded baseline report changed');
console.log(Object.keys(m.sha256).length+' legacy source/test/golden files and original baseline preserved byte-for-byte');
const source=await readFile('src/core/combat.ts','utf8');const stats=source.slice(source.indexOf('const light:'),source.indexOf('export interface AttackAction'));
if(createHash('sha256').update(stats).digest('hex')!==m.fighterStatsSourceSha256)throw Error('Fighter combat tuning changed');
