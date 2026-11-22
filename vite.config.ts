import { defineConfig } from "vite";
import {checkReleaseInputs} from "./scripts/release-inventory.mjs";

// Keep Phaser's stable engine asset independently cacheable across UI changes.
// This does not reduce the engine's download size or hide its size warning.
export default defineConfig(({command})=>{
 const local=process.env.LOCAL_SPRITES==='1';if(local&&command==='build')throw Error('Local sprite importer is development-only');
 return {
 define:{__LOCAL_SPRITES__:JSON.stringify(local)},
 ...(local?{server:{host:'127.0.0.1',port:4183,strictPort:true}}:{}),
 plugins:[{name:'original-release-inventory',configResolved(config){if(local&&!['127.0.0.1','::1','localhost'].includes(String(config.server.host)))throw Error('Local sprite mode must bind to loopback');},async buildStart(){if(command==='build')await checkReleaseInputs();}}],
  build: { rollupOptions: { input: process.env.PRESENTATION_FIXTURES === "1" ? {main:"index.html",presentationFixture:"presentation-fixture.html"} : "index.html", output: {
    manualChunks(id) { if (id.includes("node_modules/phaser")) return "phaser"; },
  } } },
};});
