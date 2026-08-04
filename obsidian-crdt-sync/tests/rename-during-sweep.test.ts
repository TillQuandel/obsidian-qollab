// Szenariosuche 2026-08-02 — Umbenennung WÄHREND des Startup-Sweeps.
//
// Dieselbe Fehlerklasse wie in `rename-during-modify.test.ts`, nur breiter:
// Obsidian mutiert `TFile.path` beim Umbenennen IN PLACE, und der Vault-Index
// gibt bei jedem `getMarkdownFiles()` DIESELBEN TFile-Objekte zurück. Der Sweep
// liest `file.path` an rund sieben Stellen über drei `await`-Grenzen hinweg
// (`statSidecar`, `hasAdoptableGuid`, Warteschlangen-Schlüssel, `vault.read`).
// Fällt eine Umbenennung in eines dieser Fenster, entscheidet der Sweep auf der
// Grundlage des ALTEN Pfades und arbeitet auf dem NEUEN.
//
// Erreichbar ist das auf zwei Wegen, die beide zum Startzeitpunkt zusammenfallen:
// Der Sweep schreibt über `writeBackMerged` selbst `.md`-Dateien und löst damit
// umbenennende Plugins aus (Auto-Note-Mover reagiert auf Frontmatter/Tags), und
// er läuft bei 1600+ Notes lange genug, dass eine Umbenennung von außen (Nutzer,
// Datei-Sync, anderes Plugin) in eines seiner IO-Fenster fällt.
//
// Der Schaden ist derselbe wie im behobenen modify-Fall: Unter dem neuen Pfad
// gibt es weder Doc noch Hilfsdatei (beide liegen noch am alten), also prägt
// `ensureDoc` eine FRISCHE GUID über einer lebenden Historie. Der rename-Handler
// zieht danach die echte Historie auf denselben Pfad; der Doc im Speicher bleibt
// der frisch geprägte. Beim nächsten Abgleich gilt die eigene Hilfsdatei als
// kompatibel (gleiche GUID) und wird angewandt — Yjs dedupliziert nach Item-ID,
// nicht nach Inhalt: der ganze Notiztext steht doppelt, ohne jede Meldung.
//
// Die Mocks pinnen deshalb bewusst die TFile-Identität fest: `getMarkdownFiles()`
// gibt hier — wie in Obsidian — bei jedem Aufruf dieselben Objekte zurück. Der
// Vault-Mock baut sonst pro Aufruf frische, und genau diese Identität ist die
// Voraussetzung des Fehlers.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile, encodeStateFile } from '../src/state-file';
import {
  makeVaultMock,
  makeLocalStorage,
  tippeMd,
  toArrayBuffer,
  VaultMock,
} from './helpers/vault-mock';

const ALT = 'a.md';
const NEU = 'b.md';
const TEXT = 'Zeile 1\nZeile 2\nZeile 3\n';
const FREMD_ID = 'feed0001';
const FREMD_GUID = 'f'.repeat(32);

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
    onLayoutReady: () => {}, // Sweep wird im Test explizit gestartet
  };
  const storage = makeLocalStorage();
  const app = {
    vault: vaultWithEvents,
    workspace,
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  return { app, handlers, storage };
}

async function loadPlugin(vault: VaultMock) {
  const { app, handlers, storage } = makeApp(vault);
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin, handlers, storage };
}

const sidecarOf = (plugin: any, notePath: string) => `.qollab/${notePath}.${plugin.clientId}.yjs`;

function guidOf(vault: VaultMock, path: string): string | null {
  const buf = vault._files.get(path);
  if (!buf) return null;
  return decodeStateFile(new Uint8Array(buf)).guid;
}

const zaehle = (text: string, nadel: string) => text.split(nadel).length - 1;

// Obsidian-Identität nachbilden: derselbe TFile pro Note über alle Aufrufe.
function pinneIndex(vault: VaultMock): TFile[] {
  const dateien = vault.getMarkdownFiles();
  vault.getMarkdownFiles = () => dateien;
  return dateien;
}

// Die Umbenennung, wie Obsidian sie ausführt: dasselbe Objekt, nur mit
// geändertem `path`; der Dateiinhalt wandert mit, die Hilfsdatei bleibt vorerst
// liegen (der rename-Handler zieht sie erst danach nach).
function benenneUm(vault: VaultMock, datei: TFile): void {
  const inhalt = vault._textFiles.get(ALT) ?? '';
  vault._textFiles.delete(ALT);
  vault._textFiles.set(NEU, inhalt);
  vault._mdMtimes.set(NEU, vault._mdMtimes.get(ALT) ?? 0);
  vault._mdMtimes.delete(ALT);
  datei.path = NEU;
  datei.name = NEU;
}

