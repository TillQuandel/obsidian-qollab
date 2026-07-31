// Task 19/C — Verweigern statt vereinigen: das Zusammenführen zweier
// unverwandter Änderungsketten darf nicht mehr stillschweigend passieren
//
// Treffen zwei Änderungsketten derselben Note aufeinander, die keinen
// gemeinsamen Vorfahren haben, gibt es ohne Server keine Auflösung, die beides
// erhält UND nichts verdoppelt. Qollab entscheidet sich an drei Stellen bewusst
// für „sichtbares Zuviel statt stillem Verlust" (`unionMerge`): beim Adoptieren
// einer fremden Kette (`ensureDoc`), beim Wechsel auf die Gewinner-Kette
// (`switchToGuid`) und beim lokalen Diff direkt nach dem Adoptieren
// (`mergeForLocalDiff`).
//
// Was fehlte, ist nicht die Erhaltung, sondern die SICHTBARKEIT. Der Nutzer
// findet danach eine Note mit doppelten Absätzen vor und hat keinen Anhaltspunkt,
// woher sie kommen — das Vorbild ist `git merge`, das sich bei unverwandten
// Historien standardmäßig weigert, statt still zu vereinigen.
//
// Der Auslöser ist eng geschnitten: gemeldet wird nur, wenn BEIDE Seiten etwas
// beigetragen haben (`merged !== other && merged !== local`). Ist eine Seite in
// der anderen enthalten — der häufigste Fall, etwa eine leere oder noch nicht
// nachgezogene `.md` —, entsteht keine Dopplung und es gibt nichts zu melden.

import { Notice } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const NOTE = 'ordner/Einkaufsliste.md';
const OWN_ID = 'deadbeef';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const PEER_PATH = `.qollab/${NOTE}.00000001.yjs`;
const PEER2_PATH = `.qollab/${NOTE}.00000002.yjs`;
const OWN_GUID = 'c'.repeat(32);
const KLEINE_GUID = 'a'.repeat(32);
const NOCH_KLEINER = '0'.repeat(32);

function sidecar(guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(encodeStateFile(guid, mgr.encodeState(NOTE)));
}

function handlerWith(vault: VaultMock): { handler: SyncHandler; gemeldet: string[] } {
  const gemeldet: string[] = [];
  const handler = new SyncHandler(
    vault as any,
    new CrdtManager(),
    OWN_ID,
    undefined,
    undefined,
    undefined,
    undefined,
    (p) => gemeldet.push(p)
  );
  return { handler, gemeldet };
}

describe('C: unverwandte Ketten werden gemeldet, nicht still vereinigt', () => {
  it('Kettenwechsel (Tie-Break): beide Seiten tragen bei → gemeldet', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(KLEINE_GUID, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');

    const { handler, gemeldet } = handlerWith(vault);
    const merged = await handler.loadAndMerge(NOTE);

    // Kein Datenverlust — das bleibt die Zusage.
    expect(merged).toContain('Milch');
    expect(merged).toContain('Brot');
    // Und der Nutzer erfährt davon.
    expect(gemeldet).toEqual([NOTE]);
  });

  it('Adoption einer fremden Kette: beide Seiten tragen bei → gemeldet', async () => {
    const vault = makeVaultMock();
    vault._files.set(PEER_PATH, sidecar(KLEINE_GUID, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');

    const { handler, gemeldet } = handlerWith(vault);
    const merged = await handler.applyLocalContent(NOTE, 'Milch\n');

    expect(merged).toContain('Milch');
    expect(merged).toContain('Brot');
    expect(gemeldet).toEqual([NOTE]);
  });

  it('gleicher Stand auf beiden Seiten → nichts zu melden', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(KLEINE_GUID, 'Milch\n'));
    vault._textFiles.set(NOTE, 'Milch\n');

    const { handler, gemeldet } = handlerWith(vault);
    await handler.loadAndMerge(NOTE);

    expect(gemeldet).toEqual([]);
  });

  it('eine Seite ist in der anderen enthalten → nichts zu melden', async () => {
    const vault = makeVaultMock();
    // Die lokale Note ist leer; die fremde Kette bringt alles mit. Es entsteht
    // keine Dopplung, also gibt es auch nichts zu melden.
    vault._files.set(PEER_PATH, sidecar(KLEINE_GUID, 'Brot\n'));
    vault._textFiles.set(NOTE, '');

    const { handler, gemeldet } = handlerWith(vault);
    await handler.applyLocalContent(NOTE, '');

    expect(gemeldet).toEqual([]);
  });
});

