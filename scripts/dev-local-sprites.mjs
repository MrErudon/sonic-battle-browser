import {spawn} from 'node:child_process';
// No path-serving plugin: package bytes are selected in the browser, never served from disk.
if(process.argv.length>2)throw Error('This dedicated command accepts no host/filesystem overrides');
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4183','--strictPort'],{stdio:'inherit',env:{...process.env,LOCAL_SPRITES:'1'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>process.exitCode=code??1);
