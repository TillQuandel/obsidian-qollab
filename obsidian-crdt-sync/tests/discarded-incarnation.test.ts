// Task 20 — die verworfene Fassung meldet sich ebenfalls
//
// Task 19/C macht das Aufeinandertreffen zweier unverwandter Änderungsketten
// sichtbar — aber nur dort, wo sie tatsächlich VEREINIGT werden (`unite`), also
// beim Wechsel auf die Gewinner-Kette. Der Realtest vom 2026-07-31 (r25/r26/r27)
// hat gezeigt, dass damit genau die falsche Seite gewarnt wird:
//
//   Gewinnt die EIGENE Inkarnation den Tie-Break, verwirft `mergeCompatible` die
//   fremde Kette kommentarlos ("Verlierer-GUIDs ignorieren", sync-handler.ts).
//   Kein `unite`, keine Meldung, kein Log — und genau auf diesem Gerät fehlt
//   danach der Text des anderen.
//
// Gemessen: r26 (Empfänger verliert) meldet über beide Kanäle; r27 (gleiche
// Ankunftsreihenfolge, Empfänger gewinnt) schweigt bei nachweislich laufendem
// Merge. Welche Seite schweigt, entscheidet der Vergleich zweier Zufalls-GUIDs.
//
// Eng geschnitten, damit daraus kein Fehlalarm wird:
//   - Nur wo der Verwurf ENDGÜLTIG ist (Tie-Break entschieden, Adoption), nicht
//     im modify-Pfad `mergePendingForeign` — dort ist die Lage transient und
//     wird vom nächsten Poll aufgelöst.
//   - Nur wenn das verworfene Sibling wirklich Operationen trägt. Eine leere
//     oder halb materialisierte Datei hat nichts zu verlieren.

import { Notice } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager, carriesYjsOps } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const NOTE = 'ordner/Einkaufsliste.md';
const OWN_ID = 'deadbeef';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const PEER_PATH = `.qollab/${NOTE}.00000001.yjs`;
const PEER2_PATH = `.qollab/${NOTE}.00000002.yjs`;
// Die eigene GUID ist hier die KLEINERE — `pickWinnerGuid` nimmt das Minimum,
// also gewinnt das eigene Gerät und verwirft die fremde Kette.
const OWN_GUID_GEWINNT = '1'.repeat(32);
const FREMD_GROSS = 'f'.repeat(32);
const FREMD_GROSS_2 = 'e'.repeat(32);

function sidecar(guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(encodeStateFile(guid, mgr.encodeState(NOTE)));
}

// Ein Sidecar mit gültigem Kopf, aber ohne eine einzige Operation.
function leeresSidecar(guid: string): ArrayBuffer {
  return toAB(encodeStateFile(guid, new CrdtManager().encodeState(NOTE)));
}

// Der Weg, den der Wächter beim Eintreffen einer fremden Sync-Datei nimmt.
// Wie in `clientid-device-local.test.ts` über `any`, weil die Methode
// plugin-intern ist.
function remoteMerge(plugin: CrdtSyncPlugin, notePath: string): Promise<unknown> {
  return (plugin as any).onRemoteYjsUpdate(notePath);
}

function handlerWith(vault: VaultMock): {
  handler: SyncHandler;
  vereinigt: string[];
  verworfen: string[];
} {
  const vereinigt: string[] = [];
  const verworfen: string[] = [];
  const handler = new SyncHandler(
    vault as any,
    new CrdtManager(),
    OWN_ID,
    undefined,
    undefined,
    undefined,
    undefined,
    (p) => vereinigt.push(p),
    (p) => verworfen.push(p)
  );
  return { handler, vereinigt, verworfen };
}

