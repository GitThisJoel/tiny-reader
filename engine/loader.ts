import { BUNDLED, type Model, modelById } from "./models.ts";

/** What the loader needs of an engine. */
interface Releasable {
  release(): Promise<void>;
}

export interface Loaded<E> {
  engine: E;
  /** The model the engine runs, which is the bundled one after a fallback. */
  model: Model;
  /** After a fallback: why, for the user. */
  notice?: string;
}

export interface LoaderDeps<E> {
  /** The bundled model's file, from the add-on package. */
  bundled(): Promise<Uint8Array>;
  /** A downloaded model's file, or null when it is not in storage. */
  stored(id: string): Promise<Uint8Array | null>;
  /** Makes an engine for `model` from its file. Rejects when the engine cannot work with it. */
  create(file: Uint8Array, model: Model): Promise<E>;
  status(state: "loading" | "ready"): void;
}

/**
 * Keeps one engine loaded, for the model asked for last. A downloaded model that is missing
 * or cannot be used (not a model the engine knows, or one whose text front end this build
 * lacks) is replaced by the bundled one, with a notice saying so.
 * Calls must not overlap: the engine Worker's job queue runs one at a time.
 */
export function createLoader<E extends Releasable>(deps: LoaderDeps<E>) {
  let current: { id: string; loading: Promise<E> } | null = null;
  /** Stored models that failed to load, and why. Not tried again while this Worker lives. */
  const broken = new Map<string, string>();

  /** Makes the engine for `id` the loaded one. The engine loaded before is released first. */
  function swap(model: Model, bytes: () => Promise<Uint8Array>): Promise<E> {
    const { id } = model;
    if (current?.id === id) return current.loading;
    const previous = current?.loading;
    deps.status("loading");
    const loading = (async () => {
      await previous?.then(
        (engine) => engine.release(),
        () => {},
      );
      return deps.create(await bytes(), model);
    })();
    const mine = { id, loading };
    current = mine;
    loading.then(
      () => deps.status("ready"),
      () => {
        // Let the next request try again instead of failing forever.
        if (current === mine) current = null;
      },
    );
    return loading;
  }

  return async function load(id: string): Promise<Loaded<E>> {
    const model = modelById(id) ?? BUNDLED;
    if (model === BUNDLED) return { engine: await swap(BUNDLED, deps.bundled), model };
    if (!broken.has(id))
      try {
        // Looked up before the loaded engine is given up: a missing file must not cost a reload.
        const bytes = current?.id === id ? null : await deps.stored(id);
        if (current?.id === id || bytes) return { engine: await swap(model, async () => bytes as Uint8Array), model };
      } catch (error) {
        broken.set(id, error instanceof Error ? error.message : String(error));
      }
    const why = broken.has(id)
      ? `The voice model ${model.name} could not be used: ${broken.get(id)}.`
      : `The voice model ${model.name} is not downloaded any more. Download it again in Tiny Reader's settings.`;
    return {
      engine: await swap(BUNDLED, deps.bundled),
      model: BUNDLED,
      notice: `${why} This is read with the built-in ${BUNDLED.name} voice.`,
    };
  };
}