// --- Was der Nutzer davon sieht ------------------------------------------
function makePlugin(vault: VaultMock): CrdtSyncPlugin {
  const vaultWithEvents = Object.assign(vault, { on: () => ({}), offref: () => {} });
  const storage = makeLocalStorage();
  storage.saveLocalStorage('qollab-client-id', OWN_ID);
  const app = {
    vault: vaultWithEvents,
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  return new CrdtSyncPlugin(app as any, {} as any);
}

// Die Konflikt-Meldung, abgegrenzt von der Routine-Meldung („CRDT Sync: …
// automatisch gemergt."). Dass beide heute dieselbe Lage beschreiben, ist genau
// der Befund: der Routinefall und der nicht auflösbare Fall waren für den Nutzer
// nicht unterscheidbar.
function konfliktMeldungen(): string[] {
  return (Notice as any).messages.filter((m: string) => m.startsWith('Qollab: „'));
}

describe('C: die Meldung ist für eine Nicht-Technikerin geschrieben', () => {
  beforeEach(() => {
    (Notice as any).messages.length = 0;
  });

  it('nennt die Notiz, sagt was passiert ist und was zu tun ist', async () => {
    const vault = makeVaultMock();
    vault._files.set(PEER_PATH, sidecar(KLEINE_GUID, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');
    vault._mdMtimes.set(NOTE, 10);

    const plugin = makePlugin(vault);
    await plugin.onload();
    await plugin.runStartupSweep();
    plugin.onunload();

    const konflikt = konfliktMeldungen();
    expect(konflikt).toHaveLength(1);
    const text: string = konflikt[0];
    // Kein Fachjargon.
    for (const wort of ['CRDT', 'Inkarnation', 'GUID', 'Sidecar', 'Yjs', 'Merge', 'CRDT-']) {
      expect(text).not.toContain(wort);
    }
    // Sagt, dass nicht automatisch zusammengeführt wurde, und was jetzt gilt.
    expect(text).toMatch(/zwei Ger(ä|ae)ten/);
    expect(text).toMatch(/doppelt/);
  });

  it('höchstens eine Meldung je Notiz und Sitzung', async () => {
    const vault = makeVaultMock();
    vault._files.set(PEER_PATH, sidecar(KLEINE_GUID, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');
    vault._mdMtimes.set(NOTE, 10);

    const plugin = makePlugin(vault);
    await plugin.onload();
    await plugin.runStartupSweep();

    // Zweite unverwandte Kette trifft in derselben Sitzung ein.
    vault._files.set(PEER2_PATH, sidecar(NOCH_KLEINER, 'Butter\n'));
    await (plugin as any).onRemoteYjsUpdate(NOTE);
    plugin.onunload();

    // Der Inhalt beider Ketten ist da …
    expect(vault._textFiles.get(NOTE)).toContain('Butter');
    // … aber der Nutzer wird nicht zugeschüttet.
    const konflikt = konfliktMeldungen();
    expect(konflikt).toHaveLength(1);
  });

  it('die Meldung hängt nicht am Schalter für die Routine-Meldungen', async () => {
    const vault = makeVaultMock();
    vault._files.set(PEER_PATH, sidecar(KLEINE_GUID, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');
    vault._mdMtimes.set(NOTE, 10);

    const plugin = makePlugin(vault);
    await plugin.onload();
    // „Status-Meldungen aus" heißt: keine Meldung über den ROUTINEFALL. Der
    // Konfliktfall ist kein Routinefall — sonst wäre der einzige Hinweis auf
    // eine nicht automatisch auflösbare Lage abschaltbar, ohne dass jemand das
    // je entschieden hätte.
    plugin.settings.statusNotice = false;
    await plugin.runStartupSweep();
    plugin.onunload();

    const konflikt = konfliktMeldungen();
    expect(konflikt).toHaveLength(1);
    // Die Routine-Meldung dagegen bleibt aus.
    expect((Notice as any).messages.some((m: string) => m.includes('automatisch gemergt'))).toBe(
      false
    );
  });
});
