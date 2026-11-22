// Downloaded models, kept in the add-on's own IndexedDB: written by the settings page, read by
// the engine Worker. Both are the add-on's origin, so they see the same database. No web page
// can reach it. See docs/FINDINGS.md §13 for what was tried.

import { helperKey } from "./models.ts";

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

/**
 * Stores a model and, with it, the helper file its front end needs. One transaction: both are there or
 * neither is, so a download that is interrupted leaves nothing behind.
 */
export const storeModel = (id: string, bytes: Uint8Array<ArrayBuffer>, helper?: Uint8Array<ArrayBuffer>) =>
  run("readwrite", (store) => {
    if (helper) store.put(new Blob([helper]), helperKey(id));
    return store.put(new Blob([bytes]), id);
  });

/** Deletes a model and its helper file, if it has one. One transaction: both go or neither does. */
export const deleteModel = (id: string) =>
  run("readwrite", (store) => {
    store.delete(helperKey(id));
    return store.delete(id);
  });

/** A stored model's file, or null when it is not there. */
export async function readModel(id: string): Promise<Uint8Array | null> {
  const blob: unknown = await run("readonly", (store) => store.get(id));
  return blob instanceof Blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
