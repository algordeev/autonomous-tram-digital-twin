import {
  initializeCppRuntime,
  runEnergyComparison,
} from "./simulation-core/index.ts";

interface ComparisonRequest {
  scenarioId: string;
  tramCount: number;
  durationSeconds: number;
  startServiceMinute: number;
}

self.onmessage = async (event: MessageEvent<ComparisonRequest>) => {
  try {
    const ready = await initializeCppRuntime();
    if (!ready) throw new Error("C++ energy core could not be loaded");
    self.postMessage({ ok: true, report: runEnergyComparison(event.data) });
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : "Comparison failed",
    });
  }
};
