import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  initializeCppRuntimeFromBytes,
  runEnergyComparison,
} from "../src/simulation-core/index.ts";

// Reproduces the benchmark in docs/EXPERIMENTS.md: each network's own fleet
// (its fleet groups, start positions and directions), service from 08:00, a
// 10-minute warm-up and a 60-minute measured window, each energy strategy
// compared against the no-storage reference.
const BENCHMARKS = [
  { scenarioId: "izmir-konak", label: "İzmir" },
  { scenarioId: "nizhny-routes-2-21", label: "Nizhny 2+21" },
  { scenarioId: "nizhny-route-2", label: "Nizhny Route 2" },
];
const WARM_UP_SECONDS = 600;
const DURATION_SECONDS = 3600;
const START_SERVICE_MINUTE = 480;
const CHART_PATH = new URL("../docs/assets/energy-benchmark.svg", import.meta.url);

const { values } = parseArgs({
  options: { "write-chart": { type: "boolean", default: false } },
});

// The traction-power network runs only in the C++ core, so load it explicitly.
await initializeCppRuntimeFromBytes(
  await readFile(new URL("../public/wasm/tram-core.wasm", import.meta.url)),
);

const results = [];
for (const benchmark of BENCHMARKS) {
  const report = runEnergyComparison({
    scenarioId: benchmark.scenarioId,
    warmUpSeconds: WARM_UP_SECONDS,
    durationSeconds: DURATION_SECONDS,
    startServiceMinute: START_SERVICE_MINUTE,
  });
  for (const row of report.rows.filter((item) => item.strategy !== "no-storage")) {
    results.push({
      ...benchmark,
      tramCount: report.tramCount,
      controller: row.strategy === "baseline" ? "reactive" : "predictive",
      energySavingPercent: row.energySavingPercent,
      peakReductionPercent: row.peakReductionPercent,
      flywheelStartKWh: row.flywheelStartKWh,
      flywheelEndKWh: row.flywheelEndKWh,
      interventions: row.interventions,
    });
  }
}

const percent = (value) => `${value.toFixed(1)}%`;
const note = (result) =>
  result.controller === "reactive"
    ? "Flywheel only, no traction guidance"
    : `${result.interventions} intervention${result.interventions === 1 ? "" : "s"}${result.peakReductionPercent < 0 ? "; peak logic requires tuning" : ""}`;

console.log("| Scenario and controller | Grid-energy saving | Peak-power reduction | Flywheel charge, start → end | Notes |");
console.log("| --- | ---: | ---: | ---: | --- |");
for (const result of results) {
  console.log(
    `| ${result.label}, ${result.tramCount} trams, ${result.controller} | ${percent(result.energySavingPercent)} | ${percent(result.peakReductionPercent)} | ${result.flywheelStartKWh.toFixed(1)} → ${result.flywheelEndKWh.toFixed(1)} kWh | ${note(result)} |`,
  );
}

if (values["write-chart"]) {
  await writeFile(CHART_PATH, renderChart(results));
  console.log(`\nWrote ${CHART_PATH.pathname}`);
}

