import { TFile, Vault } from 'obsidian';

export type OnYjsChanged = (notePath: string) => Promise<void>;

const QOLLAB_RE = /^\.qollab\/(.+)\.([0-9a-f]{8})\.yjs$/;

export class FileWatcher {
  private eventRefs: ReturnType<Vault['on']>[] = [];

  constructor(private vault: Vault, private clientId: string, private onChanged: OnYjsChanged) {}

  // Gemeinsamer Handler für 'modify' UND 'create'. Identische Filterung: nur
  // per-Client-.yjs (QOLLAB_RE), eigene clientId ignorieren, nur TFile.
  private handle = async (file: unknown): Promise<void> => {
    if (!(file instanceof TFile)) return;
    const match = QOLLAB_RE.exec(file.path);
    if (!match) return;
    // Eigene clientId-Datei ignorieren: saveState schreibt sie selbst, sonst
    // entsteht eine Endlos-Schleife (modify → loadAndMerge → saveState → …).
    if (match[2] === this.clientId) return;
    await this.onChanged(match[1]);
  };

  // Auf 'modify' UND 'create' lauschen. Ohne 'create' triggert ein fremdes .yjs,
  // das erstmals ERSCHEINT (z.B. nach `git pull` / erstem Sync), keinen Merge —
  // Erstkontakt-Konvergenz käme erst bei einem späteren modify zustande. Gibt die
  // Refs als Array zurück; der Aufrufer registriert jeden einzeln.
  start(): ReturnType<Vault['on']>[] {
    this.eventRefs = [
      this.vault.on('modify', this.handle),
      this.vault.on('create', this.handle),
    ];
    return this.eventRefs;
  }

  stop(): void {
    for (const ref of this.eventRefs) this.vault.offref(ref);
    this.eventRefs = [];
  }
}
