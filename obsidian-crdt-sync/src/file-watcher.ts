import { TFile, Vault } from 'obsidian';

export type OnYjsChanged = (notePath: string) => Promise<void>;

const QOLLAB_RE = /^\.qollab\/(.+)\.([0-9a-f]{8})\.yjs$/;

export class FileWatcher {
  private eventRef: ReturnType<Vault['on']> | null = null;

  constructor(private vault: Vault, private clientId: string, private onChanged: OnYjsChanged) {}

  start(): ReturnType<Vault['on']> {
    this.eventRef = this.vault.on('modify', async (file) => {
      if (!(file instanceof TFile)) return;
      const match = QOLLAB_RE.exec(file.path);
      if (!match) return;
      // Eigene clientId-Datei ignorieren: saveState schreibt sie selbst, sonst
      // entsteht eine Endlos-Schleife (modify → loadAndMerge → saveState → …).
      if (match[2] === this.clientId) return;
      await this.onChanged(match[1]);
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