/** Grouped bar chart as a static, deterministic SVG (no timestamps or randomness). */
function renderChart(rows) {
  const series = [
    { key: "energySavingPercent", label: "Grid-energy saving", color: "#2a78d6" },
    { key: "peakReductionPercent", label: "Peak-power reduction", color: "#eb6834" },
  ];
  const ink = { primary: "#1f1e1c", secondary: "#5f5e58", grid: "#e4e3dd", axis: "#9a998f" };
  const width = 1000;
  const height = 460;
  const margin = { top: 64, right: 24, bottom: 76, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const allValues = rows.flatMap((row) => series.map((item) => row[item.key]));
  const step = 10;
  const yMin = Math.min(0, Math.floor(Math.min(...allValues) / step) * step);
  const yMax = Math.max(step, Math.ceil(Math.max(...allValues) / step) * step);
  const y = (value) => margin.top + ((yMax - value) / (yMax - yMin)) * plotHeight;
  const groupWidth = plotWidth / rows.length;
  const barWidth = Math.min(44, (groupWidth * 0.62) / series.length);
  const gap = 2;
  const radius = 4;
  const fixed = (value) => value.toFixed(1);
  const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  // Bar with 4 px rounding on the end away from the zero baseline.
  const bar = (x, value, color) => {
    const top = y(Math.max(value, 0));
    const bottom = y(Math.min(value, 0));
    const h = Math.max(0, bottom - top);
    const r = Math.min(radius, h);
    const w = barWidth;
    const path = value >= 0
      ? `M${fixed(x)} ${fixed(bottom)}V${fixed(top + r)}Q${fixed(x)} ${fixed(top)} ${fixed(x + r)} ${fixed(top)}H${fixed(x + w - r)}Q${fixed(x + w)} ${fixed(top)} ${fixed(x + w)} ${fixed(top + r)}V${fixed(bottom)}Z`
      : `M${fixed(x)} ${fixed(top)}V${fixed(bottom - r)}Q${fixed(x)} ${fixed(bottom)} ${fixed(x + r)} ${fixed(bottom)}H${fixed(x + w - r)}Q${fixed(x + w)} ${fixed(bottom)} ${fixed(x + w)} ${fixed(bottom - r)}V${fixed(top)}Z`;
    return `<path d="${path}" fill="${color}"/>`;
  };

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="title desc" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif">`,
    `<title id="title">Energy and peak-power benchmark</title>`,
    `<desc id="desc">${escape(rows.map((row) => `${row.label} ${row.controller}: grid-energy saving ${percent(row.energySavingPercent)}, peak-power reduction ${percent(row.peakReductionPercent)}`).join("; "))}</desc>`,
    `<rect width="${width}" height="${height}" fill="#fcfcfb"/>`,
  );
  for (let value = yMin; value <= yMax; value += step) {
    const lineY = fixed(y(value));
    parts.push(
      `<line x1="${margin.left}" x2="${width - margin.right}" y1="${lineY}" y2="${lineY}" stroke="${value === 0 ? ink.axis : ink.grid}" stroke-width="1"/>`,
      `<text x="${margin.left - 10}" y="${lineY}" dy="0.32em" text-anchor="end" font-size="12" fill="${ink.secondary}">${value}%</text>`,
    );
  }
  parts.push(
    `<text transform="translate(18 ${fixed(margin.top + plotHeight / 2)}) rotate(-90)" text-anchor="middle" font-size="12" fill="${ink.secondary}">Change relative to no storage</text>`,
  );
  series.forEach((item, index) => {
    const x = margin.left + index * 210;
    parts.push(
      `<rect x="${x}" y="22" width="12" height="12" rx="3" fill="${item.color}"/>`,
      `<text x="${x + 18}" y="28" dy="0.32em" font-size="13" fill="${ink.primary}">${item.label}</text>`,
    );
  });
  rows.forEach((row, rowIndex) => {
    const center = margin.left + groupWidth * (rowIndex + 0.5);
    const start = center - (series.length * barWidth + (series.length - 1) * gap) / 2;
    series.forEach((item, index) => {
      const value = row[item.key];
      const x = start + index * (barWidth + gap);
      parts.push(bar(x, value, item.color));
      const labelY = value >= 0 ? y(value) - 6 : y(value) + 15;
      parts.push(
        `<text x="${fixed(x + barWidth / 2)}" y="${fixed(labelY)}" text-anchor="middle" font-size="11" font-weight="600" fill="${ink.primary}">${fixed(value)}%</text>`,
      );
    });
    parts.push(
      `<text x="${fixed(center)}" y="${height - margin.bottom + 22}" text-anchor="middle" font-size="12" fill="${ink.primary}">${escape(row.label)}</text>`,
      `<text x="${fixed(center)}" y="${height - margin.bottom + 38}" text-anchor="middle" font-size="12" fill="${ink.secondary}">${row.controller}</text>`,
    );
  });
  const footnotes = [
    `Default fleets from ${String(START_SERVICE_MINUTE / 60).padStart(2, "0")}:00 · ${WARM_UP_SECONDS / 60} min warm-up, ${DURATION_SECONDS / 60} min measured · grid energy corrected for flywheel charge · npm run benchmark:energy`,
  ];
  if (rows.some((row) => row.peakReductionPercent < 0)) {
    footnotes.push("A negative peak value identifies a tuning problem, not an improvement.");
  }
  parts.push(
    `<text x="${margin.left}" y="${height - 12}" font-size="11" fill="${ink.secondary}">${escape(footnotes.join(" · "))}</text>`,
    "</svg>",
  );
  return `${parts.join("\n")}\n`;
}
