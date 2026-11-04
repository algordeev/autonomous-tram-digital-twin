import {
  cppRuntimeLoadError,
  initializeCppRuntime,
  runEnergyComparison,
} from "./simulation-core/index.ts";

interface ComparisonRequest {
  /** Resolved by the page: the worker cannot find the core on its own under a sub-path. */
  wasmUrl: string;
  scenarioId: string;
  tramCount: number;
  durationSeconds: number;
  startServiceMinute: number;
}

self.onmessage = async (event: MessageEvent<ComparisonRequest>) => {
  try {
    const ready = await initializeCppRuntime(event.data.wasmUrl);
    if (!ready) {
      throw new Error(`C++ energy core could not be loaded (${cppRuntimeLoadError ?? "unknown error"})`);
    }
    self.postMessage({ ok: true, report: runEnergyComparison(event.data) });
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : "Comparison failed",
    });
  }
};
