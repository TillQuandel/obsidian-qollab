// Testlücke aus der Mutationsmessung (Runde 3): Löschungen von Notizen in
// UNTERORDNERN waren praktisch ungedeckt.
//
// Jeder Delete-Test der Suite (main-handlers, tombstone-scope, tombstone-wipe,
// enabled-off-switch, device-settings-scope, profile-loss, concurrency) benutzt
// eine Notiz in der VAULT-WURZEL. Dort ist `dirname(file.path)` leer, und der
// ganze R3-F4-Zweig (`folderGone`) wird gar nicht erst ausgewertet:
//
//     const folder = dirname(file.path);
//     const folderGone = folder ? !(await sidecarExists(adapter, folder)) : false;
//
// Die einzige Ausnahme ist `selective-sync-delete.test.ts` — eine eigens für
// R3-F4 gebaute Gegenprobe mit genau EINER Ordnerebene und ohne eigenen Stand.
// Damit hängt die gesamte Unterordner-Deckung an einem Test, der für eine andere
// Frage geschrieben wurde: Wer ihn umbaut, entfernt sie vollständig.
//
// Bewacht werden hier drei Mechanismen, die es nur mit Unterordner gibt:
//   1. der Normalpfad (eigene GUID, voller Pfad im Tombstone-Schlüssel, Aufräumen
//      der Hilfsdateien unter `.qollab/<ordner>/`), abgegrenzt gegen eine
//      GLEICHNAMIGE Notiz an einem anderen Ort;
//   2. `dirname` als Kriterium — geprüft wird der Ordner DER NOTIZ, nicht
//      irgendein Vorfahr. Ab zwei Ebenen fallen die beiden auseinander;
//   3. die Pfad-Historie über einen Ordner-Umzug hinweg.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, VaultMock } from './helpers/vault-mock';

const G = 'ee'.repeat(16);
const PEER_ID = 'deadbeef';

const ORDNER = 'Projekte/2026';
const NOTE = `${ORDNER}/note.md`;
const NACHBAR = `${ORDNER}/andere.md`;
// Gleicher DATEINAME, anderer Ort: eine Notiz in der Vault-Wurzel. Wer den
// Handler auf `file.name` statt `file.path` verdrahtet, räumt sie mit ab — und
// keiner der bestehenden Delete-Tests kann das sehen, weil dort Name und Pfad
// dasselbe sind.
const GLEICHNAMIG = 'note.md';
const TEXT = 'inhalt der note\n';

function buildSidecar(guid: string, text: string, docKey: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(docKey, text);
  const buf = encodeStateFile(guid, mgr.encodeState(docKey));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  f.stat = { mtime: 0, ctime: 0, size: 0 };
  return f;
}

async function bootPlugin(vault: VaultMock) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const storage = makeLocalStorage();
  const app = {
    vault: {
      ...vault,
      on: (event: string, cb: (...args: any[]) => any) => {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref: () => {},
    },
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin: plugin as any, handlers };
}

// --------------------------------------------------------------------------
// 1. Der Normalfall: eine einzelne Notiz in einem Unterordner wird gelöscht,
//    der Ordner bleibt (eine Nachbar-Notiz liegt darin).
// --------------------------------------------------------------------------
describe('Unterordner: eine einzeln gelöschte Notiz wird vollständig abgeräumt', () => {
  async function setup() {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;
    const OWN_SIDECAR = `.qollab/${NOTE}.${OWN_ID}.yjs`;
    const PEER_SIDECAR = `.qollab/${NOTE}.${PEER_ID}.yjs`;
    const WURZEL_SIDECAR = `.qollab/${GLEICHNAMIG}.${OWN_ID}.yjs`;

    vault._textFiles.set(NACHBAR, 'hält den Ordner am Leben\n'); // Ordner überlebt
    vault._textFiles.set(NOTE, TEXT);
    vault._textFiles.set(GLEICHNAMIG, 'unbeteiligt\n');
    vault._files.set(OWN_SIDECAR, buildSidecar(G, TEXT, NOTE));
    vault._files.set(PEER_SIDECAR, buildSidecar(G, TEXT, NOTE));
    vault._files.set(WURZEL_SIDECAR, buildSidecar(G, 'unbeteiligt\n', GLEICHNAMIG));

    vault._textFiles.delete(NOTE);
    expect(await vault.adapter.exists(ORDNER)).toBe(true);
    await handlers.get('delete')!(tfile(NOTE));

    return { vault, plugin, OWN_SIDECAR, PEER_SIDECAR, WURZEL_SIDECAR };
  }

  it('der Tombstone trägt den VOLLEN Pfad, nicht den Dateinamen', async () => {
    const { plugin } = await setup();
    expect(Object.keys(plugin.settings.tombstones)).toEqual([`${NOTE}\0${G}`]);
  });

  it('die Hilfsdateien unter .qollab/<ordner>/ sind weg', async () => {
    const { vault, OWN_SIDECAR, PEER_SIDECAR } = await setup();
    expect(vault._files.has(OWN_SIDECAR)).toBe(false);
    expect(vault._files.has(PEER_SIDECAR)).toBe(false);
  });

  it('die gleichnamige Notiz an einem ANDEREN Ort behält ihre Hilfsdatei', async () => {
    const { vault, WURZEL_SIDECAR } = await setup();
    expect(vault._files.has(WURZEL_SIDECAR)).toBe(true);
    expect(vault._textFiles.get(GLEICHNAMIG)).toBe('unbeteiligt\n');
  });

  it('eine gleichnamig neu angelegte Notiz erbt die tote Inkarnation nicht', async () => {
    const { vault, plugin } = await setup();
    // Das andere Gerät liefert die Hilfsdatei der toten Inkarnation verspätet nach.
    vault._files.set(`.qollab/${NOTE}.${PEER_ID}.yjs`, buildSidecar(G, TEXT, NOTE));
    vault._textFiles.set(NOTE, 'brandneu\n');

    await plugin.onRemoteYjsUpdate(NOTE);

    expect(vault._textFiles.get(NOTE)).toBe('brandneu\n');
  });
});

