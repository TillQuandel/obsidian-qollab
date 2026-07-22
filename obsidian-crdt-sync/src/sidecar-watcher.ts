import { listAllSidecars, listYjsInDir, type SidecarAdapter } from './sidecar-io';

export const SCAN_INTERVAL_MS = 30_000;

export type OnYjsChanged = (notePath: string) => Promise<void>;

// Strikte per-Client-Form: .qollab/<notePath>.<8-hex-clientId>.yjs
// Der notePath muss auf .md enden — Sync-Konfliktkopien (z.B. note.md.a1b2c3d4-DESKTOP.yjs)
// werden so herausgefiltert, da ihr Suffix nach dem letzten .md nicht [0-9a-f]{8} ist.
const QOLLAB_RE = /^\.qollab\/(.+\.md)\.([0-9a-f]{8})\.yjs$/;
// Legacy-Form ohne clientId (v0.1-Ära): .qollab/<notePath>.yjs
const QOLLAB_LEGACY_RE = /^\.qollab\/(.+\.md)\.yjs$/;

// Von main.ts injizierte Obsidian-Primitiven — als Disposer-Rückgaben gekapselt,
// damit der Watcher Obsidian-agnostisch und ohne echte App testbar bleibt.
export interface SidecarWatcherHost {
  // Registriert ein Intervall; gibt einen Disposer zum Abräumen zurück.
  registerInterval(fn: () => void, ms: number): () => void;
  // Registriert den file-open-Listener; gibt einen Disposer zurück.
  onFileOpen(cb: (path: string | null) => void): () => void;
}

// Obsidian liefert für .qollab keine Vault-Events (Dot-Ordner-Blindheit), daher
// ein eigener Wächter: periodischer Poll-Scan des .qollab-Baums per Adapter +
// mtime-Vergleich, plus Sofort-Trigger beim Öffnen einer Note. Übernimmt die
// Filter-/Extraktions-Logik (QOLLAB_RE/Legacy, .md-Anker, Self-Ignore) des
// früheren, event-basierten FileWatcher.
export class SidecarWatcher {
  // Sidecar-Pfad → zuletzt gesehene mtime.
  private lastMtimes = new Map<string, number>();
  private disposers: Array<() => void> = [];

  constructor(
    private adapter: SidecarAdapter,
    private clientId: string,
    private onChanged: OnYjsChanged
  ) {}

  start(host: SidecarWatcherHost): void {
    this.disposers.push(
      host.registerInterval(() => {
        void this.poll();
      }, SCAN_INTERVAL_MS)
    );
    this.disposers.push(
      host.onFileOpen((path) => {
        if (path && path.endsWith('.md')) void this.scanNote(path);
      })
    );
  }

  stop(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  // Extrahiert den notePath für eine FREMDE Sidecar; null für die eigene
  // clientId-Datei (Loop-Schutz), Nicht-Sidecars und Sync-Konfliktkopien.
  // Zwei getrennte Prüfungen statt einer kombinierten Regex mit optionaler
  // clientId-Gruppe: die würde bei per-Client-Dateien den greedy `(.+)` die
  // clientId mitverschlucken. Erst strikt (mit Self-Ignore), dann Legacy.
  private extractForeign(path: string): string | null {
    const m = QOLLAB_RE.exec(path);
    if (m) {
      if (m[2] === this.clientId) return null; // eigene Datei — saveState schreibt sie selbst
      return m[1];
    }
    const legacy = QOLLAB_LEGACY_RE.exec(path);
    if (legacy) return legacy[1]; // Legacy trägt nie eine eigene clientId → nie self
    return null;
  }

  // Rekursiver Poll-Scan des gesamten .qollab-Baums. Neue oder (per mtime)
  // geänderte fremde Sidecar → onChanged. Gelöschte Dateien: nur aus der Map
  // entfernen (kein Trigger). Dient zugleich als Initial-Scan: bei leerer Map
  // gilt jede beim Start vorhandene fremde Sidecar als „neu" → wird gemergt.
  async poll(): Promise<void> {
    const paths = await listAllSidecars(this.adapter);
    const seen = new Set<string>();
    for (const path of paths) {
      seen.add(path);
      const stat = await this.adapter.stat(path);
      const mtime = stat?.mtime ?? 0;
      const prev = this.lastMtimes.get(path);
      this.lastMtimes.set(path, mtime);
      const notePath = this.extractForeign(path);
      if (notePath === null) continue; // eigene/ungültige — nur mtime tracken
      if (prev === undefined || mtime > prev) await this.onChanged(notePath);
    }
    // Verschwundene Dateien vergessen (kein Trigger).
    for (const key of [...this.lastMtimes.keys()]) {
      if (!seen.has(key)) this.lastMtimes.delete(key);
    }
  }

  // Sofort-Trigger beim Öffnen einer .md: Einzel-Scan ihres Sidecar-Verzeichnisses.
  // Enthält es eine neue/geänderte fremde Sidecar → onChanged (schnelles Feedback,
  // ohne auf das Poll-Intervall zu warten).
  async scanNote(notePath: string): Promise<void> {
    const paths = await listYjsInDir(this.adapter, notePath);
    let trigger = false;
    for (const path of paths) {
      const stat = await this.adapter.stat(path);
      const mtime = stat?.mtime ?? 0;
      const prev = this.lastMtimes.get(path);
      this.lastMtimes.set(path, mtime);
      if (this.extractForeign(path) === null) continue;
      if (prev === undefined || mtime > prev) trigger = true;
    }
    if (trigger) await this.onChanged(notePath);
  }
}
