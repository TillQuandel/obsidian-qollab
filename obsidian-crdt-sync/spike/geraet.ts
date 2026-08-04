// Zwei-Geraete-Treiber gegen den ECHTEN SyncHandler.
//
// Kein Modell des Merge-Kerns: SyncHandler, CrdtManager, text-merge, sidecar-io und
// state-file sind unveraendert der Produktivcode. Nachgebaut ist ausschliesslich die
// Klammer aus main.ts, die im Test sonst fehlt:
//   - modify-Handler   (main.ts:271-295)
//   - writeBackMerged  (main.ts:875-940)
//   - onRemoteYjsUpdate(main.ts:1325-1482)
// jeweils ohne `unloaded`/`enabled`/`sweepRunning` (im Treiber immer an) und ohne
// PathQueue (der Treiber ist sequentiell, es gibt nichts zu serialisieren).

import { SyncHandler } from '../src/sync-handler';
import { WriteProvenance } from '../src/write-provenance';
import { CrdtManager } from '../src/crdt-manager';
import { threeWayMerge, unionMerge } from '../src/text-merge';
import { sidecarExists, listAllSidecars } from '../src/sidecar-io';
import { makeVaultMock } from '../tests/helpers/vault-mock';

export type Praegepolitik = (
  g: Geraet,
  notePath: string
) => Promise<boolean>; // true = pruegen/erfassen erlaubt, false = aufschieben

// Woher stammt der Inhalt, den ein modify-Ereignis vorfindet?
//
//   'nutzer' — dieser Prozess hat ihn geschrieben (Editor-Autosave, Kernfunktion,
//              fremdes Plugin, Qollab selbst). Das Herkunftssignal aus
//              `spike/herkunftssignal` meldet hier LOKAL (FP 0/337).
//   'sync'   — ein Datei-Sync hat die `.md` des Peers abgelegt. Signal: FREMD.
//   'extern' — ein anderes PROGRAMM hat die Datei geaendert (Notepad, Skript,
//              ein Editor ausserhalb von Obsidian). Signal: ebenfalls FREMD —
//              das Signal misst „dieser Prozess oder ein fremder", nicht
//              „Sync oder Mensch". Die beiden sind fuer die Regel NICHT
//              unterscheidbar; genau das ist der Lackmustest.
export type Quelle = 'nutzer' | 'sync' | 'extern';

// Deckt `doc` den Text `text` bereits ab?
function decktAb(doc: string, text: string): boolean {
  return unionMerge(text, doc) === doc;
}

export class Geraet {
  readonly vault = makeVaultMock() as any;
  readonly crdt = new CrdtManager();
  readonly sync: SyncHandler;
  // DIE ECHTE SCHREIBSPUR, nicht die Grundwahrheit `quelle`. Damit misst dieser
  // Treiber das ganze System: Signal, Tor, Parkplatz, Frist und Nachtrag sind
  // Produktivcode, nachgebaut ist nur die Klammer aus main.ts.
  readonly provenance: WriteProvenance;
  // Was das Plugin selbst vor dem Ueberschreiben gesichert hat.
  readonly kopien = new Map<string, string[]>();
  private writingPaths = new Set<string>();

  readonly aufschuebe = new Map<string, number>();
  aufschubZaehler = 0;
  praegeZaehler = 0;
  politikAktiv = false;

  constructor(
    readonly id: string,
    private politik: Praegepolitik = async () => true
  ) {
    this.sync = new SyncHandler(
      this.vault,
      this.crdt,
      id,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      // Die Sicherungskopie des Plugins. Im Produkt eine `.md` neben der Notiz;
      // hier reicht die Ablage, denn gemessen wird nur, OB der verdraengte Text
      // noch irgendwo steht.
      async (notePath: string, text: string) => {
        const liste = this.kopien.get(notePath) ?? [];
        liste.push(text);
        this.kopien.set(notePath, liste);
      }
    );
    this.provenance = new WriteProvenance(this.vault.adapter);
    this.provenance.install();
  }

  setPolitik(p: Praegepolitik): void {
    this.politik = p;
  }

  // ---- Dateizustand -------------------------------------------------------

  // Die Datei erscheint, OHNE dass dieser Prozess sie geschrieben hat: ein
  // Datei-Sync oder ein externer Editor. Genau das, was die Schreibspur als
  // fremd erkennen muss.
  setMd(notePath: string, text: string): void {
    this.vault._textFiles.set(notePath, text);
    this.vault._mdMtimes.set(notePath, (this.vault._mdMtimes.get(notePath) ?? 0) + 1);
  }

  // Ein Schreibvorgang DIESES Prozesses — Editor-Autosave, Kernfunktion,
  // fremdes Plugin. Laeuft ueber den Adapter und ist damit als eigen erkennbar.
  async tippe(notePath: string, text: string): Promise<void> {
    await this.vault.adapter.write(notePath, text);
  }

  md(notePath: string): string {
    return this.vault._textFiles.get(notePath) ?? '';
  }

  async wuerdePraegen(notePath: string): Promise<boolean> {
    if (this.crdt.hasDoc(notePath)) return false;
    if (await sidecarExists(this.vault.adapter, this.sync.stateFilePath(notePath))) return false;
    return !(await this.sync.hasAdoptableGuid(notePath));
  }

  async hatEigenePraesenz(): Promise<boolean> {
    const alle = await listAllSidecars(this.vault.adapter);
    return alle.some((p) => p.endsWith(`.${this.id}.yjs`));
  }

