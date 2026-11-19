import {
	type EngineRequest,
	type EngineResponse,
	PORT_NAME,
	parseRequest,
} from "./protocol.ts";

/** The parts of runtime.Port the router and the client use. */
export interface PortLike {
	name?: string;
	postMessage(message: unknown): void;
	disconnect(): void;
	onMessage: { addListener(listener: (message: unknown) => void): void };
	onDisconnect: { addListener(listener: () => void): void };
}

export interface WorkerLike {
	postMessage(message: EngineRequest): void;
	terminate(): void;
	onmessage: ((event: { data: EngineResponse }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

/**
 * Routes requests from any number of ports to one engine Worker and results back.
 * Request ids are prefixed with a per-port number on the way in and stripped on the way out,
 * so pages cannot collide with or cancel each other's requests.
 * The Worker is started by the first request, not by a connection.
 */
export function createRouter(startWorker: () => WorkerLike) {
	const ports = new Map<string, PortLike>();
	let worker: WorkerLike | null = null;
	let nextPort = 0;

	function ensureWorker() {
		if (worker) return worker;
		const started = startWorker();
		started.onmessage = ({ data }) => {
			if (data.type === "status") {
				for (const port of ports.values()) port.postMessage(data);
				return;
			}
			const cut = data.id.indexOf(":") + 1;
			ports
				.get(data.id.slice(0, cut))
				?.postMessage({ ...data, id: data.id.slice(cut) });
		};
		started.onerror = () => {
			// The engine died. Dropping the ports tells every client its requests are lost;
			// the next request starts a fresh Worker.
			started.terminate();
			if (worker === started) worker = null;
			for (const port of [...ports.values()]) port.disconnect();
			ports.clear();
		};
		worker = started;
		return started;
	}

	return {
		connect(port: PortLike) {
			if (port.name !== PORT_NAME) return;
			const prefix = `${nextPort++}:`;
			ports.set(prefix, port);
			port.onMessage.addListener((message) => {
				const request = parseRequest(message);
				if (!request || request.type === "ping") return; // a ping only has to arrive
				if (request.type === "cancelAll")
					worker?.postMessage({
						type: "cancelAll",
						prefix: prefix + request.prefix,
					});
				else if (request.type === "cancel")
					worker?.postMessage({ ...request, id: prefix + request.id });
				else
					ensureWorker().postMessage({ ...request, id: prefix + request.id });
			});
			port.onDisconnect.addListener(() => {
				ports.delete(prefix);
				worker?.postMessage({ type: "cancelAll", prefix });
			});
		},
	};
}
