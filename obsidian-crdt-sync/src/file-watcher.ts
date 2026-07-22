import { TFile, Vault } from 'obsidian';

export type OnYjsChanged = (notePath: string) => Promise<void>;

// Strikte per-Client-Form: .qollab/<notePath>.<8-hex-clientId>.yjs
// Der notePath muss auf .md enden — Sync-Konfliktkopien (z.B. note.md.a1b2c3d4-DESKTOP.yjs)
// werden so herausgefiltert, da ihr Suffix nach dem letzten .md nicht [0-9a-f]{8} ist.
const QOLLAB_RE = /^\.qollab\/(.+\.md)\.([0-9a-f]{8})\.yjs$/;
// Legacy-Form ohne clientId (v0.1-Ära): .qollab/<notePath>.yjs
// Der notePath muss auf .md enden — Sync-Konfliktkopien (z.B. note.md.sync-conflict-….yjs)
// haben einen Suffix nach dem letzten .md und matchen daher nicht.
const QOLLAB_LEGACY_RE = /^\.qollab\/(.+\.md)\.yjs$/;

export class FileWatcher {
  private eventRefs: ReturnType<Vault['on']>[] = [];

  constructor(private vault: Vault, private clientId: string, private onChanged: OnYjsChanged) {}

  // Gemeinsamer Handler für 'modify' UND 'create'.
  //
  // Zwei getrennte Prüfungen statt einer kombinierten Regex mit optionaler
  // clientId-Gruppe (`(.+)\.(?:[0-9a-f]{8}\.)?yjs$`): die würde bei per-Client-
  // Dateien den greedy `(.+)` die clientId mitverschlucken und einen falschen
  // notePath extrahieren. Erst strikt (mit clientId + Self-Ignore), dann Legacy.
  private handle = async (file: unknown): Promise<void> => {
    if (!(file instanceof TFile)) return;

    // 1. Per-Client-Form: notePath + 8-hex-clientId.
    const match = QOLLAB_RE.exec(file.path);
    if (match) {
      // Eigene clientId-Datei ignorieren: saveState schreibt sie selbst, sonst
      // entsteht eine Endlos-Schleife (modify → loadAndMerge → saveState → …).
      if (match[2] === this.clientId) return;
      await this.onChanged(match[1]);
      return;
    }

    // 2. Legacy-Form ohne clientId (Fix C): live per Sync ankommende v0.1-Datei.
    // Nie self (die eigene .yjs trägt immer eine clientId), daher kein Loop-Risiko.
    const legacy = QOLLAB_LEGACY_RE.exec(file.path);
    if (legacy) {
      await this.onChanged(legacy[1]);
    }
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
