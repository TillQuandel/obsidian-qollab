import { SyncHandler, TombstoneStore } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// Tests 1-4 (Task 3): Doc-GUID + Recreate-Tombstone.
// Deckt Zombie-Resurrection, Simultan-Erstkontakt-Konvergenz (identisch +
// divergent) und Legacy-Kompatibilität ab.

function makeTombstoneStore(): TombstoneStore & { _set: Set<string> } {
  const set = new Set<string>();
  return {
    has: (guid: string) => set.has(guid),
    add: async (guid: string) => {
      set.add(guid);
    },
    _set: set,
  };
}

// Datei-Sync-Simulation. Modelliert die Realität: jede .yjs-Datei hat genau
// EINEN Schreiber (ihre clientId). Es wird immer nur die Datei ihres Besitzers
// zum Peer propagiert — nie eine veraltete Spiegelkopie zurückgeschrieben (das
// tat eine naive bidirektionale Kopie und überschrieb frisch geswitchte
// Dateien wieder mit dem alten Stand).
function syncYjs(
  vA: any,
  cidA: string,
  vB: any,
  cidB: string,
  notePath: string
): void {
  const pA = `.qollab/${notePath}.${cidA}.yjs`;
  const pB = `.qollab/${notePath}.${cidB}.yjs`;
  if (vA._files.has(pA)) vB._files.set(pA, vA._files.get(pA));
  if (vB._files.has(pB)) vA._files.set(pB, vB._files.get(pB));
}

