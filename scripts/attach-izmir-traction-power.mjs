import { readFile, writeFile } from "node:fs/promises";

const target = new URL("../src/config/networks/izmir-konak.json", import.meta.url);
const network = JSON.parse(await readFile(target, "utf8"));
const byId = (id) => network.segments.find((segment) => segment.id === id);
const pointAt = (segmentId, end = false) => {
  const points = byId(segmentId).points;
  return points[end ? points.length - 1 : 0];
};
const lineSubstations = [
  {
    id: "IZM-SS-FAHRETTIN",
    label: "Konak line transformer · Fahrettin Altay area",
    sectionLabel: "Fahrettin Altay — Göztepe",
    point: pointAt("IZK-O18", true),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "İBB confirms six line transformer buildings; exact building-to-feeder drawing is not publicly available",
  },
  {
    id: "IZM-SS-GOZTEPE",
    label: "Konak line transformer · Göztepe/Karantina area",
    sectionLabel: "Göztepe — Karantina",
    point: pointAt("IZK-O14", true),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "Location reconstructed from the official count and operational section boundaries",
  },
  {
    id: "IZM-SS-KONAK",
    label: "Konak line transformer · Konak İskele area",
    sectionLabel: "Karantina — Konak İskele",
    point: pointAt("IZK-O09", true),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "Location reconstructed from the official count and operational section boundaries",
  },
  {
    id: "IZM-SS-BASMANE",
    label: "Basmane Meydanı traction transformer",
    sectionLabel: "Konak İskele — Atatürk Spor Salonu",
    point: pointAt("IZK-O07", true),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-address",
    evidence: "İBB 2 Dec 2024 fault notice identifies the Basmane transformer feeding the line; marker snapped to nearest rail",
  },
  {
    id: "IZM-SS-ALSANCAK",
    label: "Konak line transformer · Alsancak area",
    sectionLabel: "Atatürk Spor Salonu — Alsancak",
    point: pointAt("IZK-O04", true),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "Location reconstructed from the official count and the one-way-pair geometry",
  },
  {
    id: "IZM-SS-HALKAPINAR",
    label: "Konak line transformer · Halkapınar approach",
    sectionLabel: "Alsancak — Halkapınar",
    point: pointAt("IZK-O01"),
    nominalVoltageV: 750,
    maxPowerKw: 2_000,
    confidence: "verified-count-estimated-location",
    evidence: "İBB confirms six transformer buildings along the line; exact feeder limits are not public",
  },
];
const depotPoint = network.depots[0].point;
const depotSubstations = [-1, 1].map((direction, index) => ({
  id: `IZM-DEPOT-SS-${index === 0 ? "A" : "B"}`,
  label: `Halkapınar depot transformer ${index === 0 ? "A" : "B"}`,
  point: { x: depotPoint.x + direction * 9, y: depotPoint.y - 8 },
  nominalVoltageV: 750,
  maxPowerKw: 1_200,
  confidence: "verified-count-estimated-location",
  evidence: "İBB confirms two transformer buildings in the Konak depot area",
  feedsMainLine: false,
}));
const assignments = new Map(lineSubstations.map((item) => [item.id, []]));
for (const segment of network.segments) {
  const first = segment.points[0];
  const last = segment.points.at(-1);
  const midpoint = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
  const nearest = lineSubstations.reduce((best, candidate) => {
    const distance = (item) => (midpoint.x - item.point.x) ** 2 + (midpoint.y - item.point.y) ** 2;
    return distance(candidate) < distance(best) ? candidate : best;
  });
  assignments.get(nearest.id).push(segment.id);
}
network.tractionPowerSystem = {
  nominalVoltageV: 750,
  label: "Konak T2 750 V DC traction sections",
  sourceLabel: "İzmir Metropolitan Municipality: 8 transformer buildings (6 line + 2 depot); Basmane feeder fault report, 2 Dec 2024",
  modelNote: "The official transformer count and Basmane supply location are verified. Other line markers and section boundaries are explicitly reconstructed estimates. Each of the six line sections has a three-module 750 V VYCON experimental bank.",
  substations: [...lineSubstations, ...depotSubstations],
  sections: lineSubstations.map((substation, index) => ({
    id: `SECTION-${substation.id}`,
    label: substation.sectionLabel,
    substationId: substation.id,
    segmentIds: assignments.get(substation.id),
    color: ["#fb7185", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#a78bfa"][index],
    flywheel: {
      model: "VYCON REGEN",
      modules: 3,
      modulePowerKw: 125,
      moduleEnergyKWh: 0.520833,
      chargeEfficiency: 0.95,
      dischargeEfficiency: 0.95,
      initialSoc: 0.35,
      converterNote: "Direct 750 V DC traction-bus interface; 90.25% modeled round-trip efficiency",
    },
  })),
};

await writeFile(target, `${JSON.stringify(network, null, 2)}\n`, "utf8");
console.log(`Attached traction-power model to ${target.pathname}`);
