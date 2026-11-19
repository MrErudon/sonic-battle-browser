import { defineConfig } from "vite";

// Keep Phaser's stable engine asset independently cacheable across UI changes.
// This does not reduce the engine's download size or hide its size warning.
export default defineConfig({
  build: { rollupOptions: { output: {
    manualChunks(id) { if (id.includes("node_modules/phaser")) return "phaser"; },
  } } },
});
