import { defineConfig } from "vite";

// Keep Phaser's stable engine asset independently cacheable across UI changes.
// This does not reduce the engine's download size or hide its size warning.
export default defineConfig({
  build: { rollupOptions: { input: process.env.PRESENTATION_FIXTURES === "1" ? {main:"index.html",presentationFixture:"presentation-fixture.html"} : "index.html", output: {
    manualChunks(id) { if (id.includes("node_modules/phaser")) return "phaser"; },
  } } },
});
