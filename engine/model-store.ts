// Downloaded models, kept in the add-on's own IndexedDB: written by the settings page, read by
// the engine Worker. Both are the add-on's origin, so they see the same database. No web page
// can reach it. See docs/FINDINGS.md §13 for what was tried.

import { helperKey, type Model, sharesHelper } from "./models.ts";

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

/** The ids of the models in storage. A helper file is stored under a key of its own (`helperKey`), which is no id. */
export const storedModels = async () =>
  ((await run("readonly", (store) => store.getAllKeys())) as string[]).filter((key) => !key.includes("/"));

/**
 * Stores a model and, with it, the helper file its front end needs. One transaction: both are there or
 * neither is, so a download that is interrupted leaves nothing behind. A helper file another model
 * brought before is the same file, and is written over with itself.
 */
export const storeModel = (model: Model, bytes: Uint8Array<ArrayBuffer>, helper?: Uint8Array<ArrayBuffer>) =>
  run("readwrite", (store) => {
    if (helper && model.helper) store.put(new Blob([helper]), helperKey(model.helper));
    return store.put(new Blob([bytes]), model.id);
  });

/**
 * Deletes a model, and its helper file unless another model in storage needs the same one. One
 * transaction: all of it happens or none.
 */
export const deleteModel = (model: Model) =>
  run("readwrite", (store) => {
    const { helper } = model;
    if (helper) {
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        if (!sharesHelper(model, keys.result)) store.delete(helperKey(helper));
      };
    }
    return store.delete(model.id);
  });

/** A stored model's file, or null when it is not there. */
export async function readModel(id: string): Promise<Uint8Array | null> {
  const blob: unknown = await run("readonly", (store) => store.get(id));
  return blob instanceof Blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}
