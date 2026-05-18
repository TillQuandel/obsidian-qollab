import { TFile, Vault } from 'obsidian';

export type OnYjsChanged = (notePath: string) => Promise<void>;

export class FileWatcher {
  private eventRef: ReturnType<Vault['on']> | null = null;

  constructor(private vault: Vault, private onChanged: OnYjsChanged) {}

  start(): void {
    this.eventRef = this.vault.on('modify', async (file) => {
      if (!(file instanceof TFile)) return;
      if (!file.path.endsWith('.yjs')) return;
      const notePath = file.path.slice(0, -4); // 'note.md.yjs' → 'note.md'
      await this.onChanged(notePath);
    });
  }

  stop(): void {
    if (this.eventRef) {
      this.vault.offref(this.eventRef);
      this.eventRef = null;
    }
  }
}
