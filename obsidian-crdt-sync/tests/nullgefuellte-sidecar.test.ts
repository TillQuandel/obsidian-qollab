// Die NULLGEFÜLLTE .yjs — Kopf intakt, Nutzlast auf Null gesetzt
//
// Das Schwestermuster zu `truncated-own-state.test.ts`, und das gefährlichere.
// Bei der TRUNKIERUNG ist die Datei kürzer, und `Y.applyUpdate` wirft — der
// bestehende Fix fängt sie. Bei der NULLFÜLLUNG bleibt die GRÖSSE erhalten und
// ab einem Offset steht NUL: der dokumentierte Auslöser sind OneDrive-Platzhalter,
// abgebrochene Hydrierungen und abgebrochene NTFS-Extends (siehe crdt-manager.ts
// bei `isEmptyYjsState`). `Y.applyUpdate` wirft dabei NICHT — Yjs liest
// `[0x00, 0x00]` als „0 Struct-Clients, 0 Delete-Set-Clients" und ignoriert den
// Rest. Der Wurf-Fang greift also nicht.
//
// Die Prüfung, die den Fall erkennt, gibt es längst: `carriesYjsOps` (Task 17/R-1
// wurde genau dafür verschärft). Sie wurde an den entscheidenden Stellen nur nicht
// erreicht, weil die GUID im Header sie kurzschließt:
//
//   - `ensureDoc`: `own.guid !== null || carriesYjsOps(own.update)` — die GUID
//     steht VORNE im ODER. Ein intakter Kopf genügt, die Nutzlast wird nie
//     beurteilt. Gemessen: der leere Doc bekommt die GUID der echten Inkarnation,
//     der nächste lokale Diff materialisiert den GESAMTEN Notiztext als EIGENE
//     Ops, und die später vollständig nachgelieferte Datei mergt GUID-gleich dazu.
//   - `decodeSiblings`: der Ops-Nachweis sitzt INNERHALB des `guid === null`-
//     Zweigs. Ein GUID-tragender Sibling wird nie geprüft — er setzt `hasGuidState`
//     (und ließ damit die echte v0.1-Legacy-Datei löschen) und tritt im Tie-Break
//     an, obwohl er nichts trägt.
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'deadbeef';
const FREMD_ID = 'cafe0001';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const FREMD_PATH = `.qollab/${NOTE}.${FREMD_ID}.yjs`;
const LEGACY_PATH = `.qollab/${NOTE}.yjs`;
const GUID = 'aabbccddeeff00112233445566778899';

const TEXT = 'Kopf\nBestand A\nBestand B\n';
const EXTRA = 'Neuer Absatz\n';

function rohesUpdate(text: string): Uint8Array {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return mgr.encodeState(NOTE);
}

function vollstaendig(guid = GUID, text = TEXT): Uint8Array {
  return encodeStateFile(guid, rohesUpdate(text));
}

// Größe bleibt, ab `keep` steht NUL — das Muster des halb materialisierten
// Downloads. `keep = 20` heißt: Kopf (`QLB1` + GUID) vollständig, Nutzlast weg.
function nullgefuellt(datei: Uint8Array, keep = 20): Uint8Array {
  const b = new Uint8Array(datei.length);
  b.set(datei.subarray(0, keep), 0);
  return b;
}

const zaehle = (text: string, nadel: string): number => text.split(nadel).length - 1;

