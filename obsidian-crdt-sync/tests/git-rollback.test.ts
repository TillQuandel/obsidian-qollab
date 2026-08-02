// R3-F3 — `git checkout` datiert die Notiz vor und setzt ihren Inhalt zurück.
//
// Diese Suite hält die MESSUNG zu dem Fund fest, nicht einen Fix: der Fund ist als
// Fehlerklasse nicht behebbar, weil Rollback und legitime Offline-Löschung am
// Dateisystem denselben Zustand hinterlassen. Die drei Fälle unten sind die
// Beweisführung dafür und zugleich das Netz gegen den naheliegenden Fehl-Fix.
//
// Gemessen (Git for Windows, eigener Probelauf, C:\tmp):
//
//   K) `*.yjs` liegt IM Repo — die vom README verlangte Konfiguration
//      (§„Mit GitHub teilen": „Stellt sicher dass *.yjs NICHT in .gitignore
//      steht"). `git checkout <branch>` stellt den GANZEN Arbeitsbaum des
//      Zielcommits her: gemessen `note.md` 20:51:39.976 / `.qollab/note.yjs`
//      20:51:39.974 — beide zurückgesetzt, die Hilfsdatei rund 2 ms früher, weil
//      Git in Index-Reihenfolge schreibt und `.qollab/` vor jedem Notenpfad
//      sortiert ('.' = 0x2E). Das Paar ist also konsistent, und genau deshalb
//      entsteht keine Löschung.
//
//   I) Nur die `.md` geht zurück, die Hilfsdatei bleibt auf dem neueren Stand:
//      `git checkout <rev> -- note.md`, `git restore note.md`, obsidian-git
//      „Discard" auf eine einzelne Datei — oder `.qollab` in `.gitignore`
//      (ausdrücklich gegen das README). Hier entsteht die Löschung und wandert
//      zum Peer.
//
//   G) Derselbe Dateizustand wie I), nur als bewusste Löschung in einem externen
//      Editor bei geschlossener App. Er MUSS zum Peer wandern.
//
// I) und G) bauen bitweise dieselbe Lage. Kein Signal im Dateisystem trennt sie;
// die Git-Spur trennt sie ebenfalls nicht: `git checkout <rev> -- <pfad>` und
// `git restore <pfad>` schreiben KEINE reflog-Zeile (gemessen: letzte Zeile blieb
// `commit: v2`), ihre einzige Spur ist eine `.git/index`-mtime rund 1 ms nach der
// Notiz — dieselbe Signatur, die ein `git add` nach einem echten Offline-Edit
// hinterlässt (gemessen 171 ms). Die Operationen, die eine eindeutige reflog-Zeile
// hinterlassen (`checkout: moving from …`, `merge …`, `reset: moving to …`), sind
// genau die aus Fall K) — die also gar keinen Schaden anrichten.
//
// Wer hier einen Rollback-Erkenner einbaut, macht I) grün und G) rot. G) ist die
// Zusage, die nicht fallen darf.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, type VaultMock } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'aaaa1111';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;

const V1 = 'Zeile A\nZeile B\n';
const V2 = 'Zeile A\nZeile B\nABSATZ-P\n';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

// Ein Gerät über den echten onload-Pfad. Jeder Aufruf ist ein FRISCHER Prozess:
// neuer CrdtManager, leere `localDiffBase`, leerer Sweep-Merker — die Bedingung,
// unter der `chooseLocalDiffBase` auf `docBeforeMerge` zurückfällt.
async function bootDevice(vault: VaultMock): Promise<{
  plugin: any;
  handlers: Map<string, (...args: any[]) => any>;
}> {
  const storage = makeLocalStorage();
  storage.saveLocalStorage('qollab-client-id', OWN_ID);
  const handlers = new Map<string, (...args: any[]) => any>();
  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
  const plugin = new (CrdtSyncPlugin as any)(
    {
      vault: vaultWithEvents,
      workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
      loadLocalStorage: storage.loadLocalStorage,
      saveLocalStorage: storage.saveLocalStorage,
    },
    {}
  );
  plugin._data = { enabled: true, statusNotice: false, tombstones: {} };
  await plugin.onload();
  return { plugin, handlers };
}

async function type(
  vault: VaultMock,
  handlers: Map<string, (...args: any[]) => any>,
  text: string
): Promise<void> {
  vault._textFiles.set(NOTE, text);
  vault._mdMtimes.set(NOTE, (vault._mdMtimes.get(NOTE) ?? 0) + 1);
  await handlers.get('modify')!(tfile(NOTE));
}

// Was ein Peer sieht, der unsere Historie kennt und danach unsere Hilfsdatei
// zieht: trägt sie eine Delete-Op, verschwindet der Absatz auch dort. Das ist die
// Schadensfrage des Fundes — nicht, was lokal in der Datei steht.
function peerSieht(vorher: ArrayBuffer, nachher: ArrayBuffer): string {
  const peer = new CrdtManager();
  peer.applyUpdate(NOTE, decodeStateFile(new Uint8Array(vorher)).update);
  peer.applyUpdate(NOTE, decodeStateFile(new Uint8Array(nachher)).update);
  return peer.getContent(NOTE);
}

