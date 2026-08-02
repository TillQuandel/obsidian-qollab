// Szenariosuche 2026-08-02 — Umbenennung WÄHREND des Write-Backs.
//
// Dritte Instanz derselben Klasse: Obsidian mutiert `TFile.path` beim Umbenennen
// IN PLACE. `writeBackMerged` hält den Pfad für den Schreib-Guard bereits einmal
// fest (`bewachterPfad`), liest ihn danach aber NACH dem `await vault.process(…)`
// erneut — einmal für `noteLocalDiffBase(file.path, merged)` und einmal für den
// Dateinamen in der Meldung. Fällt eine Umbenennung in das Schreibfenster (der
// Auto-Note-Mover reagiert auf genau diesen Write), liegen Guard und Diff-Basis
// auf zwei verschiedenen Pfaden: bewacht wurde a.md, gemerkt wird b.md.
//
// Was hier NICHT behauptet wird: eine reproduzierte Textverdopplung. Der
// rename-Handler zieht `localDiffBase` unmittelbar danach von a.md nach b.md um
// und überschreibt den falsch gesetzten Eintrag wieder — in den heute
// erreichbaren Reihenfolgen bleibt der Endzustand derselbe. Gepinnt wird die
// Zusage, die der behobene modify-Fall für den ganzen Ablauf aufgestellt hat:
// EIN Pfad pro Lauf. Ein Lauf, der Zustand unter einem Pfad schreibt, dessen
// Warteschlangen-Schlüssel er nie gehalten und dessen Schreib-Guard er nie
// gesetzt hat, ist genau die Konstellation, aus der die belegte Verdopplung im
// modify-Handler entstanden ist.

import { Notice, TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { makeVaultMock, makeLocalStorage, VaultMock } from './helpers/vault-mock';

const ALT = 'a.md';
const NEU = 'b.md';
const TEXT = 'Zeile 1\nZeile 2\n';
const GEMERGT = 'Zeile 1\nZeile 2\nZeile 3 FREMD\n';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

async function loadPlugin(vault: VaultMock) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
  const storage = makeLocalStorage();
  const app = {
    vault: vaultWithEvents,
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin: any = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin, handlers };
}

// Der Write benennt um — dasselbe TFile-Objekt, nur mit geändertem `path`.
// Nachgebildet wird die Reihenfolge in Obsidian: erst schreibt `process`, dann
// zieht das umbenennende Plugin nach.
function umbenennenBeimSchreiben(vault: VaultMock): { geschehen: () => boolean } {
  const echtesProcess = vault.process;
  let geschehen = false;
  vault.process = async (file: { path: string }, fn: (data: string) => string) => {
    const out = await echtesProcess(file, fn);
    if (!geschehen && file.path === ALT) {
      geschehen = true;
      const inhalt = vault._textFiles.get(ALT) ?? '';
      vault._textFiles.delete(ALT);
      vault._textFiles.set(NEU, inhalt);
      (file as TFile).path = NEU;
      (file as TFile).name = NEU;
    }
    return out;
  };
  return { geschehen: () => geschehen };
}

describe('Umbenennung während des Write-Backs', () => {
  beforeEach(() => {
    (Notice as any).messages = [];
  });

  it('schreibt keinen Zustand unter einen Pfad, den der Lauf nie bewacht hat', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(ALT, TEXT);
    const { plugin } = await loadPlugin(vault);

    // Lebender Stand unter a.md, damit `localDiffBase` überhaupt eine Bedeutung hat.
    await plugin.pathQueue.run(ALT, () => plugin.syncHandler.applyLocalContent(ALT, TEXT));

    const datei = tfile(ALT);
    const um = umbenennenBeimSchreiben(vault);
    const basisSpy = jest.spyOn(plugin.syncHandler, 'noteLocalDiffBase');

    // Genau der Aufruf, den modify-Handler und Sweep innerhalb der
    // Warteschlange für a.md absetzen.
    await plugin.pathQueue.run(ALT, () => plugin.writeBackMerged(datei, TEXT, GEMERGT));
    expect(um.geschehen()).toBe(true);

    // Der Lauf bewacht a.md — unter b.md hat er nichts zu suchen. Weicht der
    // Pfad ab, wird abgebrochen: der rename-Handler zieht Basis und Zustand
    // ohnehin um, und der nächste Trigger läuft sauber unter dem neuen Pfad.
    const pfade = basisSpy.mock.calls.map((c: any[]) => c[0]);
    expect(pfade).not.toContain(NEU);
    expect(basisSpy).not.toHaveBeenCalled();
    basisSpy.mockRestore();

    // Dieselbe Regel für die Meldung: sie nennt sonst einen Namen, unter dem
    // dieser Lauf nie gearbeitet hat.
    expect((Notice as any).messages.filter((m: string) => m.includes(NEU))).toEqual([]);
  });

  // Kontrolle: ohne Umbenennung bleibt der Write-Back unverändert — Basis wird
  // gesetzt, Datei geschrieben, Meldung erscheint.
  it('Kontrolle: ohne Umbenennung wird die Basis wie bisher gesetzt', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(ALT, TEXT);
    const { plugin } = await loadPlugin(vault);

    await plugin.pathQueue.run(ALT, () => plugin.syncHandler.applyLocalContent(ALT, TEXT));

    const datei = tfile(ALT);
    const basisSpy = jest.spyOn(plugin.syncHandler, 'noteLocalDiffBase');
    await plugin.pathQueue.run(ALT, () => plugin.writeBackMerged(datei, TEXT, GEMERGT));

    expect(basisSpy).toHaveBeenCalledWith(ALT, GEMERGT);
    basisSpy.mockRestore();
    expect(vault._textFiles.get(ALT)).toBe(GEMERGT);
    expect((Notice as any).messages.filter((m: string) => m.includes(ALT)).length).toBe(1);
  });
});