describe('nullgefuellte eigene Sidecar', () => {
  it('praegt keinen leeren Stand auf die lebende Inkarnation, sondern bricht ab', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT + EXTRA);
    vault._files.set(OWN_PATH, toAB(nullgefuellt(vollstaendig())));
    const laengeVorher = vault._files.get(OWN_PATH)!.byteLength;

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const ergebnis = await handler.applyLocalContent(NOTE, TEXT + EXTRA);

    // Abgebrochen — genau wie bei der abgeschnittenen Fassung.
    expect(ergebnis).toBeUndefined();
    expect(korrupt).toContain(OWN_PATH);
    // Die `.md` bleibt unangetastet.
    expect(vault._textFiles.get(NOTE)).toBe(TEXT + EXTRA);
    // Und nichts wurde zurückgeschrieben: der Sync kann die Datei noch
    // vervollständigen. Vorher wurde hier ein aus dem LEEREN Doc abgeleiteter
    // Stand über die echte Historie geschrieben.
    expect(vault._writeCount.get(OWN_PATH)).toBeUndefined();
    expect(vault._files.get(OWN_PATH)!.byteLength).toBe(laengeVorher);
  });

  it('der nachgelieferte vollstaendige Stand verdoppelt den Text nicht', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT + EXTRA);
    vault._files.set(OWN_PATH, toAB(nullgefuellt(vollstaendig())));

    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID);

    // (1) Erster Lauf auf der genullten Fassung.
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

  it('eine intakte eigene Sidecar wird weiterhin ganz normal verwendet', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT + EXTRA);
    vault._files.set(OWN_PATH, toAB(vollstaendig()));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    expect(await handler.applyLocalContent(NOTE, TEXT + EXTRA)).toBe(TEXT + EXTRA);
    expect(korrupt).toEqual([]);
    expect(await handler.currentGuid(NOTE)).toBe(GUID);
  });

  it('eine legitim LEERE eigene Sidecar (2 Nullbytes) bleibt verwendbar', async () => {
    // Der Preis der Verschärfung darf nicht sein, dass eine echte leere Note
    // blockiert: `encodeState` eines nie befüllten Docs sind exakt zwei Nullbytes,
    // und `saveState` schreibt sie mit gültigem Kopf.
    const leer = encodeStateFile(GUID, new Uint8Array([0, 0]));
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_PATH, toAB(leer));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    expect(await handler.applyLocalContent(NOTE, TEXT)).toBe(TEXT);
    expect(korrupt).toEqual([]);
    // Die Inkarnation aus dem Kopf wird übernommen, keine frische geprägt.
    expect(await handler.currentGuid(NOTE)).toBe(GUID);
  });
});

describe('nullgefuellte FREMDE Sidecar', () => {
  it('verwirft den v0.1-Legacy-Stand nicht mehr, den nur er traegt', async () => {
    // Die Legacy-Datei trägt einen Absatz, den die `.md` (noch) nicht kennt — sie
    // ist damit der einzige Träger. Die fremde GUID-Sidecar ist genullt und trägt
    // nichts; setzte sie weiterhin `hasGuidState`, ignorierte die R1-Regel den
    // Legacy-Stand als „schon enthalten" und löschte ihn ungelesen.
    //
    // Geprüft wird der INHALT, nicht die Datei: Nach dem Erst-Import räumt
    // `cleanupLegacyFile` sie berechtigt ab — dann steckt ihr Stand im eigenen
    // GUID-State.
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(LEGACY_PATH, toAB(rohesUpdate(TEXT + EXTRA)));
    vault._files.set(FREMD_PATH, toAB(nullgefuellt(vollstaendig('0'.repeat(31) + '1'))));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).toContain(EXTRA.trim());
    expect(korrupt).toContain(FREMD_PATH);
    // Die genullte Fremd-Datei bleibt liegen — der Sync kann sie vervollständigen.
    expect(vault._files.has(FREMD_PATH)).toBe(true);
  });

  it('gewinnt keinen Tie-Break gegen die eigene lebende Inkarnation', async () => {
    // Kleinere GUID gewinnt normalerweise. Eine genullte Datei darf das nicht:
    // `switchToGuid` verwürfe die eigene Historie zugunsten von nichts.
    const kleinereGuid = '0000000000000000000000000000ffff';
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_PATH, toAB(vollstaendig()));
    vault._files.set(FREMD_PATH, toAB(nullgefuellt(vollstaendig(kleinereGuid))));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).toBe(TEXT);
    expect(await handler.currentGuid(NOTE)).toBe(GUID);
    expect(korrupt).toContain(FREMD_PATH);
    // Nicht gelöscht — der Sync kann sie noch vervollständigen.
    expect(vault._files.has(FREMD_PATH)).toBe(true);
  });

  it('eine legitim LEERE fremde GUID-Sidecar wird nicht als beschaedigt gemeldet', async () => {
    // Ein Peer mit nie befüllter Note schreibt genau diese zwei Nullbytes. Ohne
    // die Ausnahme gäbe es eine Falschmeldung pro Sitzung, unbegrenzt.
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_PATH, toAB(vollstaendig()));
    vault._files.set(FREMD_PATH, toAB(encodeStateFile('f'.repeat(32), new Uint8Array([0, 0]))));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );
    await handler.loadAndMerge(NOTE);

    expect(korrupt).toEqual([]);
  });

  it('headerlose Legacy-Dateien bleiben lesbar (K.o.-Kriterium)', async () => {
    // Ohne Header gibt es keine GUID und damit keinen Kurzschluss — dieser Zweig
    // ist unverändert. Der Test hält fest, dass die Verschärfung ihn nicht trifft.
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, '');
    vault._files.set(LEGACY_PATH, toAB(rohesUpdate(TEXT)));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).toBe(TEXT);
    expect(korrupt).toEqual([]);
  });
});
