import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { abiFunctions, abiVersion } from "./core-abi.mjs";

import {
  Clang,
  LLD,
  getCompilerInvocation,
  setUpSysroot,
} from "browsercc";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sourcePath = resolve(root, "src/operational_core.cpp");
const check = process.argv.includes("--check");
const outputArg = process.argv.indexOf("--output");
const outputPath = outputArg >= 0 ? resolve(process.argv[outputArg + 1]) : resolve(root, "../public/wasm/tram-core.wasm");
const source = await readFile(sourcePath, "utf8");
const abiAdapterPath = resolve(root, "../src/simulation-core/cpp-abi.ts");
const abiAdapter = `// Generated from cpp-core/include/tram/core_c_api.h by npm run build:wasm.\nexport const TRAM_CORE_ABI_VERSION = ${abiVersion};\n`;
const browserccEntry = import.meta.resolve("browsercc");
const sysroot = await readFile(new URL("sysroot.tar", browserccEntry));

const exports = abiFunctions.map(({ name }) => name);
const flags = [
  "-std=c++17", "-Iinclude", "-O3", "-fno-exceptions", "-fno-rtti", "-nostdlib",
  "-Wl,--no-entry", "-Wl,--strip-all",
  ...exports.map((name) => `-Wl,--export=${name}`),
];
let diagnostics = "";
const printErr = (line) => { diagnostics += `${line}\n`; };
const invocation = await getCompilerInvocation("operational_core.cpp", source, flags);
const clang = await Clang({ thisProgram: "clang++", printErr });
clang.FS.writeFile("operational_core.cpp", source);
setUpSysroot(clang, sysroot);
clang.FS.mkdirTree("include/tram");
for (const header of ["core_c_api.h", "control_parameters.hpp"]) {
  clang.FS.writeFile(`include/tram/${header}`, await readFile(resolve(root, "include/tram", header), "utf8"));
}
if (clang.callMain(invocation.compilerArgs) !== 0) {
  throw new Error(`Clang failed:\n${diagnostics}`);
}
const object = clang.FS.readFile(invocation.compilerArtifact, { encoding: "binary" });
const lld = await LLD({ thisProgram: "wasm-ld", printErr });
lld.FS.writeFile(invocation.compilerArtifact, object);
setUpSysroot(lld, sysroot);
if (lld.callMain(invocation.linkerArgs) !== 0) {
  throw new Error(`wasm-ld failed:\n${diagnostics}`);
}
const wasm = lld.FS.readFile(invocation.linerArtifact, { encoding: "binary" });
const module = await WebAssembly.compile(wasm);
if (WebAssembly.Module.imports(module).length) throw new Error("Core must be freestanding (no imports)");
const { exports: instance } = await WebAssembly.instantiate(module);
if (instance.tram_core_abi_version() !== abiVersion) throw new Error("Compiled ABI mismatch");
if (check) {
  const committed = await readFile(outputPath);
  if (!committed.equals(Buffer.from(wasm))) {
    throw new Error("Committed WASM differs from source. Run npm run build:wasm and commit public/wasm/tram-core.wasm.");
  }
  if (await readFile(abiAdapterPath, "utf8") !== abiAdapter) throw new Error("Generated TypeScript ABI differs; run npm run build:wasm");
  console.log(`Verified reproducible WASM (${wasm.byteLength} bytes, ABI ${abiVersion})`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, wasm);
  await writeFile(abiAdapterPath, abiAdapter);
  console.log(`Wrote ${outputPath} (${wasm.byteLength} bytes, ABI ${abiVersion})`);
}
