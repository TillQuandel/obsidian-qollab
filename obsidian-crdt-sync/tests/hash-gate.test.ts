import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// Task 18 / Teil 2 — Hash-Gate vor dem Historienwechsel.
//
// Regel: Sind der Text des Gewinner-Docs und der lokale Stand im Moment des
// Wechsels byte-identisch, ist der Wechsel verlustfrei. Dann wird nur die GUID
// übernommen — keine Vereinigung, kein setContent, keine eigene Op.
//
// Von vier Systemen unabhängig erfunden: synch (`hashMatches` → filesWritten: 0),
// obsidian-livesync (`isSame` → unterlegenes Leaf löschen), Relay
// (`remapIfHashMatches` → „Same content! Remap to use remote GUID"), Git (gleicher
// Blob-SHA → kein Konflikt).
//
// EHRLICHE EINORDNUNG (Messung, nicht Vermutung): Das Gate ändert am gemessenen
// Verhalten NICHTS. `unionMerge` gibt bei `other === local` den Eingabestand
// unverändert zurück, und `setContent` bricht bei `current === content` vor der
// ersten Op ab — die beiden impliziten Kurzschlüsse tun heute schon exakt das,
// was das Gate explizit macht. Die Mutationsprobe (Gate entfernt) lässt die Tests
// dieser Datei GRÜN, und die Fuzz-Zahlen sind vorher wie nachher identisch. Der
// Wert des Gates ist deshalb nicht die Wirkung, sondern die Absicherung: die
// Invariante steht an der Stelle, an der sie gilt, statt als Nebenwirkung zweier
// fremder Kurzschlüsse. Details in `.superpowers/sdd/task-18-report.md`.

const NOTE = 'note.md';
const OWN_YJS = '.qollab/note.md.aaaa1111.yjs';
const FOREIGN_YJS = '.qollab/note.md.bbbb2222.yjs';
const G_KLEIN = '00000000000000000000000000000000';
const G_GROSS = 'ffffffffffffffffffffffffffffffff';

function schreibeSidecar(vault: any, path: string, guid: string, text: string): Uint8Array {
  const m = new CrdtManager();
  m.setContent(NOTE, text);
  const update = m.encodeState(NOTE);
  vault._files.set(path, toAB(encodeStateFile(guid, update)));
  return update;
}

describe('Task 18 — Hash-Gate beim Inkarnationswechsel', () => {
  it('byte-identischer Stand: der Doc trägt danach AUSSCHLIESSLICH Gewinner-Ops', async () => {
    const vault = makeVaultMock() as any;
    const TEXT = 'kopf\nzeile\n';
    schreibeSidecar(vault, OWN_YJS, G_GROSS, TEXT);
    const gewinner = schreibeSidecar(vault, FOREIGN_YJS, G_KLEIN, TEXT);
    vault._textFiles.set(NOTE, TEXT);

    const crdt = new CrdtManager();
    const handler = new SyncHandler(vault, crdt, 'aaaa1111');
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).toBe(TEXT);
    expect(await handler.currentGuid(NOTE)).toBe(G_KLEIN);

    // Der Kern: kein eigener Beitrag. Der State des Docs ist byte-für-byte der
    // State des Gewinners — hätte der Wechsel den lokalen Stand als frische Op
    // eingebracht, stünde hier eine zweite Client-Kette drin und die Bytes wären
    // länger. Genau diese zweite Kette ist die in Teil 1 lokalisierte Ursache der
    // Verdopplung (sie konkateniert beim nächsten mergeCompatible).
    expect(Array.from(crdt.encodeState(NOTE))).toEqual(Array.from(gewinner));
  });

  it('abweichender Stand: das Gate greift nicht, der lokale Überschuss überlebt', async () => {
    const vault = makeVaultMock() as any;
    schreibeSidecar(vault, OWN_YJS, G_GROSS, 'kopf\nnurLokal\n');
    schreibeSidecar(vault, FOREIGN_YJS, G_KLEIN, 'kopf\nnurGewinner\n');
    vault._textFiles.set(NOTE, 'kopf\nnurLokal\n');

    const handler = new SyncHandler(vault, new CrdtManager(), 'aaaa1111');
    const merged = (await handler.loadAndMerge(NOTE))!;

    expect(merged).toContain('nurLokal');
    expect(merged).toContain('nurGewinner');
    expect(await handler.currentGuid(NOTE)).toBe(G_KLEIN);
  });

  // Gegenprobe zur Vorgabe „…ohne saveState" aus dem Auftrag. Sie hält nicht:
  // Der Doc hat gewechselt (fremde GUID, fremde Op-Historie), unsere eigene
  // Sidecar trägt aber noch die AUFGEGEBENE Inkarnation. Bliebe sie stehen,
  // baute `ensureDoc` beim nächsten Start die tote Inkarnation aus ihr wieder auf
  // und der Wechsel liefe von vorn los — und bis dahin bewürbe unsere Datei eine
  // GUID, gegen die andere Geräte weiter Tie-Breaks fahren. Der Schreibvorgang
  // ist also nicht der „unnötige", den das Gate spart.
  it('der Wechsel wird persistiert — auch wenn das Gate greift', async () => {
    const vault = makeVaultMock() as any;
    const TEXT = 'kopf\nzeile\n';
    schreibeSidecar(vault, OWN_YJS, G_GROSS, TEXT);
    schreibeSidecar(vault, FOREIGN_YJS, G_KLEIN, TEXT);
    vault._textFiles.set(NOTE, TEXT);

    const handler = new SyncHandler(vault, new CrdtManager(), 'aaaa1111');
    await handler.loadAndMerge(NOTE);

    // Auf Platte steht jetzt die Gewinner-GUID, nicht mehr die eigene alte.
    const eigen = decodeStateFile(new Uint8Array(vault._files.get(OWN_YJS)!));
    expect(eigen.guid).toBe(G_KLEIN);

    // Und ein Neustart (frischer Handler, frischer CrdtManager) übernimmt sie,
    // statt die aufgegebene Inkarnation wiederzubeleben.
    const nachNeustart = new SyncHandler(vault, new CrdtManager(), 'aaaa1111');
    expect(await nachNeustart.currentGuid(NOTE)).toBe(G_KLEIN);
  });
});