// --------------------------------------------------------------------------
// 2. Das Kriterium ist der Ordner DER NOTIZ. Ab zwei Ebenen unterscheidbar:
//    der selektive Sync nimmt `Projekte/2026` von der Platte, `Projekte` bleibt
//    (dort liegen andere Jahrgänge). Wer stattdessen einen Vorfahren prüft,
//    hält den Ordner für vorhanden und richtet exakt den R3-F4-Schaden an —
//    Tombstone auf eine lebende Inkarnation, Löschung der Peer-Hilfsdatei, die
//    der Datei-Sync dorthin zurückträgt.
// --------------------------------------------------------------------------
describe('Unterordner: verschwindet der Ordner der Notiz, bleibt alles liegen', () => {
  async function setup() {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;
    const OWN_SIDECAR = `.qollab/${NOTE}.${OWN_ID}.yjs`;
    const PEER_SIDECAR = `.qollab/${NOTE}.${PEER_ID}.yjs`;

    // Der übergeordnete Ordner bleibt bestehen (anderer Jahrgang).
    vault._textFiles.set('Projekte/2025/alt.md', 'bleibt liegen\n');
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_SIDECAR, buildSidecar(G, TEXT, NOTE));
    vault._files.set(PEER_SIDECAR, buildSidecar(G, TEXT, NOTE));

    // Selective Sync nimmt genau `Projekte/2026` von der Platte.
    vault._textFiles.delete(NOTE);
    expect(await vault.adapter.exists('Projekte')).toBe(true);
    expect(await vault.adapter.exists(ORDNER)).toBe(false);

    await handlers.get('delete')!(tfile(NOTE));
    return { vault, plugin, OWN_SIDECAR, PEER_SIDECAR };
  }

  it('kein Tombstone auf die lebende Inkarnation', async () => {
    const { plugin } = await setup();
    expect(plugin.settings.tombstones).toEqual({});
  });

  it('beide Hilfsdateien überleben (der Sync trüge die Löschung zum anderen Gerät)', async () => {
    const { vault, OWN_SIDECAR, PEER_SIDECAR } = await setup();
    expect(vault._files.has(OWN_SIDECAR)).toBe(true);
    expect(vault._files.has(PEER_SIDECAR)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 3. Ordner-Umzug: dieselbe Inkarnation hat unter zwei Pfaden gelebt. Wird sie
//    danach gelöscht, muss die Pfad-Historie mitbeerdigt werden — sonst gilt
//    eine verspätete Fremd-Hilfsdatei unter dem ALTEN Ordner als lebendig.
//    Die Rename-Historie ist bisher nur innerhalb der Wurzel getestet.
// --------------------------------------------------------------------------
describe('Unterordner: eine über Ordnergrenzen verschobene Notiz wird unter beiden Pfaden beerdigt', () => {
  const ALT = 'Entwurf/note.md';
  const NEU = 'Fertig/note.md';

  it('delete tombstont den alten UND den neuen Pfad', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    // Die Inkarnation lebt zunächst unter Entwurf/.
    vault._textFiles.set(ALT, TEXT);
    vault._files.set(`.qollab/${ALT}.${OWN_ID}.yjs`, buildSidecar(G, TEXT, ALT));
    await plugin.syncHandler.loadAndMerge(ALT);
    expect(await plugin.syncHandler.currentGuid(ALT)).toBe(G);

    // Umzug nach Fertig/ (Dateien und Hilfsdateien ziehen mit; der Handler-Pfad
    // dafür ist nicht Gegenstand dieses Tests).
    vault._textFiles.delete(ALT);
    vault._textFiles.set(NEU, TEXT);
    vault._files.set(`.qollab/${NEU}.${OWN_ID}.yjs`, vault._files.get(`.qollab/${ALT}.${OWN_ID}.yjs`)!);
    vault._files.delete(`.qollab/${ALT}.${OWN_ID}.yjs`);
    plugin.syncHandler.renameNote(ALT, NEU);

    // Eine zweite Notiz hält den Zielordner am Leben, sonst greift R3-F4.
    vault._textFiles.set('Fertig/andere.md', 'bleibt\n');
    vault._textFiles.delete(NEU);
    await handlers.get('delete')!(tfile(NEU));

    expect(Object.keys(plugin.settings.tombstones).sort()).toEqual(
      [`${ALT}\0${G}`, `${NEU}\0${G}`].sort()
    );
  });
});
