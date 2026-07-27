import { Notice, Plugin, TFile } from 'obsidian';
import { CrdtManager } from './crdt-manager';
import { SyncHandler, TombstoneStore, QOLLAB_DIR } from './sync-handler';
import {
  SidecarAdapter,
  listYjsInDir,
  ensureSidecarFolder,
  dirname,
  statSidecar,
} from './sidecar-io';
import { SidecarWatcher } from './sidecar-watcher';
import { CrdtSyncSettings, CrdtSyncSettingTab, DEFAULT_SETTINGS, generateClientId } from './settings';
import { pruneTombstones } from './tombstones';
import { PathQueue } from './path-queue';
import { threeWayMerge } from './text-merge';

// Uint8Array → ArrayBuffer für Obsidians adapter.writeBinary (das nur ArrayBuffer
// akzeptiert). encodeStateFile liefert Uint8Array.
function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  return (data instanceof Uint8Array
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : data) as ArrayBuffer;
}

export default class CrdtSyncPlugin extends Plugin {
  settings: CrdtSyncSettings;
  private crdtManager: CrdtManager;
  private syncHandler: SyncHandler;
  private sidecarWatcher: SidecarWatcher;
  // Adapter-gestützte Sidecar-IO (.qollab/ ist für den Vault-Index unsichtbar).
  private sidecarAdapter: SidecarAdapter;
  // Gerätelokaler Tombstone-Store (Teil der Plugin-Data).
  private tombstoneStore: TombstoneStore = {
    has: (guid: string) => guid in this.settings.tombstones,
    add: async (guid: string) => {
      this.settings.tombstones[guid] = Date.now();
      await this.saveSettings();
    },
  };
  // Guard: verhindert Endlos-Loop wenn wir selbst eine .md-Datei schreiben
  private writingPaths = new Set<string>();
  // R2: Pro-Pfad-Dedup für korrupte-Datei-Notices (einmal pro Session).
  private corruptNoticePaths = new Set<string>();
  // Task 12: Zähler für aufeinanderfolgende IO-Lesefehler pro Sidecar-Pfad. Ein
  // einzelner Fehler ist transient (EBUSY beim Sync-Write) und bleibt still; hält
  // er an, ist die Note faktisch vom Sync abgeschnitten und der Nutzer muss es
  // erfahren — sonst ist „synct nicht mehr" nicht von „alles in Ordnung"
  // unterscheidbar.
  private unreadableCounts = new Map<string, number>();
  private static readonly UNREADABLE_NOTICE_AFTER = 3;
  // Serialisiert ALLE Doc-Mutationen pro Note-Pfad (Remote-Merge, lokale
  // Änderung, Startup-Sweep) — verhindert verschränkte Mutationen desselben
  // Y.Doc und damit verlorene Updates.
  private pathQueue = new PathQueue();
  private unloaded = false;