// Ausgangslage für beide Fälle: lebende Historie unter a.md (eigene Hilfsdatei
// mit GUID), und die `.md` gilt danach als NEUER als der eigene Stand — genau
// der Fall, für den es den Sweep gibt (externer Edit bei geschlossener App).
async function lebendeHistorie(vault: VaultMock) {
  const geladen = await loadPlugin(vault);
  // Prozessintern getippt — die lebende Historie entsteht aus einem eigenen Edit,
  // nicht aus einer von aussen gelieferten Fassung.
  await tippeMd(vault, ALT, TEXT);
  await geladen.handlers.get('modify')!(tfile(ALT));
  const echteGuid = guidOf(vault, sidecarOf(geladen.plugin, ALT));
  expect(echteGuid).not.toBeNull();
  vault._mdMtimes.set(ALT, 9999);
  return { ...geladen, echteGuid };
}

describe('Umbenennung während des Startup-Sweeps', () => {
  it('prägt bei Umbenennung im vault.read-Fenster keine zweite Inkarnation', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers, echteGuid } = await lebendeHistorie(vault);

    // Der `vault.read` INNERHALB der Warteschlange benennt um. Damit hält der
    // Sweep den Schlüssel des alten Pfades und arbeitet auf dem neuen — exakt
    // die Konstellation des behobenen modify-Fehlers.
    const echtesRead = vault.read;
    let umbenannt = false;
    vault.read = async (file: { path: string }) => {
      const inhalt = await echtesRead(file);
      if (!umbenannt && file.path === ALT) {
        umbenannt = true;
        benenneUm(vault, file as TFile);
      }
      return inhalt;
    };

    const applySpy = jest.spyOn(plugin.syncHandler, 'applyLocalContent');
    await plugin.runStartupSweep();
    expect(umbenannt).toBe(true);

    // Der Lauf muss für diese Note ABBRECHEN. Beide Alternativen wären falsch:
    // der neue Pfad ist nicht durch die Warteschlange gedeckt, und unter dem
    // alten liegt die Datei nicht mehr.
    expect(applySpy).not.toHaveBeenCalled();
    applySpy.mockRestore();

    // Kern: unter b.md darf keine Hilfsdatei mit ABWEICHENDER GUID entstehen.
    expect(guidOf(vault, sidecarOf(plugin, NEU))).toBeNull();

    // Der rename-Handler holt nach: Hilfsdateien umziehen, GUID umhängen.
    await handlers.get('rename')!(tfile(NEU), ALT);
    expect(guidOf(vault, sidecarOf(plugin, NEU))).toBe(echteGuid);

    // Nächster Abgleich (das, was der Watcher-Poll aufruft).
    await plugin.pathQueue.run(NEU, () => plugin.onRemoteYjsUpdate(NEU));

    expect(zaehle(vault._textFiles.get(NEU) ?? '', 'Zeile 1')).toBe(1);
    expect(zaehle(plugin.crdtManager.getContent(NEU), 'Zeile 1')).toBe(1);
    expect(vault._textFiles.get(NEU)).toBe(TEXT);
  });

  it('prägt bei Umbenennung im Hilfsdatei-stat-Fenster keine zweite Inkarnation', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers, echteGuid } = await lebendeHistorie(vault);

    // Zweite `await`-Grenze, weit VOR der Warteschlange: Der Sweep bildet den
    // Hilfsdatei-Pfad aus dem alten Pfad, statet ihn — und beantwortet die Frage
    // „ist der eigene Stand aktuell?" danach für eine Note, die inzwischen
    // woanders liegt. Der Warteschlangen-Schlüssel ist hier sogar der neue Pfad;
    // falsch ist die ENTSCHEIDUNGSGRUNDLAGE, und das Ergebnis ist dasselbe:
    // ensureDoc prägt unter b.md eine frische GUID über der lebenden Historie.
    const dateien = pinneIndex(vault);
    const echterStat = vault.adapter.stat.bind(vault.adapter);
    let umbenannt = false;
    vault.adapter.stat = async (p: string) => {
      const s = await echterStat(p);
      if (!umbenannt && p === sidecarOf(plugin, ALT)) {
        umbenannt = true;
        benenneUm(vault, dateien[0]);
      }
      return s;
    };

    const applySpy = jest.spyOn(plugin.syncHandler, 'applyLocalContent');
    await plugin.runStartupSweep();
    expect(umbenannt).toBe(true);

    expect(applySpy).not.toHaveBeenCalled();
    applySpy.mockRestore();
    expect(guidOf(vault, sidecarOf(plugin, NEU))).toBeNull();

    await handlers.get('rename')!(dateien[0], ALT);
    expect(guidOf(vault, sidecarOf(plugin, NEU))).toBe(echteGuid);

    await plugin.pathQueue.run(NEU, () => plugin.onRemoteYjsUpdate(NEU));

    expect(zaehle(vault._textFiles.get(NEU) ?? '', 'Zeile 1')).toBe(1);
    expect(zaehle(plugin.crdtManager.getContent(NEU), 'Zeile 1')).toBe(1);
    expect(vault._textFiles.get(NEU)).toBe(TEXT);
  });

  it('prägt bei Umbenennung im Adoptions-Fenster keine zweite Inkarnation', async () => {
    // Dritte `await`-Grenze und der Fall, für den Task 13/B überhaupt existiert:
    // Note ohne eigenen Stand, aber mit adoptierbarer FREMDER Hilfsdatei — der
    // Zwei-Geräte-Rollout. Der Sweep beantwortet „gibt es etwas zu adoptieren?"
    // für den alten Pfad; unter dem neuen liegt die Fremd-Datei (noch) nicht, und
    // `ensureDoc` prägt dort eine frische Inkarnation statt zu adoptieren. Das ist
    // exakt das Split-Brain, das die Adoptionsfrage verhindern soll — nur eine
    // await-Grenze weiter hinten.
    const vault = makeVaultMock();
    const fremd = new CrdtManager();
    fremd.setContent(ALT, TEXT);
    vault._files.set(
      `.qollab/${ALT}.${FREMD_ID}.yjs`,
      toArrayBuffer(encodeStateFile(FREMD_GUID, fremd.encodeState(ALT)))
    );

    const { plugin, handlers } = await loadPlugin(vault);
    // Die Note selbst stammt aus diesem Prozess (nur die Hilfsdatei ist fremd).
    await tippeMd(vault, ALT, TEXT);
    const dateien = pinneIndex(vault);

    // `hasAdoptableGuid` listet das Sidecar-Verzeichnis — das ist die einzige
    // IO-Grenze dieses Aufrufs und damit das Umbenennungs-Fenster. (Der Sweep
    // erreicht `adapter.list` in dieser Ausgangslage sonst nicht: der eigene
    // Stand fehlt, also läuft davor nur ein `stat`.)
    const echtesListing = vault.adapter.list.bind(vault.adapter);
    let umbenannt = false;
    vault.adapter.list = async (dir: string) => {
      const out = await echtesListing(dir);
      if (!umbenannt) {
        umbenannt = true;
        benenneUm(vault, dateien[0]);
      }
      return out;
    };

    const applySpy = jest.spyOn(plugin.syncHandler, 'applyLocalContent');
    await plugin.runStartupSweep();
    expect(umbenannt).toBe(true);

    expect(applySpy).not.toHaveBeenCalled();
    applySpy.mockRestore();
    expect(guidOf(vault, sidecarOf(plugin, NEU))).toBeNull();

    // Nachdem der rename-Handler die Fremd-Datei nachgezogen hat, adoptiert der
    // nächste reguläre Lauf deren GUID — eine Inkarnation, kein Split-Brain.
    await handlers.get('rename')!(dateien[0], ALT);
    await handlers.get('modify')!(dateien[0]);
    expect(guidOf(vault, sidecarOf(plugin, NEU))).toBe(FREMD_GUID);
  });

  // Kontrolle: der Normalfall darf sich nicht ändern. Ohne Umbenennung erfasst
  // der Sweep den bei geschlossener App entstandenen Edit wie bisher.
  it('Kontrolle: Sweep ohne Umbenennung erfasst den externen Edit wie bisher', async () => {
    const vault = makeVaultMock();
    const { plugin, echteGuid } = await lebendeHistorie(vault);

    const EXTERN = TEXT + 'Von aussen ergaenzt\n';
    vault._textFiles.set(ALT, EXTERN);
    vault._mdMtimes.set(ALT, 10000);

    await plugin.runStartupSweep();

    expect(plugin.crdtManager.getContent(ALT)).toBe(EXTERN);
    // Gleiche Inkarnation wie vorher — der Sweep prägt nichts Neues.
    expect(guidOf(vault, sidecarOf(plugin, ALT))).toBe(echteGuid);
  });
});
