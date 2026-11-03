import { readFile, readdir, writeFile } from "node:fs/promises";
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
// Hash contents, not names: tram-core.wasm keeps its name when the C++ core
// changes, and a name-only revision would keep serving the old core.
const hash = createHash("sha256");
for (const asset of assets.slice(1)) {
  hash.update(asset);
  hash.update(await readFile(new URL(asset, outputDirectory)));
}
const revision = hash.digest("hex").slice(0, 12);
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

// Content-hashed build files never change, so the cache can answer first.
// The page and unhashed files (the WASM core, manifest, icons) go to the
// network first: a cached page from an older build references hashed files
// that no longer exist, which broke the app and its comparison worker.
const HASHED = /\\/assets\\/[^/]+-[A-Za-z0-9_-]{8}\\.[a-z0-9]+$/;

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (HASHED.test(new URL(request.url).pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: request.mode === "navigate" })
        .then((cached) => cached || caches.match("./"))),
  );
});
`;

await writeFile(new URL("../dist/sw.js", import.meta.url), source);
console.log(`Generated offline service worker with ${assets.length} assets.`);