  async onload() {
    await this.loadSettings();

    if (!this.settings.clientId) {
      this.settings.clientId = generateClientId();
      await this.saveSettings();
    }

    this.crdtManager = new CrdtManager();
    const vault = this.app.vault;

    // Sidecars laufen ausschließlich über den Adapter — der Vault-Index ist blind
    // für den Dot-Ordner .qollab/. Die .md-Note dagegen ist indiziert und bleibt
    // auf der Vault-API (getAbstractFileByPath/read/process).
    const rawAdapter = vault.adapter;
    this.sidecarAdapter = {
      exists: (p) => rawAdapter.exists(p),
      readBinary: (p) => rawAdapter.readBinary(p),
      writeBinary: (p, data) => rawAdapter.writeBinary(p, toArrayBuffer(data)),
      remove: (p) => rawAdapter.remove(p),
      mkdir: (p) => rawAdapter.mkdir(p),
      stat: (p) => rawAdapter.stat(p),
      list: (p) => rawAdapter.list(p),
      rename: (from, to) => rawAdapter.rename(from, to),
      // Task 12: Auf Desktop (FileSystemAdapter) liest sidecar-io direkt am
      // Dateisystem statt über die verzögerte Adapter-Sicht. Duck-Typing statt
      // instanceof, damit Mobile/Test-Adapter ohne die Methode auskommen.
      getBasePath:
        typeof (rawAdapter as any).getBasePath === 'function'
          ? () => (rawAdapter as any).getBasePath() as string
          : undefined,
    };
    if (!this.sidecarAdapter.getBasePath) {
      // Einmalig beim Bind, nicht pro Aufruf: auf Mobile ist der Fallback der
      // legitime Normalfall. Benennt Obsidian getBasePath aber um, fiele Qollab
      // still auf genau die verzögerte Sicht zurück, die Task 12 ausgelöst hat.
      console.warn(
        'Qollab: kein Direktzugriff auf die Vault-Wurzel (getBasePath fehlt) — ' +
          'Sidecar-Lesezugriffe laufen über die vault.adapter-Sicht, die verzögert sein kann.'
      );
    }
    const adapter = this.sidecarAdapter;

    // Schlankes VaultLike: Vault-API für die indizierte .md, Adapter für Sidecars.
    const vaultLike = {
      getAbstractFileByPath: (p: string) => vault.getAbstractFileByPath(p),
      read: (file: { path: string }) => vault.read(file as TFile),
      adapter,
      listYjsFiles: (notePath: string) => listYjsInDir(adapter, notePath),
    };

    this.syncHandler = new SyncHandler(
      vaultLike as any,
      this.crdtManager,
      this.settings.clientId,
      this.tombstoneStore,
      // R2: korrupte Sidecar-Datei → einmalige Notice pro Session.
      (path: string) => {
        if (!this.corruptNoticePaths.has(path)) {
          this.corruptNoticePaths.add(path);
          new Notice(`Qollab: beschädigte Sync-Datei übersprungen: ${path}`);
        }
      },
      // Task 12: unlesbare (nicht korrupte) Sidecar → erst nach mehreren Versuchen
      // melden, damit ein transienter EBUSY nicht sofort nervt.
      (path: string) => this.noteUnreadable(path)
    );

    // Eigener Wächter statt Vault-Events: Obsidian feuert für .qollab nie. Poll-Scan
    // per Intervall + Sofort-Trigger beim Öffnen einer Note.
    this.sidecarWatcher = new SidecarWatcher(adapter, this.settings.clientId, async (notePath) => {
      // Rückgabe durchreichen: false = Merge abgebrochen, der Watcher darf den
      // Trigger dann nicht als verbraucht verbuchen (F-2a).
      return this.pathQueue.run(notePath, () => this.onRemoteYjsUpdate(notePath));
    });
    this.sidecarWatcher.start({
      registerInterval: (fn, ms) => {
        const id = window.setInterval(fn, ms);
        this.registerInterval(id);
        return () => window.clearInterval(id);
      },
      onFileOpen: (cb) => {
        const ref = this.app.workspace.on('file-open', (file) =>
          cb(file instanceof TFile ? file.path : null)
        );
        this.registerEvent(ref);
        return () => this.app.workspace.offref(ref);
      },
    });

    // Wenn Nutzer eine .md-Note bearbeitet → CRDT-State aktualisieren + speichern.
    // Read UND applyLocalContent laufen über dieselbe Queue wie der Remote-Merge:
    // so liest die Task die .md erst, nachdem ein evtl. laufender Merge sein
    // Write-Back abgeschlossen hat, statt einen stale-Text hereinzuspielen.
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (!this.settings.enabled) return;
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        if (this.writingPaths.has(file.path)) return;

        await this.pathQueue.run(file.path, async () => {
          if (this.unloaded) return;
          const content = await this.app.vault.read(file);
          if (this.unloaded) return;
          await this.syncHandler.applyLocalContent(file.path, content);
        });
      })
    );

    // Rename: .yjs-Dateien mitumbenennen. Gleiche Inkarnation → GUID bleibt,
    // Map-Eintrag zieht auf den neuen Pfad um. Über die Queue auf oldPath, damit
    // ein geparkter Task auf oldPath (loadAndMerge/applyLocalContent) nicht
    // parallel zum renameNote den GUID-Map-Eintrag mutiert (Orphan-.yjs +
    // GUID-Divergenz). Keine verschachtelten run-Aufrufe mit gleichem Key hier.
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        await this.pathQueue.run(oldPath, async () => {
          // Sidecars sind für den Index unsichtbar → über den Adapter listen und
          // umziehen. Zielordner ggf. anlegen (Rename in einen anderen Ordner).
          const sidecars = await listYjsInDir(this.sidecarAdapter, oldPath);
          for (const sc of sidecars) {
            const suffix = sc.slice(`${QOLLAB_DIR}/${oldPath}`.length);
            const newPath = `${QOLLAB_DIR}/${file.path}${suffix}`;
            await ensureSidecarFolder(this.sidecarAdapter, dirname(newPath));
            await this.sidecarAdapter.rename(sc, newPath);
          }
          this.syncHandler.renameNote(oldPath, file.path);
        });
      })
    );

    // Delete: .yjs-Dateien mitlöschen. VOR dem Löschen die GUID dieser
    // Inkarnation tombstonen — so kann eine stale fremde .yjs derselben GUID die
    // gleichnamig neu angelegte Note später nicht wiederauferstehen lassen. Über
    // die Queue, damit ein geparkter Task auf demselben Pfad nicht nach dem
    // Delete resumed und via saveState die gelöschte .yjs wieder anlegt
    // (Resurrection). Keine verschachtelten run-Aufrufe mit gleichem Key hier.
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        await this.pathQueue.run(file.path, async () => {
          const guid = await this.syncHandler.currentGuid(file.path);
          if (guid) await this.tombstoneStore.add(guid);
          // Sidecars über den Adapter listen und entfernen (Index-blind).
          const sidecars = await listYjsInDir(this.sidecarAdapter, file.path);
          for (const sc of sidecars) await this.sidecarAdapter.remove(sc);
          this.syncHandler.disposeNote(file.path);
        });
      })
    );

    this.addSettingTab(new CrdtSyncSettingTab(this.app, this));

    // Externe FS-Edits (z.B. CLI/LLM bei geschlossener App) erzeugen kein
    // 'modify'-Event. Beim Start nachziehen: fuer jede .md, deren mtime
    // neuer ist als die zugehoerige .yjs (oder die noch keine .yjs hat),
    // die lokale Aenderung via applyLocalContent in den CRDT bringen.
    // applyLocalContent bootstrappt den Doc aus dem persistierten eigenen State
    // (nicht aus dem Text) und diff-merged nur die lokale Aenderung ein. Hat
    // dieses Geraet noch keinen eigenen State, werden fremde Sibling-.yjs-Files
    // als Basis adoptiert (Sibling-Adoption). KEIN loadAndMerge — ein explizites
    // Hereinholen fremder .yjs-Staende findet im Sweep nicht statt.
    //
    // Reihenfolge zwingend: ERST der Sweep (aktualisiert die lokalen Snapshots
    // aller stale .md via applyLocalContent), DANN der Initial-Scan des
    // Watchers (merged alle beim Start vorhandenen fremden Sidecars). Andernfalls
    // würde man mergen, bevor die lokalen Snapshots aktuell sind — der Initial-
    // Scan schließt die Lücke, dass bei geschlossener App angekommene Remote-
    // Stände sonst nie gemergt wurden.
    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        await this.snapshotStaleMarkdownFiles();
        if (this.unloaded) return;
        await this.sidecarWatcher.poll();
      })();
    });
  }

  // Zählt Lesefehler pro Sidecar-Pfad und meldet einmalig, sobald die Datei
  // dauerhaft unlesbar wirkt. Dedup über dieselbe Menge wie die Korrupt-Notice —
  // ein Pfad erzeugt höchstens eine Notice pro Session.
  private noteUnreadable(path: string): void {
    const count = (this.unreadableCounts.get(path) ?? 0) + 1;
    this.unreadableCounts.set(path, count);
    if (count < CrdtSyncPlugin.UNREADABLE_NOTICE_AFTER) return;
    if (this.corruptNoticePaths.has(path)) return;
    this.corruptNoticePaths.add(path);
    new Notice(`Qollab: Sync-Datei wiederholt nicht lesbar — Note synct nicht: ${path}`);
  }

  private async snapshotStaleMarkdownFiles(): Promise<void> {
    if (!this.settings.enabled) return;

    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (this.unloaded) return;

      // Sidecar-mtime über den Adapter (Index-blind für .qollab/). Ist der eigene
      // Sidecar mindestens so neu wie die .md, ist der Snapshot aktuell.
      const statePath = this.syncHandler.stateFilePath(file.path);
      // Task 12 (m-3): frischer stat — eine stale Adapter-mtime würde die .md
      // fälschlich als „Snapshot aktuell" überspringen.
      const stat = await statSidecar(this.sidecarAdapter, statePath);
      if (stat && stat.mtime >= file.stat.mtime) {
        continue;
      }

      // Pro-Datei-Arbeit über dieselbe Queue wie modify/Remote-Merge — der Sweep
      // darf nicht parallel zu einem laufenden Merge denselben Doc mutieren.
      try {
        await this.pathQueue.run(file.path, async () => {
          if (this.unloaded) return;
          const content = await this.app.vault.read(file);
          if (this.unloaded) return;
          await this.syncHandler.applyLocalContent(file.path, content);
        });
      } catch {
        // Einzelne Datei darf den Sweep nicht abbrechen
      }
    }
  }

  // Rückgabe: false = der Merge lief NICHT durch (abgebrochen/übersprungen), der
  // Watcher darf den Trigger nicht als verbraucht verbuchen (F-2a). true = erledigt.
  private async onRemoteYjsUpdate(notePath: string): Promise<boolean> {
    if (this.unloaded) return false;
    if (!this.settings.enabled) return false;

    // Fix A: den .md-Inhalt VOR dem Merge festhalten. Er ist die Basis, um beim
    // Write-Back einen lokalen User-Edit zu erkennen, der zwischen Merge-
    // Berechnung und Write-Back in der Datei gelandet ist. Existiert die Datei
    // (noch) nicht, gibt es keine Basis → Normalpfad (blind schreiben) wie bisher.
    const preFile = this.app.vault.getAbstractFileByPath(notePath);
    let preMerge: string | null = null;
    if (preFile instanceof TFile) {
      preMerge = await this.app.vault.read(preFile);
      if (this.unloaded) return false;
    }

    // Guard 1: ohne .md gibt es nichts zu mergen. Ein loadAndMerge-Aufruf ohne
    // existierende .md würde ensureDoc und saveState auslösen — das persistiert
    // einen leeren eigenen Sidecar mit frischer GUID. Kehrt die .md später via
    // Sync zurück (Sync-Konfliktauflösung Delete-vs-Edit behält die Datei),
    // überschreibt dieser leere Stand beim nächsten Write-Back die Note mit ''.
    // Kommt die .md an, greift der reguläre Adopt-Zweig (ensureDoc) mit
    // .md-Injektion — kein eigener Aufruf hier nötig.
    const noteFile = this.app.vault.getAbstractFileByPath(notePath);
    // Verwaiste Sidecar ohne .md: bewusst nichts zu tun, gilt als erledigt —
    // sonst triggerte sie bei jedem Poll erneut.
    if (!noteFile) return true;

    // Fix-Runde (Review F-2b): Hat ein früherer applyLocalContent wegen eines
    // IO-Fehlers abgebrochen, lebt der lokale Edit NUR in der .md — loadAndMerge
    // injiziert den .md-Text im own-Branch bewusst nicht. Ohne Nachholen liefe der
    // Write-Back unten über `data === preMerge` und überschriebe ihn (Verlust).
    // Deshalb den Lauf hier nachholen, bevor der gemergte Stand berechnet wird.
    if (preMerge !== null && this.syncHandler.hasAbortedRead(notePath)) {
      await this.syncHandler.applyLocalContent(notePath, preMerge);
      if (this.unloaded) return false;
    }

    const merged = await this.syncHandler.loadAndMerge(notePath);
    if (this.unloaded) return false;
    // null = nichts zu mergen ODER Merge wegen IO-Fehler abgebrochen. In beiden
    // Fällen kein Write-Back; der Watcher hat lastSeen nicht fortgeschrieben.
    if (merged === null) return false;

    // Der Nachhol-Versuch ist erneut gescheitert: der lokale Edit ist weiterhin
    // nicht im CRDT erfasst, `merged` kennt ihn nicht. Ein Write-Back würde ihn
    // jetzt löschen — lieber gar nicht schreiben und beim nächsten Trigger erneut
    // versuchen.
    if (this.syncHandler.hasAbortedRead(notePath)) return false;

    // Guard 2: ein leerer, historienloser Merge-Stand darf eine vorhandene .md
    // nie überschreiben. Historienlos = Y.Doc hat keinerlei Ops (State-Vector leer,
    // store.clients.size === 0) — das passiert bei einem Frisch-Doc ohne Edits.
    // Abgrenzung: eine echte Leerung (User löscht allen Text) hinterlässt
    // Delete-Ops → hasOps() gibt true → dieser Guard greift NICHT.
    if (merged === '' && !this.crdtManager.hasOps(notePath)) return true;

    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return true;

    // Atomarer Read-Modify-Write in der process-Funktion. Der writingPaths-Guard
    // umschließt BEIDE process-Aufrufe, da jeder ein modify-Event feuert.
    this.writingPaths.add(notePath);
    let changed = false;
    try {
      // Erster Versuch, Drei-Fall-Logik:
      //   data === merged        → schon aktuell, kein Write, keine Notice.
      //   data === preMerge      → Normalfall, gemergten Stand schreiben.
      //   sonst                  → Edit im Merge-Fenster: NICHT überschreiben,
      //                            data als `pending` nach außen reichen.
      // Ohne preMerge-Basis (Datei existierte vor dem Merge nicht) gibt es keinen
      // Edit-Guard → wie bisher den gemergten Stand schreiben.
      let pending: string | null = null;
      await this.app.vault.process(file, (data) => {
        if (data === merged) return data;
        if (preMerge === null || data === preMerge) {
          changed = true;
          return merged;
        }
        pending = data;
        return data;
      });

      // Fix A: Ein Edit ist im Merge-Fenster gelandet. Ihn als 3-Wege-Merge
      // (Basis = preMerge, lokal = pending) auf den gemergten Remote-Stand
      // anwenden und via applyLocalContent ins CRDT bringen — so überleben beide
      // Änderungen. Danach EIN zweiter Write-Back-Versuch mit derselben Logik
      // (Basis ist jetzt `pending`). Weicht `data` erneut ab: aufgeben ohne Write,
      // der nächste modify-Event-Task konvergiert. Kein Loop, max. eine Wiederholung.
      if (pending !== null) {
        const threeWay = threeWayMerge(preMerge ?? '', pending, merged);
        await this.syncHandler.applyLocalContent(notePath, threeWay);
        if (!this.unloaded) {
          const merged2 = this.crdtManager.getContent(notePath);
          await this.app.vault.process(file, (data) => {
            if (data === merged2) return data;
            if (data === pending) {
              changed = true;
              return merged2;
            }
            return data;
          });
        }
      }
    } finally {
      this.writingPaths.delete(notePath);
    }

    if (changed && this.settings.statusNotice) {
      new Notice(`CRDT Sync: ${file.name} automatisch gemergt.`);
    }
    return true;
  }

  onunload() {
    this.unloaded = true;
    this.sidecarWatcher.stop();
    this.crdtManager.disposeAll();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Tombstones > 90 Tage beim Laden entfernen (hält die Data-Datei klein).
    this.settings.tombstones = pruneTombstones(this.settings.tombstones ?? {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
