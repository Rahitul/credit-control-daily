import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const srcChunks = join(root, ".next", "server", "chunks");
const standaloneChunks = join(root, ".next", "standalone", ".next", "server", "chunks");

if (!existsSync(srcChunks) || !existsSync(standaloneChunks)) {
  console.log("fix-standalone-chunks: no standalone output found, skipping");
  process.exit(0);
}

mkdirSync(standaloneChunks, { recursive: true });

let copied = 0;
for (const name of readdirSync(srcChunks)) {
  const src = join(srcChunks, name);
  const dest = join(standaloneChunks, name);
  if (existsSync(dest)) continue;
  copyFileSync(src, dest);
  copied++;
}

console.log(`fix-standalone-chunks: copied ${copied} chunk file(s) into .next/standalone`);
