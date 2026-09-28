import { readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";

const outputDirectory = new URL("../dist/", import.meta.url);
const rootPath = outputDirectory.pathname;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "sw.js") continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(absolutePath));
    else files.push(`./${relative(rootPath, absolutePath).split(sep).join("/")}`);
  }
  return files;
}

const assets = ["./", ...await collectFiles(rootPath)];
const revision = createHash("sha256").update(assets.join("\n")).digest("hex").slice(0, 12);
const source = `const CACHE = "tram-twin-${revision}";
const ASSETS = ${JSON.stringify(assets, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
`;

await writeFile(new URL("../dist/sw.js", import.meta.url), source);
console.log(`Generated offline service worker with ${assets.length} assets.`);
