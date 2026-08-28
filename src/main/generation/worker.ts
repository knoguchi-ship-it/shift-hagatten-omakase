import { parentPort, workerData } from "node:worker_threads";
import type { GenerationInput } from "../../shared/types";
import { generate } from "./engine";

const { input, cancelSignal } = workerData as {
  input: GenerationInput;
  cancelSignal: SharedArrayBuffer;
};
const cancellation = new Int32Array(cancelSignal);
const result = generate(
  input,
  (progress) => parentPort?.postMessage({ kind: "progress", ...progress }),
  () => Atomics.load(cancellation, 0) === 1,
);
parentPort?.postMessage({ kind: "done", result });
