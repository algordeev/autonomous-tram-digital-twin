import { mkdir, writeFile } from "node:fs/promises";
import { NIZHNY_ROUTE_2_SCENARIO } from "../src/nizhny-route-2.ts";
import { NIZHNY_ROUTES_2_21_SCENARIO } from "../src/nizhny-routes-2-21.ts";

const outputDirectory = new URL("../src/config/networks/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });

for (const network of [
  NIZHNY_ROUTE_2_SCENARIO,
  NIZHNY_ROUTES_2_21_SCENARIO,
]) {
  const target = new URL(`${network.id}.json`, outputDirectory);
  await writeFile(target, `${JSON.stringify(network, null, 2)}\n`, "utf8");
  console.log(`Wrote ${target.pathname}`);
}
