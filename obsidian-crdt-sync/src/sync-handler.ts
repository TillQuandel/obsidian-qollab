import { CrdtManager } from './crdt-manager';

export const QOLLAB_DIR = '.qollab';

interface VaultLike {
  getAbstractFileByPath(path: string): { path: string } | null;
  read(file: { path: string }): Promise<string>;
  readBinary(file: { path: string }): Promise<ArrayBuffer>;
  createBinary(path: string, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  modifyBinary(file: { path: string }, data: ArrayBuffer | Uint8Array): Promise<unknown>;
  createFolder(path: string): Promise<unknown>;
  listYjsFiles(notePath: string): string[];
}

export class SyncHandler {
  constructor(private vault: VaultLike, private crdtManager: CrdtManager, private clientId: string) {}

  stateFilePath(notePath: string): string {
    return `${QOLLAB_DIR}/${notePath}.${this.clientId}.yjs`;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    if (!folderPath || this.vault.getAbstractFileByPath(folderPath)) return;
    const parent = folderPath.split('/').slice(0, -1).join('/');
    if (parent) await this.ensureFolder(parent);
    await this.vault.createFolder(folderPath);
  }

  async saveState(notePath: string): Promise<void> {
    const state = this.crdtManager.encodeState(notePath);
    const stateFile = this.stateFilePath(notePath);
    const folderPath = stateFile.split('/').slice(0, -1).join('/');
    await this.ensureFolder(folderPath);
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
