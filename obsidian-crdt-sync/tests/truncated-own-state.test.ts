// Die halb angekommene EIGENE Sidecar — Kopf intakt, Nutzlast abgeschnitten
//
// Auslöser sind real und alltäglich: Stromausfall mitten im Write, ein vom
// Sync-Dienst nur teilweise materialisierter Download, ein abgebrochener
// NTFS-Extend. Der 20-Byte-Kopf (`QLB1` + GUID) steht dann vollständig auf der
// Platte, die Yjs-Nutzlast dahinter nicht.
//
// `ensureDoc` prüft im own-Zweig `own.guid !== null || carriesYjsOps(own.update)`
// — die GUID steht im ODER VORNE, der Zweig wird also allein wegen des intakten
// Kopfes genommen, ohne dass die Nutzlast je beurteilt wird. Darin wirft
// `applyUpdate` (gemessen: `Y.applyUpdate` wirft bei JEDER Trunkierung), der Wurf
// wird gefangen, `onCorruptFile` gemeldet — und danach wird die GUID TROTZDEM
// gesetzt. Ein leerer Doc gibt sich ab da als lebende Historie aus.
//
// Der Schaden entsteht erst danach, und zwar zweistufig:
//   1. Der nächste lokale Diff nimmt den leeren Doc als Basis und materialisiert
//      den GESAMTEN Notiztext als EIGENE Yjs-Ops.
//   2. Liefert der Sync dieselbe Datei später vollständig nach, trägt sie
//      dieselbe GUID, gilt damit als kompatibel und wird gemergt. Yjs
//      dedupliziert nach Item-ID, nicht nach Inhalt — der Text steht danach
//      zweimal in der Note.
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'deadbeef';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const GUID = 'aabbccddeeff00112233445566778899';

const TEXT = 'Kopf\nBestand A\nBestand B\n';
const EXTRA = 'Neuer Absatz\n';

// Die vollständige eigene Hilfsdatei, wie der Sync sie am Ende ablegt.
function vollstaendig(): Uint8Array {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, TEXT);
  return encodeStateFile(GUID, mgr.encodeState(NOTE));
}

// Dieselbe Datei, wie sie nach einem Abbruch auf der Platte liegt: Kopf komplett,
// hinten fehlen ein paar Byte. 6 Byte sind gemessen genug — `Y.applyUpdate` wirft
// und lässt den Doc dabei LEER zurück (ab 3 fehlenden Byte reproduzierbar).
function abgeschnitten(): Uint8Array {
  const voll = vollstaendig();
  return voll.subarray(0, voll.length - 6);
}

const zaehle = (text: string, nadel: string): number => text.split(nadel).length - 1;

describe('abgeschnittene eigene Sidecar', () => {
  it('der nachgelieferte vollstaendige Stand verdoppelt den Text nicht', async () => {
    const vault = makeVaultMock() as any;
    // Der Nutzer hat den Absatz bereits getippt; die `.md` trägt ihn.
    vault._textFiles.set(NOTE, TEXT + EXTRA);
    vault._files.set(OWN_PATH, toAB(abgeschnitten()));

    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID);

    // (1) Erster Lauf auf dem halben Stand.
    await handler.applyLocalContent(NOTE, TEXT + EXTRA);

    // (2) Der Sync liefert DIESELBE Datei nach — jetzt vollständig.
    vault._files.set(OWN_PATH, toAB(vollstaendig()));

    // (3) Nächster Trigger.
    await handler.applyLocalContent(NOTE, TEXT + EXTRA);
    const merged = (await handler.loadAndMerge(NOTE))!;

    for (const marke of ['Kopf', 'Bestand A', 'Bestand B', 'Neuer Absatz']) {
      expect(zaehle(merged, marke)).toBe(1);
    }
    expect(merged).toBe(TEXT + EXTRA);
  });

  it('ohne nachgelieferte Fassung bricht der Lauf ab, statt einen leeren Stand zu praegen', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT + EXTRA);
    vault._files.set(OWN_PATH, toAB(abgeschnitten()));
    const halbeLaenge = vault._files.get(OWN_PATH)!.byteLength;

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const ergebnis = await handler.applyLocalContent(NOTE, TEXT + EXTRA);

    // Abgebrochen: nichts erfasst, kein Stand für den Aufrufer.
    expect(ergebnis).toBeUndefined();
    // Der beschädigte Pfad ist gemeldet — der bestehende Rückkanal.
    expect(korrupt).toContain(OWN_PATH);
    // Die `.md` bleibt unangetastet.
    expect(vault._textFiles.get(NOTE)).toBe(TEXT + EXTRA);
    // Und es wurde kein aus dem leeren Doc abgeleiteter Stand zurückgeschrieben:
    // die halbe Datei liegt unverändert da, der Sync kann sie noch vervollständigen.
    expect(vault._writeCount.get(OWN_PATH)).toBeUndefined();
    expect(vault._files.get(OWN_PATH)!.byteLength).toBe(halbeLaenge);
  });

  it('eine intakte eigene Sidecar wird weiterhin ganz normal verwendet', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT + EXTRA);
    vault._files.set(OWN_PATH, toAB(vollstaendig()));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const ergebnis = await handler.applyLocalContent(NOTE, TEXT + EXTRA);

    expect(ergebnis).toBe(TEXT + EXTRA);
    expect(korrupt).toEqual([]);
    // Die Inkarnation aus dem Kopf wird übernommen, keine frische geprägt.
    expect(await handler.currentGuid(NOTE)).toBe(GUID);
    expect(vault._writeCount.get(OWN_PATH)).toBe(1);
  });
});
