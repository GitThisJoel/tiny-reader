/**
 * Runs jobs one at a time, in order, each under an id that can be cancelled.
 * A cancelled job that has not started never runs; one that is running sees its signal abort.
 * Either way `run` resolves to undefined, so the caller sends nothing for it.
 */
export class JobQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private controllers = new Map<string, AbortController>();

  run<T>(id: string, job: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    const controller = new AbortController();
    this.controllers.get(id)?.abort();
    this.controllers.set(id, controller);
    const result = this.tail.then(async () => {
      try {
        if (controller.signal.aborted) return undefined;
        const value = await job(controller.signal);
        return controller.signal.aborted ? undefined : value;
      } finally {
        if (this.controllers.get(id) === controller) this.controllers.delete(id);
      }
    });
    // A failed job must not block the ones behind it.
    this.tail = result.catch(() => {});
    return result;
  }

  cancel(id: string) {
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
  }

  cancelAll(prefix = "") {
    for (const id of [...this.controllers.keys()]) if (id.startsWith(prefix)) this.cancel(id);
  }

  get size() {
    return this.controllers.size;
  }
}
