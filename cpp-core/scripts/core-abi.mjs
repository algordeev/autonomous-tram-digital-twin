import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const coreRoot = resolve(import.meta.dirname, "..");
export const abiHeader = await readFile(resolve(coreRoot, "include/tram/core_c_api.h"), "utf8");
export const abiVersion = Number(abiHeader.match(/#define TRAM_CORE_ABI_VERSION (\d+)/)[1]);
const declarations = abiHeader.replace(/void\s*\*/g, "void* ");
export const abiFunctions = [...declarations.matchAll(/(int|double|void\*|void)\s+(tram_core_\w+)\(([^)]*)\);/g)].map(([, result, name, args]) => ({
  result, name, parameters: args === "void" ? [] : args.split(",").map((arg) => arg.trim()),
}));
if (!abiFunctions.length) throw new Error("Empty core ABI");
