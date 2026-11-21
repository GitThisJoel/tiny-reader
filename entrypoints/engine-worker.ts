// The speech engine. Runs in a dedicated Worker started by the background event page, so the
// model and ONNX Runtime never enter a web page and page CSPs do not apply.
import * as ort from "onnxruntime-web/wasm";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { createEngine, NothingToPronounce } from "@/engine/engine.ts";
import { type FrontEnd, loadFrontEnd } from "@/engine/frontends.ts";
import { JobQueue } from "@/engine/job-queue.ts";
import { createLoader } from "@/engine/loader.ts";
import { readModel } from "@/engine/model-store.ts";
import { helperKey, type Model, readsOnly } from "@/engine/models.ts";
import { type EngineResponse, parseRequest } from "@/engine/protocol.ts";

export default defineUnlistedScript(() => {
  const scope = self as unknown as {
    postMessage(message: EngineResponse, transfer?: Transferable[]): void;
    onmessage: ((event: MessageEvent<unknown>) => void) | null;
    location: Location;
  };
  const queue = new JobQueue();

  // The bundled model and the phonemizer data are read from inside the add-on package, a
  // downloaded model from the add-on's own storage. No network.
  const asset = async (path: string) => {
    const response = await fetch(new URL(path, scope.location.href));
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.arrayBuffer();
  };
  // Extension pages are not cross-origin isolated, so there are no wasm threads.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL("/ort/", scope.location.href).href;

  // A front end is set up once and kept: switching between models of one language costs only the model.
  const frontEnds = new Map<string, Promise<FrontEnd>>();
  function frontEnd(model: Model) {
    let loading = frontEnds.get(model.frontend);
    if (!loading) {
      loading = loadFrontEnd(model.frontend, asset, { ort, helper: () => readModel(helperKey(model.id)) });
      frontEnds.set(model.frontend, loading);
      loading.catch(() => frontEnds.delete(model.frontend));
    }
    return loading;
  }

  const load = createLoader({
    bundled: async () => new Uint8Array(await asset("/assets/model.onnx")),
    stored: readModel,
    // The front end comes first: a model whose front end this build lacks is refused before its file is loaded.
    create: async (file, model) => createEngine(ort, { frontEnd: await frontEnd(model), model: file }),
    status: (state) => scope.postMessage({ type: "status", state }),
  });

  scope.onmessage = ({ data }) => {
    const request = parseRequest(data);
    if (!request) return;
    if (request.type === "cancel") return queue.cancel(request.id);
    if (request.type === "cancelAll") return queue.cancelAll(request.prefix);
    if (request.type !== "synthesize") return;
    const { id, text, options } = request;
    queue
      .run(id, async (signal) => {
        const { engine, model, notice } = await load(options.model);
        // After a fallback the voice asked for may not exist in the model that speaks.
        const voice = Math.min(options.voice, model.voices.length - 1);
        const result = await engine.speak(text, { ...options, voice }, signal).catch((error: unknown) => {
          // Said with the language of the model that tried: text in another one is the usual reason.
          throw error instanceof NothingToPronounce ? new NothingToPronounce(readsOnly(model)) : error;
        });
        return result && { ...result, notice };
      })
      .then(
        (result) => {
          // undefined or null: cancelled. Nothing is sent for a cancelled request.
          if (result) scope.postMessage({ type: "result", id, ...result }, [result.pcm.buffer]);
        },
        (error: unknown) => {
          scope.postMessage({
            type: "error",
            id,
            code: error instanceof NothingToPronounce ? "nothing-to-pronounce" : "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
  };
});