  // 0 = aus (Bestand). N > 0 = Frist in Ticks.
  parkFrist = 0;
  parkZaehler = 0;
  nachtragZaehler = 0;

  hatGeparkt(notePath: string): boolean {
    return this.sync.hasParked(notePath);
  }

  entkoppelt(notePath: string): boolean {
    if (this.sync.hasParked(notePath)) return true;
    const datei = this.md(notePath);
    if (datei === '') return false;
    return !decktAb(this.crdt.getContent(notePath), datei);
  }

  fremdErfassungAus = false;

  // Der 30-s-Tick (`SidecarWatcher.poll` / SCAN_INTERVAL_MS).
  async parkTick(notePath: string): Promise<void> {
    if (!this.sync.hasParked(notePath)) return;
    await this.sync.tickParked(notePath, this.parkFrist);
    if (!this.sync.hasParked(notePath)) this.nachtragZaehler++;
  }

  // ---- main.ts-Klammer ----------------------------------------------------

  // Nutzer tippt (oder ein externer Schreiber aendert die Datei) -> modify-Event.
  async modify(notePath: string, quelle: Quelle = 'nutzer'): Promise<void> {
    if (this.writingPaths.has(notePath)) return;
    if (quelle !== 'nutzer' && this.fremdErfassungAus) return;
    const file = this.vault.getAbstractFileByPath(notePath);
    if (!file) return;
    const content = await this.vault.read(file);

    // DAS TOR aus main.ts — mit dem ECHTEN Signal, nicht mit `quelle`.
    if (this.parkFrist > 0 && !this.provenance.istEigen(notePath, content)) {
      this.sync.parkForeign(notePath, content);
      this.parkZaehler++;
      return;
    }

    // DER EINGRIFF: an genau der Stelle, an der der Sweep seit Task 13/B schon
    // heute abbricht (main.ts:1283) — nur eben auch im modify-Pfad.
    if (this.politikAktiv && (await this.wuerdePraegen(notePath))) {
      if (!(await this.politik(this, notePath))) {
        this.aufschuebe.set(notePath, (this.aufschuebe.get(notePath) ?? 0) + 1);
        this.aufschubZaehler++;
        return;
      }
      this.praegeZaehler++;
    }

    // `applyLocalContent` gibt bei geparktem Pfad den Eingabetext zurueck — der
    // Riegel gegen den Write-Back sitzt im echten Code, nicht in dieser Klammer.
    const merged = await this.sync.applyLocalContent(notePath, content);
    await this.writeBackMerged(notePath, content, merged);
  }

  private async writeBackMerged(
    notePath: string,
    expected: string,
    merged: string | undefined
  ): Promise<void> {
    if (merged === undefined || merged === expected) return;
    const file = this.vault.getAbstractFileByPath(notePath);
    if (!file) return;
    this.writingPaths.add(notePath);
    let changed = false;
    try {
      await this.vault.process(file, (data: string) => {
        if (data !== expected) return data;
        changed = true;
        return merged;
      });
    } catch {
      changed = false;
    } finally {
      this.writingPaths.delete(notePath);
    }
    if (changed) this.sync.noteLocalDiffBase(notePath, merged);
  }

  // Watcher-Trigger (Poll / file-open) -> onRemoteYjsUpdate.
  async poll(notePath: string): Promise<boolean> {
    const preFile = this.vault.getAbstractFileByPath(notePath);
    let preMerge: string | null = null;
    if (preFile) preMerge = await this.vault.read(preFile);

    if (!this.vault.getAbstractFileByPath(notePath)) return true;

    const uncaptured = this.sync.pendingLocalContent(notePath);
    if (uncaptured !== undefined) await this.sync.applyLocalContent(notePath, uncaptured);

    const merged = await this.sync.loadAndMerge(notePath);
    if (merged === null) return false;
    if (this.sync.hasAbortedRead(notePath)) return false;

    // Die Aufloesung macht `loadAndMerge` selbst: deckt der Doc den geparkten
    // Stand, raeumt es den Parkplatz; sonst liefert es `null` (oben abgefangen)
    // und es gibt keinen Write-Back.

    if (merged === '' && !this.crdt.hasOps(notePath)) return true;

    const file = this.vault.getAbstractFileByPath(notePath);
    if (!file) return true;

    this.writingPaths.add(notePath);
    let changed = false;
    try {
      let pending: string | null = null;
      await this.vault.process(file, (data: string) => {
        if (data === merged) return data;
        if (preMerge === null || data === preMerge) {
          changed = true;
          return merged;
        }
        pending = data;
        return data;
      });
      this.sync.noteLocalDiffBase(notePath, merged);

      if (pending !== null) {
        const threeWay = threeWayMerge(preMerge ?? '', pending, merged);
        await this.sync.applyLocalContent(notePath, threeWay);
        if (this.sync.hasAbortedRead(notePath)) return false;
        const merged2 = this.crdt.getContent(notePath);
        let written: string | undefined;
        await this.vault.process(file, (data: string) => {
          const next = ((): string => {
            if (data === merged2) return data;
            if (data === pending) {
              changed = true;
              return merged2;
            }
            return data;
          })();
          written = next;
          return next;
        });
        if (written !== undefined) this.sync.noteLocalDiffBase(notePath, written);
      }
    } finally {
      this.writingPaths.delete(notePath);
    }
    return !this.sync.hasUnpersistedState(notePath);
  }
}
