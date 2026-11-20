import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const files = (await readdir("dist/assets")).filter(name => /\.(js|css)$/.test(name));
const assets = await Promise.all(files.map(async name => {
  const data = await readFile("dist/assets/" + name);
  return { name, bytes: data.length, gzipBytes: gzipSync(data).length };
}));
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/bundle-report.json", JSON.stringify({ assets }, null, 2));
console.table(assets);
