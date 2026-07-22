import { Notice, Plugin, TFile } from 'obsidian';
import { diff_match_patch } from 'diff-match-patch';
import { CrdtManager } from './crdt-manager';
import { SyncHandler, filterYjsFiles, TombstoneStore, QOLLAB_DIR } from './sync-handler';
import { FileWatcher } from './file-watcher';
import { CrdtSyncSettings, CrdtSyncSettingTab, DEFAULT_SETTINGS, generateClientId } from './settings';
import { pruneTombstones } from './tombstones';
import { PathQueue } from './path-queue';

// 3-Wege-Text-Merge: die lokale Änderung (Diff base → local) wird als Patch auf
// den bereits gemergten other-Stand angewandt. Nicht anwendbare Hunks (Kontext
// durch den Remote-Edit verschoben) werden verworfen — dann überlebt other und
// der nächste modify-Task konvergiert. Nötig, weil applyLocalContent(local) ein
// Volltext-Diff gegen den (bereits Remote-gemergten) Doc bildet und damit die
// Remote-Änderung zurückrollen würde; base=preMerge macht daraus die reine
// lokale Delta-Anwendung.
const dmp = new diff_match_patch();
function threeWayMerge(base: string, local: string, other: string): string {
  const patches = dmp.patch_make(base, local);
  const [merged] = dmp.patch_apply(patches, other);
  return merged;
}

export default class CrdtSyncPlugin extends Plugin {
  settings: CrdtSyncSettings;
  private crdtManager: CrdtManager;
  private syncHandler: SyncHandler;
  private fileWatcher: FileWatcher;
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
    const vaultWithList = new Proxy(vault, {
      get(target, prop) {
        if (prop === 'listYjsFiles') return (notePath: string) =>
          filterYjsFiles(
            target.getFiles().map((f: { path: string }) => f.path),
            notePath
          );
        return (target as any)[prop];
      }
    });
    this.syncHandler = new SyncHandler(vaultWithList as any, this.crdtManager, this.settings.clientId, this.tombstoneStore);

    this.fileWatcher = new FileWatcher(this.app.vault, this.settings.clientId, async (notePath) => {
      await this.pathQueue.run(notePath, () => this.onRemoteYjsUpdate(notePath));
    });
    // start() liefert je einen Ref für 'modify' und 'create' — beide registrieren.
    for (const ref of this.fileWatcher.start()) this.registerEvent(ref);

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
          const files = this.app.vault.getFiles();
          const yjsPaths = new Set(filterYjsFiles(files.map((f: TFile) => f.path), oldPath));
          for (const yjsFile of files) {
            if (!yjsPaths.has(yjsFile.path)) continue;
            const suffix = yjsFile.path.slice(`${QOLLAB_DIR}/${oldPath}`.length);
            await this.app.fileManager.renameFile(yjsFile, `${QOLLAB_DIR}/${file.path}${suffix}`);
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
          const files = this.app.vault.getFiles();
          const yjsPaths = new Set(filterYjsFiles(files.map((f: TFile) => f.path), file.path));
          for (const yjsFile of files) {
            if (yjsPaths.has(yjsFile.path)) await this.app.vault.delete(yjsFile);
          }
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
    this.app.workspace.onLayoutReady(() => {
      void this.snapshotStaleMarkdownFiles();
    });
  }

  private async snapshotStaleMarkdownFiles(): Promise<void> {
    if (!this.settings.enabled) return;

    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (this.unloaded) return;

      const statePath = this.syncHandler.stateFilePath(file.path);
      const stateFile = this.app.vault.getAbstractFileByPath(statePath);
      if (stateFile instanceof TFile && stateFile.stat.mtime >= file.stat.mtime) {
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

  private async onRemoteYjsUpdate(notePath: string): Promise<void> {
    if (this.unloaded) return;
    if (!this.settings.enabled) return;

    // Fix A: den .md-Inhalt VOR dem Merge festhalten. Er ist die Basis, um beim
    // Write-Back einen lokalen User-Edit zu erkennen, der zwischen Merge-
    // Berechnung und Write-Back in der Datei gelandet ist. Existiert die Datei
    // (noch) nicht, gibt es keine Basis → Normalpfad (blind schreiben) wie bisher.
    const preFile = this.app.vault.getAbstractFileByPath(notePath);
    let preMerge: string | null = null;
    if (preFile instanceof TFile) {
      preMerge = await this.app.vault.read(preFile);
      if (this.unloaded) return;
    }

    const merged = await this.syncHandler.loadAndMerge(notePath);
    if (this.unloaded) return;
    if (merged === null) return;

    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return;

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
  }

  onunload() {
    this.unloaded = true;
    this.fileWatcher.stop();
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
