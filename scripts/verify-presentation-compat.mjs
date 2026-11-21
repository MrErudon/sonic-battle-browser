import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const m=JSON.parse(await readFile('reports/M03.1-preserved-files.json','utf8'));
for(const [path,expected] of Object.entries(m.sha256))if(createHash('sha256').update(await readFile(path)).digest('hex')!==expected)throw Error('M03.1 preservation violation: '+path);
console.log('M02.4 refined CPU, regression tests and deterministic reports preserved byte-for-byte');
