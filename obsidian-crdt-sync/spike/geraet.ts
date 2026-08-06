// Zwei-Geraete-Treiber gegen den ECHTEN SyncHandler.
//
// Portiert von `mess/verdopplung` auf diesen Branch. Kein Modell des Merge-Kerns:
// SyncHandler, CrdtManager, text-merge, sidecar-io, state-file und
// write-provenance sind unveraendert der Produktivcode. Nachgebaut ist
// ausschliesslich die Klammer aus main.ts, die im Test sonst fehlt:
//   - modify-Handler   (main.ts:302-341)
//   - writeBackMerged  (main.ts, siehe dort)
//   - onRemoteYjsUpdate(main.ts:1388-1540)
//   - START-SWEEP      (main.ts:1230-1380)  <- NEU gegenueber der Vorlage
// jeweils ohne `unloaded`/`enabled`/`sweepRunning` (im Treiber immer an) und ohne
// PathQueue (der Treiber ist sequentiell, es gibt nichts zu serialisieren).
//
// WARUM DER SWEEP DAZUKOMMT: Die Vorlage kannte nur `modify` und `poll`. Der
// modify-Pfad hat seit dem Erstkontakt-Fix DAS TOR (Herkunftssignal ->
// `parkForeign`). Der Start-Sweep hat es nicht — main.ts:87-91 sagt das
// ausdruecklich („beim Start ist Herkunft ohnehin nicht ableitbar"). Ein Treiber
// ohne Sweep kann den verbliebenen Schadensweg gar nicht sehen.

import { SyncHandler } from '../src/sync-handler';
import { WriteProvenance } from '../src/write-provenance';
import { CrdtManager } from '../src/crdt-manager';
import { threeWayMerge, unionMerge } from '../src/text-merge';
import { sidecarExists, listAllSidecars, statSidecar } from '../src/sidecar-io';
import { makeVaultMock } from '../tests/helpers/vault-mock';

export type Praegepolitik = (g: Geraet, notePath: string) => Promise<boolean>;

// Woher stammt der Inhalt, den ein modify-Ereignis vorfindet?
//
//   'nutzer' — dieser Prozess hat ihn geschrieben (Editor-Autosave, Kernfunktion,
//              fremdes Plugin, Qollab selbst). Signal: LOKAL.
//   'sync'   — ein Datei-Sync hat die `.md` des Peers abgelegt. Signal: FREMD.
//   'extern' — ein anderes PROGRAMM hat die Datei geaendert. Signal: ebenfalls
//              FREMD — das Signal misst „dieser Prozess oder ein fremder".
export type Quelle = 'nutzer' | 'sync' | 'extern';

// Deckt `doc` den Text `text` bereits ab?
function decktAb(doc: string, text: string): boolean {
  return unionMerge(text, doc) === doc;
}

export class Geraet {
  // DIE PLATTE. Sie ueberlebt einen Neustart — `_textFiles` sind die `.md`,
  // `_files` die Hilfsdateien.
  readonly vault = makeVaultMock() as any;
  // DER PROZESS. Alles hier ist nach einem Neustart weg und wird aus der Platte
  // neu aufgebaut. Deshalb NICHT readonly.
  crdt = new CrdtManager();
  sync: SyncHandler;
  // DIE ECHTE SCHREIBSPUR, nicht die Grundwahrheit `quelle`. Damit misst dieser
  // Treiber das ganze System: Signal, Tor, Parkplatz, Frist und Nachtrag sind
  // Produktivcode, nachgebaut ist nur die Klammer aus main.ts.
  provenance: WriteProvenance;
  // Was das Plugin selbst vor dem Ueberschreiben gesichert hat (onSaveCopy).
  readonly kopien = new Map<string, string[]>();
  private writingPaths = new Set<string>();

  // DER SWEEP-MERKER. Er liegt im Geraeteprofil (localStorage), NICHT im Vault —
  // also ueberlebt er einen Neustart. Genau wie SWEEP_CURSOR_KEY in main.ts.
  private sweepMerker: Record<string, [number, number]> = {};

  readonly aufschuebe = new Map<string, number>();
  aufschubZaehler = 0;
  praegeZaehler = 0;
  politikAktiv = false;

  // NEUSTART — Obsidian wird geschlossen und wieder geoeffnet. Die Platte bleibt,
  // der Prozess ist weg: `parked`, `localDiffBase`, `guids` und die Docs sind
  // fort, ebenso die Schreibspur (`staende` ist leer, also gilt beim ersten
  // Anfassen JEDE Datei als fremd). Der Sweep-Merker bleibt — er liegt im
  // Geraeteprofil.
  async neustart(): Promise<void> {
    this.crdt = new CrdtManager();
    this.sync = this.baueSync();
    this.provenance = new WriteProvenance(this.vault.adapter);
    this.provenance.install();
    this.writingPaths.clear();
  }

