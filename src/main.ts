import { Notice, Plugin, TFile } from 'obsidian';
import { CrdtManager } from './crdt-manager';
import { SyncHandler } from './sync-handler';
import { FileWatcher } from './file-watcher';
import { CrdtSyncSettings, CrdtSyncSettingTab, DEFAULT_SETTINGS } from './settings';

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

    this.crdtManager = new CrdtManager();
    this.syncHandler = new SyncHandler(this.app.vault, this.crdtManager);

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

    // Rename: .yjs-Datei mitumbenennen
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        const oldYjs = oldPath + '.yjs';
        const newYjs = file.path + '.yjs';
        const oldFile = this.app.vault.getAbstractFileByPath(oldYjs);
        if (oldFile instanceof TFile) {
          await this.app.fileManager.renameFile(oldFile, newYjs);
        }
        this.crdtManager.disposeDoc(oldPath);
      })
    );

    // Delete: .yjs-Datei mitlöschen
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        const yjsPath = file.path + '.yjs';
        const yjsFile = this.app.vault.getAbstractFileByPath(yjsPath);
        if (yjsFile instanceof TFile) {
          await this.app.vault.delete(yjsFile);
        }
        this.crdtManager.disposeDoc(file.path);
      })
    );

    this.addSettingTab(new CrdtSyncSettingTab(this.app, this));
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
