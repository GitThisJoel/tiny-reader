// Downloaded models, kept in the add-on's own IndexedDB: written by the settings page, read by
// the engine Worker. Both are the add-on's origin, so they see the same database. No web page
// can reach it. See docs/FINDINGS.md §13 for what was tried.

const STORE = "files";

function run<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const opening = indexedDB.open("models", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(STORE, mode);
      const asked = request(transaction.objectStore(STORE));
      // Resolved when the transaction is through, so a stored model really is stored.
      transaction.oncomplete = () => resolve(asked.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
      database.close(); // once the transaction is done
    };
  });
}

/** The ids of the models in storage. A model's helper file is stored under its own key (`helperKey`), which is no id. */
export const storedModels = async () =>
  ((await run("readonly", (store) => store.getAllKeys())) as string[]).filter((key) => !key.includes("/"));

export const storeModel = (id: string, bytes: Uint8Array<ArrayBuffer>) =>
  run("readwrite", (store) => store.put(new Blob([bytes]), id));

export const deleteModel = (id: string) => run("readwrite", (store) => store.delete(id));

/** A stored model's file, or null when it is not there. */
export async function readModel(id: string): Promise<Uint8Array | null> {
  const blob: unknown = await run("readonly", (store) => store.get(id));
  return blob instanceof Blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
