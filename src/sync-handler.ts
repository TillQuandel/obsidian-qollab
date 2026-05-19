import { CrdtManager } from './crdt-manager';

interface VaultLike {
  getAbstractFileByPath(path: string): { path: string } | null;
  read(file: { path: string }): Promise<string>;
  readBinary(file: { path: string }): Promise<ArrayBuffer>;
  createBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  modifyBinary(file: { path: string }, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  listYjsFiles(notePath: string): string[];
}

export class SyncHandler {
  constructor(private vault: VaultLike, private crdtManager: CrdtManager, private clientId: string) {}

  stateFilePath(notePath: string): string {
    return `${notePath}.${this.clientId}.yjs`;
  }

  async saveState(notePath: string): Promise<void> {
    const state = this.crdtManager.encodeState(notePath);
    const stateFile = this.stateFilePath(notePath);
    const existing = this.vault.getAbstractFileByPath(stateFile);
    if (existing) {
      await this.vault.modifyBinary(existing, state);
    } else {
      try {
        await this.vault.createBinary(stateFile, state);
      } catch {
        // Datei wurde zwischen Check und Create von anderem Prozess angelegt — modify als Fallback
        const created = this.vault.getAbstractFileByPath(stateFile);
        if (created) await this.vault.modifyBinary(created, state);
      }
    }
  }

  async loadAndMerge(notePath: string): Promise<string | null> {
    const yjsFiles = this.vault.listYjsFiles(notePath);
    if (yjsFiles.length === 0) return null;

    if (!this.crdtManager.hasDoc(notePath)) {
      const noteFile = this.vault.getAbstractFileByPath(notePath);
      if (noteFile) {
        const localContent = await this.vault.read(noteFile);
        this.crdtManager.setContent(notePath, localContent);
      }
    }

    for (const yjsPath of yjsFiles) {
      const file = this.vault.getAbstractFileByPath(yjsPath);
      if (!file) continue;
      const buffer = await this.vault.readBinary(file);
      this.crdtManager.applyUpdate(notePath, new Uint8Array(buffer));
    }

    return this.crdtManager.getContent(notePath);
  }
}
