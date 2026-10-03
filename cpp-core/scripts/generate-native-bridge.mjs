import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { abiFunctions, coreRoot } from "./core-abi.mjs";

const output = resolve(process.argv[2] ?? resolve(coreRoot, "build/native_bridge.cpp"));
const cases = abiFunctions.map(({ result, name, parameters }) => {
  const declarations = parameters.map((type, i) => `${type === "void*" ? "unsigned long long" : type} a${i}; if (!(std::cin >> a${i})) return 2;`).join("\n");
  const args = parameters.map((type, i) => type === "void*" ? `reinterpret_cast<void*>(static_cast<uintptr_t>(a${i}))` : `a${i}`).join(", ");
  const call = `${name}(${args})`;
  const expression = result === "void*" ? `reinterpret_cast<uintptr_t>(${call})` : call;
  const print = result === "void" ? `${call}; std::cout << 0;` : `std::cout << ${expression};`;
  return `if (name == "${name}") { ${declarations} ${print} std::cout << std::endl; continue; }`;
}).join("\n");
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `// Generated test transport; do not edit.\n#include "tram/core_c_api.h"\n#include <cstdint>\n#include <iomanip>\n#include <iostream>\n#include <string>\nint main() { std::cout << std::setprecision(17); std::string name; while (std::cin >> name) {\n${cases}\nreturn 3; } return 0; }\n`);