// Sitzung 1: V1 erfassen, dann V2 tippen. Liefert beide Hilfsdatei-Stände — genau
// die zwei Fassungen, die in einem Repo als zwei Commits lägen.
async function sitzung1(vault: VaultMock): Promise<{ s1: ArrayBuffer; s2: ArrayBuffer }> {
  vault._textFiles.set(NOTE, V1);
  vault._mdMtimes.set(NOTE, 1);
  const { handlers } = await bootDevice(vault);
  await type(vault, handlers, V1);
  const s1 = vault._files.get(OWN_PATH)!.slice(0);
  await type(vault, handlers, V2);
  const s2 = vault._files.get(OWN_PATH)!.slice(0);
  return { s1, s2 };
}

// Der Zustand nach dem Rollback, aus dem Blickwinkel eines frisch gestarteten
// Obsidian: die .md trägt V1 mit NEUER mtime, die Hilfsdatei ihre alte.
function rollbackDerMd(vault: VaultMock): void {
  vault._textFiles.set(NOTE, V1);
  vault._mdMtimes.set(NOTE, 999);
}

describe('R3-F3: git-Rollback bei geschlossener App', () => {
  it('K) Hilfsdatei im Repo: der Checkout stellt ein konsistentes Paar her — keine Löschung entsteht', async () => {
    const vault = makeVaultMock();
    const { s1, s2 } = await sitzung1(vault);
    expect(peerSieht(s2, s2)).toBe(V2);

    // Git schreibt beide Dateien des Zielcommits, `.qollab/` zuerst.
    vault._files.set(OWN_PATH, s1);
    vault._mtimes.set(OWN_PATH, 998);
    rollbackDerMd(vault);

    const { plugin } = await bootDevice(vault);
    await plugin.snapshotStaleMarkdownFiles();

    // Unsere Hilfsdatei kannte ABSATZ-P nie und trägt darum auch keine Delete-Op:
    // der Peer behält den Absatz.
    //
    // EHRLICHES ETIKETT (Lehre aus R3-F10): Das ist eine MESSUNG der Reichweite,
    // kein unterscheidender Test. Er ist doppelt abgesichert — der Kurzschluss
    // `content === mergedText` greift, und selbst ohne ihn wären Basis, Inhalt
    // und gemergter Stand hier alle V1. Gemessen bleibt er unter beiden geprüften
    // Mutationen grün (naiver Rollback-Erkenner; `content === mergedText`
    // ausgehängt). Sein Wert liegt darin, festzuhalten, dass der Fund in der vom
    // README verlangten Konfiguration NICHT auftritt.
    expect(peerSieht(s2, vault._files.get(OWN_PATH)!)).toContain('ABSATZ-P');
  });

  it('I) bekannte Grenze: nur die .md zurückgesetzt — die Löschung geht zum Peer', async () => {
    const vault = makeVaultMock();
    const { s2 } = await sitzung1(vault);

    rollbackDerMd(vault);

    const { plugin } = await bootDevice(vault);
    await plugin.snapshotStaleMarkdownFiles();

    // Festgehaltenes IST, kein Soll: `chooseLocalDiffBase` nimmt im frischen
    // Prozess `docBeforeMerge` (den vollen Stand aus der Hilfsdatei) als Basis,
    // `threeWayMerge` macht daraus das Delta „lösche, was die .md nicht hat",
    // `saveState` schreibt es, der Sync trägt es weiter.
    //
    // Nicht behebbar ohne G) zu brechen — siehe Kopfkommentar.
    expect(peerSieht(s2, vault._files.get(OWN_PATH)!)).not.toContain('ABSATZ-P');
  });

  it('G) Zusage: dieselbe Lage als echter Offline-Edit muss beim Peer ankommen', async () => {
    const vault = makeVaultMock();
    const { s2 } = await sitzung1(vault);

    // Bitweise identisch zu I) — hier hat die Nutzerin den Absatz bei
    // geschlossener App in einem externen Editor gelöscht.
    //
    // Unterscheidungskraft, gemessen: Baut man den naheliegenden Fix ein (auf dem
    // ersten Kontakt im Prozess eine reine Löschung als Rollback werten und den
    // lokalen Diff überspringen), wird dieser Test rot — und die 331 Tests, die
    // es vor dieser Suite gab, bleiben ALLE grün. Vor dieser Zeile hätte der
    // Fehl-Fix die volle Suite passiert und einen stillen Verlust ausgeliefert.
    rollbackDerMd(vault);

    const { plugin } = await bootDevice(vault);
    await plugin.snapshotStaleMarkdownFiles();

    expect(peerSieht(s2, vault._files.get(OWN_PATH)!)).not.toContain('ABSATZ-P');
  });
});
