import { TFile, Vault } from 'obsidian';

export type OnYjsChanged = (notePath: string) => Promise<void>;

const YJS_SUFFIX_RE = /\.[0-9a-f]{8}\.yjs$/;

export class FileWatcher {
  private eventRef: ReturnType<Vault['on']> | null = null;

  constructor(private vault: Vault, private onChanged: OnYjsChanged) {}

  start(): ReturnType<Vault['on']> {
    this.eventRef = this.vault.on('modify', async (file) => {
      if (!(file instanceof TFile)) return;
      const match = YJS_SUFFIX_RE.exec(file.path);
      if (!match) return;
      const notePath = file.path.slice(0, file.path.length - match[0].length);
      await this.onChanged(notePath);
    });
    return this.eventRef;
  }

  stop(): void {
    if (this.eventRef) {
      this.vault.offref(this.eventRef);
      this.eventRef = null;
    }
  }
}
