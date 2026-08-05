// Szenariosuche 2026-08-02 — Umbenennung WÄHREND eines laufenden modify-Laufs.
//
// Obsidian mutiert `TFile.path` beim Umbenennen IN PLACE: der rename-Handler
// bekommt `(file, oldPath)` und liest den NEUEN Pfad aus `file.path` — es ist
// dasselbe Objekt, nur mit geändertem Feld. Der modify-Handler las `file.path`
// deshalb zweimal zu verschiedenen Zeitpunkten: einmal als Warteschlangen-
// Schlüssel und im Rumpf erneut als Arbeitspfad. Dazwischen liegen die Wartezeit
// in der Warteschlange UND der `vault.read`.
//
// Benennt in diesem Fenster etwas die Notiz um — Auto-Note-Mover reagiert auf
// Frontmatter/Tags, beide Abläufe entspringen also demselben Schreibvorgang —,
// dann hält der Task den Schlüssel des ALTEN Pfades und arbeitet auf dem NEUEN.
// Unter dem neuen Pfad gibt es weder Doc noch Hilfsdatei (beide liegen noch am
// alten), also prägt `ensureDoc` eine FRISCHE GUID über einer lebenden Historie
// und baut den Doc aus dem `.md`-Text neu auf. Der rename-Task zieht danach die
// echte Historie auf denselben Pfad und setzt die alte GUID zurück; der Doc im
// Speicher bleibt der frisch geprägte. Beim nächsten Abgleich gilt die eigene
// Hilfsdatei als kompatibel (gleiche GUID) und wird angewandt — Yjs dedupliziert
// nach Item-ID, nicht nach Inhalt: der ganze Notiztext steht doppelt, ohne jede
// Meldung.
//
// Der Mock bildet exakt das ab: `vault.read` setzt beim Auflösen `file.path` von
// a.md auf b.md um und verschiebt den Dateiinhalt mit.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { decodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, tippeMd, VaultMock } from './helpers/vault-mock';

const ALT = 'a.md';
const NEU = 'b.md';
const TEXT = 'Zeile 1\nZeile 2\nZeile 3\n';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

function makeApp(vault: VaultMock) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
  const workspace = {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set('ws:' + event, cb);
      return { __event: 'ws:' + event };
    },
    offref: () => {},
    onLayoutReady: () => {}, // Sweep bewusst NICHT starten
  };
  const storage = makeLocalStorage();
  const app = {
    vault: vaultWithEvents,
    workspace,
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  return { app, handlers };
}

async function loadPlugin(vault: VaultMock) {
  const { app, handlers } = makeApp(vault);
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin, handlers };
}

const sidecarOf = (plugin: any, notePath: string) => `.qollab/${notePath}.${plugin.clientId}.yjs`;

function guidOf(vault: VaultMock, path: string): string | null {
  const buf = vault._files.get(path);
  if (!buf) return null;
  return decodeStateFile(new Uint8Array(buf)).guid;
}

const zaehle = (text: string, nadel: string) => text.split(nadel).length - 1;

describe('Umbenennung während eines laufenden modify-Laufs', () => {
  it('prägt unter dem neuen Pfad keine zweite Inkarnation und verdoppelt den Text nicht', async () => {
    const vault = makeVaultMock();

    const { plugin, handlers } = await loadPlugin(vault);
    const datei = tfile(ALT);

    // 1) Regulärer Edit → lebende Historie unter a.md (eigene Hilfsdatei + GUID).
    //    Prozessintern geschrieben: ein Tastendruck, kein geliefertes Fremd-.md.
    await tippeMd(vault, ALT, TEXT);
    await handlers.get('modify')!(datei);
    const echteGuid = guidOf(vault, sidecarOf(plugin, ALT));
    expect(echteGuid).not.toBeNull();

    // 2) Der nächste `vault.read` benennt um — wie Obsidian: dasselbe TFile-Objekt,
    //    nur mit geändertem `path`; der Dateiinhalt wandert mit.
    let umbenannt = false;
    const echtesRead = vault.read;
    vault.read = async (file: { path: string }) => {
      const inhalt = await echtesRead(file);
      if (!umbenannt && file.path === ALT) {
        umbenannt = true;
        vault._textFiles.delete(ALT);
        vault._textFiles.set(NEU, inhalt);
        (file as TFile).path = NEU;
        (file as TFile).name = NEU;
      }
      return inhalt;
    };

    // 3) Zweiter modify-Lauf. Er startet auf a.md und findet im Rumpf b.md vor.
    const applySpy = jest.spyOn(plugin.syncHandler, 'applyLocalContent');
    await handlers.get('modify')!(datei);

    // Der Lauf muss ABBRECHEN, statt unter dem falschen Schlüssel zu arbeiten.
    // Beide Alternativen sind falsch: der neue Pfad ist nicht durch die
    // Warteschlange gedeckt, und der alte beschreibt eine Datei, die dort nicht
    // mehr liegt — der Write-Back darunter liefe über das TFile-Objekt gegen den
    // NEUEN Pfad und setzte Diff-Basis und Schreib-Guard auf zwei verschiedene
    // Pfade. Der rename-Handler zieht Sidecars und Zustand ohnehin um.
    expect(applySpy).not.toHaveBeenCalled();
    applySpy.mockRestore();

    // Kern: unter b.md darf keine Hilfsdatei mit ABWEICHENDER GUID entstehen. Die
    // Hilfsdatei der lebenden Inkarnation liegt zu diesem Zeitpunkt noch am alten
    // Pfad — der rename-Handler zieht sie erst gleich um.
    const fruehGuid = guidOf(vault, sidecarOf(plugin, NEU));
    expect(fruehGuid).toBeNull();

    // 4) Der rename-Handler holt nach: Hilfsdateien umziehen, GUID umhängen.
    await handlers.get('rename')!(datei, ALT);
    expect(guidOf(vault, sidecarOf(plugin, NEU))).toBe(echteGuid);

    // 5) Nächster Abgleich (das, was der Watcher-Poll aufruft).
    await plugin.pathQueue.run(NEU, () => plugin.onRemoteYjsUpdate(NEU));

    // Der Notiztext steht genau einmal da — in der Datei UND im CRDT.
    expect(zaehle(vault._textFiles.get(NEU) ?? '', 'Zeile 1')).toBe(1);
    expect(zaehle(plugin.crdtManager.getContent(NEU), 'Zeile 1')).toBe(1);
    expect(vault._textFiles.get(NEU)).toBe(TEXT);
  });

  // Kontrolle: der Normalfall darf sich nicht ändern. Ohne Umbenennung erfasst der
  // modify-Handler den Edit wie bisher.
  it('Kontrolle: modify ohne Umbenennung erfasst den Edit wie bisher', async () => {
    const vault = makeVaultMock();

    const { plugin, handlers } = await loadPlugin(vault);
    const datei = tfile(ALT);

    await tippeMd(vault, ALT, TEXT);
    await handlers.get('modify')!(datei);
    expect(vault._files.has(sidecarOf(plugin, ALT))).toBe(true);
    expect(plugin.crdtManager.getContent(ALT)).toBe(TEXT);

    const TEXT2 = TEXT + 'Zeile 4\n';
    await tippeMd(vault, ALT, TEXT2);
    await handlers.get('modify')!(datei);

    expect(plugin.crdtManager.getContent(ALT)).toBe(TEXT2);
    expect(vault._textFiles.get(ALT)).toBe(TEXT2);
    expect(guidOf(vault, sidecarOf(plugin, ALT))).not.toBeNull();
  });
});
