// The speech engine. Runs in a dedicated Worker started by the background event page, so the
// model and ONNX Runtime never enter a web page and page CSPs do not apply.
import * as ort from "onnxruntime-web/wasm";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import {
	createEngine,
	type Engine,
	NothingToPronounce,
} from "@/engine/engine.ts";
import { JobQueue } from "@/engine/job-queue.ts";
import { type EngineResponse, parseRequest } from "@/engine/protocol.ts";

export default defineUnlistedScript(() => {
	const scope = self as unknown as {
		postMessage(message: EngineResponse, transfer?: Transferable[]): void;
		onmessage: ((event: MessageEvent<unknown>) => void) | null;
		location: Location;
	};
	const queue = new JobQueue();
	let engine: Promise<Engine> | null = null;

	// Everything is read from inside the add-on package. No network.
	const asset = async (path: string) => {
		const response = await fetch(new URL(path, scope.location.href));
		if (!response.ok) throw new Error(`${path}: ${response.status}`);
		return response.arrayBuffer();
	};

	function load(): Promise<Engine> {
		if (engine) return engine;
		scope.postMessage({ type: "status", state: "loading" });
		// Extension pages are not cross-origin isolated, so there are no wasm threads.
		ort.env.wasm.numThreads = 1;
		ort.env.wasm.wasmPaths = new URL("/ort/", scope.location.href).href;
		const loading = Promise.all([
			asset("/assets/model.onnx"),
			asset("/assets/tiny-voca-js.gguf"),
		]).then(([model, gguf]) =>
			createEngine(ort, { model: new Uint8Array(model), gguf }),
		);
		engine = loading;
		loading.then(
			() => scope.postMessage({ type: "status", state: "ready" }),
			() => {
				// Let the next request try again instead of failing forever.
				if (engine === loading) engine = null;
			},
		);
		return loading;
	}

	scope.onmessage = ({ data }) => {
		const request = parseRequest(data);
		if (!request) return;
		if (request.type === "cancel") return queue.cancel(request.id);
		if (request.type === "cancelAll") return queue.cancelAll(request.prefix);
		if (request.type !== "synthesize") return;
		const { id, text, options } = request;
		queue
			.run(id, async (signal) => (await load()).speak(text, options, signal))
			.then(
				(result) => {
					// undefined or null: cancelled. Nothing is sent for a cancelled request.
					if (result)
						scope.postMessage({ type: "result", id, ...result }, [
							result.pcm.buffer,
						]);
				},
				(error: unknown) => {
					scope.postMessage({
						type: "error",
						id,
						code:
							error instanceof NothingToPronounce
								? "nothing-to-pronounce"
								: "failed",
						message: error instanceof Error ? error.message : String(error),
					});
				},
			);
	};
});
