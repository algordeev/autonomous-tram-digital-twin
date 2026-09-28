import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "README.md",
  "README_RU.md",
  "package-lock.json",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CITATION.cff",
  "docs/README.md",
  "docs/ARCHITECTURE.md",
  "docs/DATA_AND_ASSUMPTIONS.md",
  "docs/ENERGY_MODEL.md",
  "docs/EXPERIMENTS.md",
];

const failures = [];
for (const path of required) {
  if (!existsSync(join(root, path))) failures.push(`missing required file: ${path}`);
}

function filesBelow(directory) {
  const result = [];
  for (const name of readdirSync(directory)) {
    if (["node_modules", "dist", "build", "build-cmake", ".git"].includes(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) result.push(...filesBelow(path));
    else result.push(path);
  }
  return result;
}

const markdown = filesBelow(root).filter((path) => path.endsWith(".md"));
const linkPattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
for (const source of markdown) {
  const text = readFileSync(source, "utf8");
  for (const match of text.matchAll(linkPattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (!raw || raw.startsWith("#") || /^[a-z]+:/i.test(raw)) continue;
    const pathPart = decodeURIComponent(raw.split("#", 1)[0]);
    const target = normalize(resolve(dirname(source), pathPart));
    if (!target.startsWith(root) || !existsSync(target)) {
      failures.push(
        `broken local link in ${relative(root, source)}: ${raw}`,
      );
    }
  }
}

if (failures.length) {
  failures.forEach((failure) => console.error(`ERROR: ${failure}`));
  process.exit(1);
}

console.log(`Repository verification passed: ${markdown.length} Markdown files checked.`);
