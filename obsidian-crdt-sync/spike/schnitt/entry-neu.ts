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
// Die Warteschlange, die im Plugin ZWISCHEN `merke()` und `istEigen()` liegt
// (main.ts:310 gegen die Umhuellung in write-provenance.ts:171-245). Der Apparat
// hat sie bis 2026-08-15 nicht gefuehrt und verglich synchron — genau dort sitzt
// der Unterschied, den `M-06` als ungeklaert fuehrt. Auch hier: dieselbe Klasse,
// kein Nachbau.
export { PathQueue } from '../../src/path-queue';
export { makeVaultMock, toArrayBuffer } from '../../tests/helpers/vault-mock';
