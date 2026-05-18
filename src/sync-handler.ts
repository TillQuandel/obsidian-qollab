import { CrdtManager } from './crdt-manager';

interface VaultLike {
  getAbstractFileByPath(path: string): { path: string } | null;
  readBinary(file: { path: string }): Promise<ArrayBuffer>;
  createBinary(path: string, data: ArrayBuffer): Promise<unknown>;
  modifyBinary(file: { path: string }, data: ArrayBuffer): Promise<unknown>;
}

export class SyncHandler {
  constructor(private vault: VaultLike, private crdtManager: CrdtManager) {}

  stateFilePath(notePath: string): string {
    return notePath + '.yjs';
  }

  async saveState(notePath: string): Promise<void> {
    const state = this.crdtManager.encodeState(notePath);
    const stateFile = this.stateFilePath(notePath);
    const existing = this.vault.getAbstractFileByPath(stateFile);
    if (existing) {
      await this.vault.modifyBinary(existing, state.buffer);
    } else {
      await this.vault.createBinary(stateFile, state.buffer);
    }
  }

  async loadAndMerge(notePath: string): Promise<string | null> {
    const stateFile = this.stateFilePath(notePath);
    const file = this.vault.getAbstractFileByPath(stateFile);
    if (!file) return null;
    const buffer = await this.vault.readBinary(file);
    return this.crdtManager.mergeAndGet(notePath, new Uint8Array(buffer));
  }
}
