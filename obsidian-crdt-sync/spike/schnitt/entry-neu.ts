// Einstiegspunkt fuer den HEUTIGEN Bundle. Gleiche Exporte wie `entry.ts`, nur mit
// den Pfaden, die an dieser Stelle im Baum gelten (`entry.ts` traegt noch die Pfade
// vom urspruenglichen Ort unter repo-root `spike/` und ist hier nicht baubar).
// Getrennte Datei, damit der Kalibrierungsarm `real.cjs` unangetastet bleibt.
export { SyncHandler } from '../../src/sync-handler';
export { CrdtManager } from '../../src/crdt-manager';
export { encodeStateFile, decodeStateFile, generateGuid } from '../../src/state-file';
export { unionMerge, threeWayMerge, insertedTexts } from '../../src/text-merge';
// Das HERKUNFTSTOR des modify-Handlers (main.ts:329-335) steht und faellt mit
// dieser Klasse. Der Spike bildet das Tor nicht nach, sondern fuehrt denselben
// Code — sonst misst man eine Nachbildung des Tors statt des Tors.
export { WriteProvenance } from '../../src/write-provenance';
export { makeVaultMock, toArrayBuffer } from '../../tests/helpers/vault-mock';