describe('Doc-GUID + Tombstone', () => {
  // Test 1
  it('Zombie-Resurrection: stale fremde .yjs mit getombsteter GUID wird ignoriert und gelöscht', async () => {
    const vault = makeVaultMock() as any;
    const tomb = makeTombstoneStore();
    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000', tomb);

    // 1) Note mit Historie anlegen.
    vault._textFiles.set('note.md', 'Alter Inhalt\n');
    await handler.applyLocalContent('note.md', 'Alter Inhalt\n');
    const oldGuid = await handler.currentGuid('note.md');
    expect(oldGuid).not.toBeNull();

    // Stale fremde .yjs derselben (alten) Inkarnation für später bauen.
    const stalePath = '.qollab/note.md.5e307e99.yjs';
    const staleManager = new CrdtManager();
    staleManager.setContent('note.md', 'Alter Inhalt\n');
    const staleBytes = encodeStateFile(oldGuid!, staleManager.encodeState('note.md'));

    // 2) Delete simulieren: Tombstone + Siblings weg + dispose.
    await tomb.add(oldGuid!);
    for (const p of await vault.listYjsFiles('note.md')) vault._files.delete(p);
    handler.disposeNote('note.md');

    // 3) Gleichnamige Note neu anlegen mit neuem Inhalt.
    vault._textFiles.set('note.md', 'Neuer Inhalt\n');
    await handler.applyLocalContent('note.md', 'Neuer Inhalt\n');
    const newGuid = await handler.currentGuid('note.md');
    expect(newGuid).not.toBe(oldGuid);

    // 4) Stale fremde .yjs (alte GUID, alter Inhalt) taucht per Datei-Sync auf.
    vault._files.set(stalePath, toAB(staleBytes));

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe('Neuer Inhalt\n');
    expect(merged).not.toContain('Alter Inhalt');
    // Stale Leiche wurde aus dem Vault aufgeräumt.
    expect(vault._files.has(stalePath)).toBe(false);
  });

  // Test 2
  it('Simultan-Erstkontakt (identischer Text) konvergiert auf die kleinere GUID', async () => {
    const text = 'Gemeinsamer Text\n';
    const vA = makeVaultMock() as any;
    const vB = makeVaultMock() as any;

    const A = new SyncHandler(vA, new CrdtManager(), 'aaaa1111');
    const B = new SyncHandler(vB, new CrdtManager(), 'bbbb2222');

    // Unabhängige Initialisierung, kein Blick auf den jeweils anderen.
    vA._textFiles.set('note.md', text);
    vB._textFiles.set('note.md', text);
    await A.applyLocalContent('note.md', text);
    await B.applyLocalContent('note.md', text);

    const gA = (await A.currentGuid('note.md'))!;
    const gB = (await B.currentGuid('note.md'))!;
    expect(gA).not.toBe(gB);
    const smaller = gA < gB ? gA : gB;

    // Beide sehen jetzt die Dateien des anderen.
    syncYjs(vA, 'aaaa1111', vB, 'bbbb2222', 'note.md');
    const resA = await A.loadAndMerge('note.md');
    const resB = await B.loadAndMerge('note.md');

    // Text bleibt exakt einmal erhalten (keine Verdopplung).
    expect(resA).toBe(text);
    expect(resB).toBe(text);
    // Beide tragen anschließend dieselbe (kleinere) GUID.
    expect(await A.currentGuid('note.md')).toBe(smaller);
    expect(await B.currentGuid('note.md')).toBe(smaller);
  });

  // Test 3
  it('Simultan-Erstkontakt (divergent, eine Zeile) konvergiert deterministisch, beide distinktiven Inhalte überleben', async () => {
    // Reale Semantik seit Task 13/A: Zwischen zwei Inkarnationen gibt es keinen
    // gemeinsamen Vorfahren — der Verlierer (größere GUID) VEREINIGT deshalb
    // seinen Stand mit der Gewinner-Basis, statt ihn per 2-Wege-Diff darüber zu
    // legen. Vorher wurde der Verlierer-Volltext kanonisch und die abweichende
    // Zeile des Gewinners ging verloren (inkl. Delete-Ops, die den Verlust zum
    // Gewinner zurücktrugen — Realtest S05 v1: 10/10 divergent). Jetzt überleben
    // beide Zeilen, Gewinner-Beitrag zuerst.
    // GUIDs fest gesetzt, damit deterministisch der gewünschte Verlierer die
    // inhaltliche Änderung trägt.
    const G_SMALL = '00000000000000000000000000000000';
    const G_LARGE = 'ffffffffffffffffffffffffffffffff';
    const textWin = 'Alice war hier\nZeile 2\n'; // kleinere GUID (Gewinner-Basis)
    const textLose = 'Alice war hier\nBob war hier\n'; // größere GUID, ändert Zeile 2
    const expected = 'Alice war hier\nZeile 2\nBob war hier\n';

    const vA = makeVaultMock() as any; // Gerät mit kleiner GUID
    const vB = makeVaultMock() as any; // Gerät mit großer GUID

    const mA = new CrdtManager();
    mA.setContent('note.md', textWin);
    vA._files.set(
      '.qollab/note.md.aaaa1111.yjs',
      toAB(encodeStateFile(G_SMALL, mA.encodeState('note.md')))
    );
    vA._textFiles.set('note.md', textWin);

    const mB = new CrdtManager();
    mB.setContent('note.md', textLose);
    vB._files.set(
      '.qollab/note.md.bbbb2222.yjs',
      toAB(encodeStateFile(G_LARGE, mB.encodeState('note.md')))
    );
    vB._textFiles.set('note.md', textLose);

    const A = new SyncHandler(vA, new CrdtManager(), 'aaaa1111');
    const B = new SyncHandler(vB, new CrdtManager(), 'bbbb2222');

    let resA = '';
    let resB = '';
    for (let i = 0; i < 3; i++) {
      syncYjs(vA, 'aaaa1111', vB, 'bbbb2222', 'note.md');
      resA = (await A.loadAndMerge('note.md')) ?? '';
      resB = (await B.loadAndMerge('note.md')) ?? '';
    }

    expect(resA).toBe(resB); // Kern: deterministische Konvergenz, kein Konflikt-Copy
    expect(resA).toBe(expected);
    // "Alice war hier" steht in beiden Ausgangstexten (geteilte, unveränderte
    // Zeile) — belegt nur, dass gemeinsamer Inhalt nicht zerstört wird.
    expect(resA).toContain('Alice war hier');
    expect(resA).toContain('Bob war hier'); // Verlierer-Änderung erhalten
    expect(resA).toContain('Zeile 2'); // Gewinner-Zeile nicht mehr weggediffed
    expect(await A.currentGuid('note.md')).toBe(G_SMALL);
    expect(await B.currentGuid('note.md')).toBe(G_SMALL);
  });

  // Test 4
  it('Legacy-.yjs ohne Header wird weiter gemergt; eigene Datei ist danach neues Format', async () => {
    const vault = makeVaultMock() as any;
    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');

    // Legacy: rohes Yjs-Update ohne QLB1-Header.
    const legacy = new CrdtManager();
    legacy.setContent('note.md', 'Legacy-Inhalt\n');
    vault._files.set(
      '.qollab/note.md.1e6ac001.yjs',
      toAB(legacy.encodeState('note.md'))
    );
    // Task 13/C: Die Note existiert lokal (sonst greift der Phantom-Guard).
    vault._textFiles.set('note.md', 'Legacy-Inhalt\n');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe('Legacy-Inhalt\n');

    // Eigene Datei existiert jetzt im neuen Format (QLB1-Magic).
    const ownBytes = new Uint8Array(
      vault._files.get('.qollab/note.md.10ca1000.yjs')!
    );
    expect(String.fromCharCode(...Array.from(ownBytes.subarray(0, 4)))).toBe(
      'QLB1'
    );
  });

  // Regression (Review-Finding): Tie-Break bei fehlender .md darf die eigene
  // Historie NICHT verwerfen. Sonst leert setContent('') den Doc und der leere
  // Stand propagiert als delete-all → Cross-Device-Datenverlust.
  it('Tie-Break ohne .md: eigene Inkarnation bleibt unverändert, kein leerer State', async () => {
    const vault = makeVaultMock() as any;
    const OWN_GUID = 'ffffffffffffffffffffffffffffffff'; // größer → würde verlieren
    const FOREIGN_GUID = '00000000000000000000000000000000'; // kleiner → gewänne
    const ownContent = 'Wichtiger Inhalt\n';

    // Eigener persistierter Stand (größere GUID).
    const ownDoc = new CrdtManager();
    ownDoc.setContent('note.md', ownContent);
    const ownPath = '.qollab/note.md.10ca1000.yjs';
    const ownBytesBefore = toAB(
      encodeStateFile(OWN_GUID, ownDoc.encodeState('note.md'))
    );
    vault._files.set(ownPath, ownBytesBefore);

    // Fremde Inkarnation mit kleinerer GUID + anderem Inhalt.
    const foreignDoc = new CrdtManager();
    foreignDoc.setContent('note.md', 'Fremder Inhalt\n');
    vault._files.set(
      '.qollab/note.md.5e307e01.yjs',
      toAB(encodeStateFile(FOREIGN_GUID, foreignDoc.encodeState('note.md')))
    );

    // KEINE .md im Vault (extern gelöscht bei geschlossener App).
    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');
    const merged = await handler.loadAndMerge('note.md');

    // Eigener Inhalt bleibt erhalten, kein Wechsel auf die Gewinner-GUID.
    expect(merged).toBe(ownContent);
    expect(merged).not.toContain('Fremder Inhalt');
    expect(await handler.currentGuid('note.md')).toBe(OWN_GUID);

    // Eigene .yjs trägt weiterhin die eigene GUID und den eigenen (nicht-leeren)
    // Inhalt — es wurde kein leerer State geschrieben.
    const persisted = decodeStateFile(
      new Uint8Array(vault._files.get(ownPath)!)
    );
    expect(persisted.guid).toBe(OWN_GUID);
    const check = new CrdtManager();
    check.applyUpdate('note.md', persisted.update);
    expect(check.getContent('note.md')).toBe(ownContent);
  });
});
