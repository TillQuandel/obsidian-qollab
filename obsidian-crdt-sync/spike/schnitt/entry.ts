// Einstiegspunkt fuer den Spike-Bundle: reicht den UNVERAENDERTEN Produktionscode
// nach aussen, damit die Machbarkeitsstudie den Ist-Schnitt am echten Code misst
// statt an einem Nachbau.
export { SyncHandler } from '../obsidian-crdt-sync/src/sync-handler';
export { CrdtManager } from '../obsidian-crdt-sync/src/crdt-manager';
export { encodeStateFile, decodeStateFile, generateGuid } from '../obsidian-crdt-sync/src/state-file';
export { unionMerge, threeWayMerge, insertedTexts } from '../obsidian-crdt-sync/src/text-merge';
export { makeVaultMock, toArrayBuffer } from '../obsidian-crdt-sync/tests/helpers/vault-mock';