describe('Task 20: der Gewinner meldet die verworfene Fassung', () => {
  it('eigene Inkarnation gewinnt → die verworfene fremde Kette wird gemeldet', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(FREMD_GROSS, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');

    const { handler, vereinigt, verworfen } = handlerWith(vault);
    const merged = await handler.loadAndMerge(NOTE);

    // Der Text des anderen Geräts ist hier NICHT angekommen — das ist die
    // bestehende, bewusste Semantik und bleibt unangetastet.
    expect(merged).not.toContain('Brot');
    expect(merged).toContain('Milch');
    // Aber der Nutzer erfährt jetzt davon.
    expect(verworfen).toEqual([NOTE]);
    // Und zwar über den richtigen Kanal: vereinigt wurde nichts.
    expect(vereinigt).toEqual([]);
  });

  it('mehrere verworfene Fassungen derselben Note melden nur einmal je Aufruf', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(FREMD_GROSS, 'Brot\n'));
    vault._files.set(PEER2_PATH, sidecar(FREMD_GROSS_2, 'Käse\n'));
    vault._textFiles.set(NOTE, 'Milch\n');

    const { handler, verworfen } = handlerWith(vault);
    await handler.loadAndMerge(NOTE);

    expect(verworfen).toEqual([NOTE]);
  });

  it('kompatible Fassung (gleiche Kennung) meldet nicht', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(OWN_GUID_GEWINNT, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');

    const { handler, verworfen } = handlerWith(vault);
    const merged = await handler.loadAndMerge(NOTE);

    // Gleiche Kette → wird gemergt, nichts geht verloren, nichts zu melden.
    expect(merged).toContain('Brot');
    expect(verworfen).toEqual([]);
  });

  // Nachtrag aus der Szenariosuche (adversariale Linse, 2026-07-31): Der erste
  // Wurf prüfte nur, OB die verworfene Fassung Operationen trägt — nicht, ob ihr
  // Text hier überhaupt fehlt. Beim Erstkontakt ist genau das der Regelfall:
  // Beide Geräte materialisieren denselben `.md`-Text als je eigene Kette. Die
  // Meldung forderte dann zum Übertragen von Text auf, der bereits dasteht — und
  // wer ihr folgt, erzeugt die Dopplung, gegen die das ganze Projekt arbeitet.
  // Die Verlierer-Seite prüft das längst (`switchToGuid`, Gate `winnerText ===
  // localText`); dieser Seite fehlte es.
  it('verworfene Fassung mit identischem Text meldet nicht', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(FREMD_GROSS, 'Milch\n'));
    vault._textFiles.set(NOTE, 'Milch\n');

    const { handler, verworfen } = handlerWith(vault);
    await handler.loadAndMerge(NOTE);

    expect(verworfen).toEqual([]);
  });

  it('verworfene Fassung, die im eigenen Stand enthalten ist, meldet nicht', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\nBrot\n'));
    vault._files.set(PEER_PATH, sidecar(FREMD_GROSS, 'Milch\n'));
    vault._textFiles.set(NOTE, 'Milch\nBrot\n');

    const { handler, verworfen } = handlerWith(vault);
    await handler.loadAndMerge(NOTE);

    expect(verworfen).toEqual([]);
  });

  it('verworfene Fassung mit echtem Zusatztext meldet weiterhin', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(FREMD_GROSS, 'Milch\nBrot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');

    const { handler, verworfen } = handlerWith(vault);
    await handler.loadAndMerge(NOTE);

    expect(verworfen).toEqual([NOTE]);
  });

  it('eine Fassung ohne Operationen hat nichts zu verlieren und meldet nicht', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\n'));
    vault._files.set(PEER_PATH, leeresSidecar(FREMD_GROSS));
    vault._textFiles.set(NOTE, 'Milch\n');
    // Vorbedingung des Tests, nicht Annahme:
    expect(carriesYjsOps(new Uint8Array(new CrdtManager().encodeState(NOTE)))).toBe(false);

    const { handler, verworfen } = handlerWith(vault);
    await handler.loadAndMerge(NOTE);

    expect(verworfen).toEqual([]);
  });

  it('der modify-Pfad meldet NICHT — dort ist die Lage transient', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(FREMD_GROSS, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\nEier\n');

    const { handler, verworfen } = handlerWith(vault);
    // applyLocalContent zieht über mergePendingForeign kompatible Siblings ein
    // und ignoriert Fremd-GUIDs bewusst — der Tie-Break kommt erst im Poll.
    await handler.applyLocalContent(NOTE, 'Milch\nEier\n');

    expect(verworfen).toEqual([]);
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

function qollabMeldungen(): string[] {
  return (Notice as any).messages.filter((m: string) => m.startsWith('Qollab:'));
}

describe('Task 20: die Meldung ist verständlich und wird nicht zum Dauerton', () => {
  beforeEach(() => {
    (Notice as any).messages.length = 0;
  });

  it('nennt die Notiz, sagt was fehlt und was zu tun ist — ohne Fachjargon', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(FREMD_GROSS, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');
    vault._mdMtimes.set(NOTE, 10);

    const plugin = makePlugin(vault);
    await plugin.onload();
    // Der Weg, den der Wächter nimmt, wenn eine fremde Sync-Datei eintrifft.
    await remoteMerge(plugin, NOTE);
    plugin.onunload();

    const meldung = qollabMeldungen().find((m) => m.includes('Einkaufsliste'));
    expect(meldung).toBeDefined();
    for (const wort of ['CRDT', 'Inkarnation', 'GUID', 'Sidecar', 'Yjs', 'Tie-Break']) {
      expect(meldung).not.toContain(wort);
    }
    // Sagt, dass eine zweite Fassung existiert und hier nicht übernommen wurde.
    expect(meldung).toMatch(/zweite|getrennt/);
    expect(meldung).toMatch(/nicht (übernommen|uebernommen)/);
  });

  it('höchstens eine Meldung je Notiz und Sitzung', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, sidecar(OWN_GUID_GEWINNT, 'Milch\n'));
    vault._files.set(PEER_PATH, sidecar(FREMD_GROSS, 'Brot\n'));
    vault._textFiles.set(NOTE, 'Milch\n');
    vault._mdMtimes.set(NOTE, 10);

    const plugin = makePlugin(vault);
    await plugin.onload();
    await remoteMerge(plugin, NOTE);
    await remoteMerge(plugin, NOTE);
    plugin.onunload();

    const treffer = qollabMeldungen().filter((m) => m.includes('Einkaufsliste'));
    expect(treffer).toHaveLength(1);
  });

  it('viele betroffene Notizen ergeben eine Sammelmeldung statt einer Flut', async () => {
    const vault = makeVaultMock();
    // Ein frisch geteilter Vault: zehn Notizen, jede mit einer getrennt
    // entstandenen Fremd-Fassung. Ohne Deckelung wären das zehn Meldungen —
    // genau der Fall, den der Kommentar zur bestehenden Meldung fürchtet.
    for (let i = 0; i < 10; i++) {
      const note = `Notiz-${i}.md`;
      const own = `.qollab/${note}.${OWN_ID}.yjs`;
      const peer = `.qollab/${note}.00000001.yjs`;
      const mgrOwn = new CrdtManager();
      mgrOwn.setContent(note, 'lokal\n');
      const mgrPeer = new CrdtManager();
      mgrPeer.setContent(note, 'fremd\n');
      vault._files.set(own, toAB(encodeStateFile(OWN_GUID_GEWINNT, mgrOwn.encodeState(note))));
      vault._files.set(peer, toAB(encodeStateFile(FREMD_GROSS, mgrPeer.encodeState(note))));
      vault._textFiles.set(note, 'lokal\n');
      vault._mdMtimes.set(note, 10);
    }

    const plugin = makePlugin(vault);
    await plugin.onload();
    for (let i = 0; i < 10; i++) await remoteMerge(plugin, `Notiz-${i}.md`);
    plugin.onunload();

    const treffer = qollabMeldungen().filter((m) => /zweite|getrennt|weitere/.test(m));
    // Einzelmeldungen sind gedeckelt, der Rest kommt gesammelt.
    expect(treffer.length).toBeLessThanOrEqual(4);
    expect(treffer.some((m) => /weitere/.test(m))).toBe(true);
  });
});
