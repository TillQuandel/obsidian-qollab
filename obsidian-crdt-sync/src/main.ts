import { Notice, Plugin, TFile } from 'obsidian';
import { CrdtManager } from './crdt-manager';
import { SyncHandler } from './sync-handler';
import { FileWatcher } from './file-watcher';
import { CrdtSyncSettings, CrdtSyncSettingTab, DEFAULT_SETTINGS, generateClientId } from './settings';

export default class CrdtSyncPlugin extends Plugin {
  settings: CrdtSyncSettings;
  private crdtManager: CrdtManager;
  private syncHandler: SyncHandler;
  private fileWatcher: FileWatcher;
  // Guard: verhindert Endlos-Loop wenn wir selbst eine .md-Datei schreiben
  private writingPaths = new Set<string>();
  // Serialisiert Merge-Operationen pro Dateipfad (verhindert Race Condition bei schnellem Sync)
  private mergeQueue = new Map<string, Promise<void>>();
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
          target.getFiles()
            .map((f: { path: string }) => f.path)
            .filter((p: string) =>
              p.startsWith(`.qollab/${notePath}.`) && p.endsWith('.yjs')
            );
        return (target as any)[prop];
      }
    });
    this.syncHandler = new SyncHandler(vaultWithList as any, this.crdtManager, this.settings.clientId);

    this.fileWatcher = new FileWatcher(this.app.vault, async (notePath) => {
      // Merge-Aufrufe für denselben Pfad sequenziell abarbeiten
      const prev = this.mergeQueue.get(notePath) ?? Promise.resolve();
      const next = prev.then(() => this.onRemoteYjsUpdate(notePath));
      const queued = next.catch(() => {}).then(() => {
        if (this.mergeQueue.get(notePath) === queued) this.mergeQueue.delete(notePath);
      });
      this.mergeQueue.set(notePath, queued);
      await next;
    });
    this.registerEvent(this.fileWatcher.start());

    // Wenn Nutzer eine .md-Note bearbeitet → CRDT-State aktualisieren + speichern
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (!this.settings.enabled) return;
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        if (this.writingPaths.has(file.path)) return;

        const content = await this.app.vault.read(file);
        this.crdtManager.setContent(file.path, content);
        await this.syncHandler.saveState(file.path);
      })
    );

    // Rename: .yjs-Dateien mitumbenennen
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        const yjsFiles = this.app.vault.getFiles()
          .filter((f: TFile) => f.path.startsWith(`.qollab/${oldPath}.`) && f.path.endsWith('.yjs'));
        for (const yjsFile of yjsFiles) {
          const suffix = yjsFile.path.slice(`.qollab/${oldPath}`.length);
          await this.app.fileManager.renameFile(yjsFile, `.qollab/${file.path}${suffix}`);
        }
        this.crdtManager.disposeDoc(oldPath);
      })
    );

    // Delete: .yjs-Dateien mitlöschen
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        const yjsFiles = this.app.vault.getFiles()
          .filter((f: TFile) => f.path.startsWith(`.qollab/${file.path}.`) && f.path.endsWith('.yjs'));
        for (const yjsFile of yjsFiles) {
          await this.app.vault.delete(yjsFile);
        }
        this.crdtManager.disposeDoc(file.path);
      })
    );

    this.addSettingTab(new CrdtSyncSettingTab(this.app, this));

    // Externe FS-Edits (z.B. CLI/LLM bei geschlossener App) erzeugen kein
    // 'modify'-Event. Beim Start nachziehen: fuer jede .md, deren mtime
    // neuer ist als die zugehoerige .yjs (oder die noch keine .yjs hat),
    // einen frischen Snapshot schreiben. KEIN loadAndMerge — sonst wuerden
    // stale .yjs-Stati in den aktuellen .md-Inhalt zurueckgemergt.
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

      try {
        const content = await this.app.vault.read(file);
        this.crdtManager.setContent(file.path, content);
        await this.syncHandler.saveState(file.path);
      } catch {
        // Einzelne Datei darf den Sweep nicht abbrechen
      }
    }
  }

  private async onRemoteYjsUpdate(notePath: string): Promise<void> {
    if (this.unloaded) return;
    if (!this.settings.enabled) return;

    const merged = await this.syncHandler.loadAndMerge(notePath);
    if (merged === null) return;

    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return;

    const current = await this.app.vault.read(file);
    if (current === merged) return;

    this.writingPaths.add(notePath);
    try {
      await this.app.vault.modify(file, merged);
    } finally {
      this.writingPaths.delete(notePath);
    }

    if (this.settings.statusNotice) {
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
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