  private baueSync(): SyncHandler {
    return new SyncHandler(
      this.vault,
      this.crdt,
      this.id,
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
  }

  constructor(
    readonly id: string,
    private politik: Praegepolitik = async () => true
  ) {
    this.sync = this.baueSync();
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
  //
  // Der Zeitstempel springt dabei ueber ALLES, was schon auf der Platte liegt.
  // Das ist keine Bequemlichkeit, sondern die Realitaet: der Sync-Dienst schreibt
  // JETZT, also spaeter als die eigene Hilfsdatei von vorhin. Mit dem `+1` der
  // Vorlage blieb die `.md` aelter als die Hilfsdatei — der Sweep haette sie
  // uebersprungen und der gemessene Weg waere nie gelaufen.
  setMd(notePath: string, text: string): void {
    let max = 0;
    for (const t of this.vault._mtimes.values() as Iterable<number>) if (t > max) max = t;
    for (const t of this.vault._mdMtimes.values() as Iterable<number>) if (t > max) max = t;
    this.vault._textFiles.set(notePath, text);
    this.vault._mdMtimes.set(notePath, max + 1);
  }

  // Eine ZURUECKDATIERTE Fremdschreibung: „vorherige Version wiederherstellen",
  // Explorer-Copy, ZIP-Entpacken. Der Inhalt aendert sich, der Zeitstempel nicht.
  setMdZurueckdatiert(notePath: string, text: string): void {
    this.vault._textFiles.set(notePath, text);
    // mtime bleibt stehen — genau das ist der Fall aus main.ts (`zurueckdatiert`).
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
  async modify(notePath: string, _quelle: Quelle = 'nutzer'): Promise<void> {
    if (this.writingPaths.has(notePath)) return;
    if (_quelle !== 'nutzer' && this.fremdErfassungAus) return;
    const file = this.vault.getAbstractFileByPath(notePath);
    if (!file) return;
    const content = await this.vault.read(file);

    // DAS TOR aus main.ts:326-334 — mit dem ECHTEN Signal, nicht mit `quelle`.
    if (this.parkFrist > 0 && !this.provenance.istEigen(notePath, content)) {
      this.sync.parkForeign(notePath, content);
      this.parkZaehler++;
      return;
    }

    if (this.politikAktiv && (await this.wuerdePraegen(notePath))) {
      if (!(await this.politik(this, notePath))) {
        this.aufschuebe.set(notePath, (this.aufschuebe.get(notePath) ?? 0) + 1);
        this.aufschubZaehler++;
        return;
      }
      this.praegeZaehler++;
    }

    const merged = await this.sync.applyLocalContent(notePath, content);
    await this.writeBackMerged(notePath, content, merged);
  }

  // DER START-SWEEP aus main.ts (`sweepStaleNotes`). Eins zu eins die Reihenfolge
  // der Gates dort — und OHNE Herkunfts-Tor, weil main.ts dort keines hat.
  //
  // Rueckgabe: die Pfade, die der Sweep tatsaechlich angesehen (also durch
  // `applyLocalContent` geschickt) hat. Nur so ist nachweisbar, dass eine Zelle
  // den Weg wirklich gelaufen ist statt am Gate zu enden.
  async sweep(): Promise<string[]> {
    const angesehen: string[] = [];
    const naechster: Record<string, [number, number]> = {};
    const vorher = this.sweepMerker;
    for (const file of this.vault.getMarkdownFiles() as Array<{
      path: string;
      stat: { mtime: number; size: number };
    }>) {
      const notePath = file.path;
      const seen = vorher[notePath];
      if (seen && seen[0] === file.stat.mtime && seen[1] === file.stat.size) {
        naechster[notePath] = seen;
        continue;
      }
      const zurueckdatiert = seen !== undefined && file.stat.mtime <= seen[0];
      const statePath = this.sync.stateFilePath(notePath);
      const stat = await statSidecar(this.vault.adapter, statePath);
      if (!zurueckdatiert && stat && stat.mtime >= file.stat.mtime) {
        naechster[notePath] = [file.stat.mtime, file.stat.size];
        continue;
      }
      if (!stat && !(await this.sync.hasAdoptableGuid(notePath))) continue;

      const content = await this.vault.read(file);
      angesehen.push(notePath);
      const merged = await this.sync.applyLocalContent(notePath, content);
      await this.writeBackMerged(notePath, content, merged);
    }
    this.sweepMerker = naechster;
    return angesehen;
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
