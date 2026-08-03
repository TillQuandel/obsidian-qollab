import { listAllSidecars, listYjsInDir, statSidecar, type SidecarAdapter } from './sidecar-io';

export const SCAN_INTERVAL_MS = 30_000;

// Rückgabe `false` (oder ein Wurf) heißt: der Merge lief NICHT durch, der Trigger
// gilt als nicht verbraucht — siehe lastSeen-Behandlung in poll/scanNote. Jeder
// andere Rückgabewert (inkl. undefined) zählt als erledigt.
export type OnYjsChanged = (notePath: string) => Promise<boolean | void>;

// Task 14: Meldung über eine Änderung an der EIGENEN Sidecar-Datei. Normalerweise
// war das unser eigener saveState; war es ein anderes Gerät, teilen sich zwei
// Geräte dieselbe clientId und der Self-Ignore unten verschluckt den Peer für
// immer. Die Entscheidung (und die Neu-Provisionierung) liegt beim Aufrufer — der
// Watcher kennt weder Sidecar-Inhalte noch die Identitäts-Ablage.
export type OnOwnSidecarChanged = (
  notePath: string,
  path: string,
  cur: { mtime: number; size: number }
) => Promise<boolean | void>;

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
  // Sidecar-Pfad → zuletzt gesehene (mtime, size). size ergänzt mtime, weil
  // mtime allein nicht reicht: grobe FS-Granularität bzw. mtime-klemmende
  // Sync-Tools erzeugen Overwrites mit gleicher mtime, Clock-Skew lässt mtime
  // rückwärts springen. Yjs-States wachsen mit dem Inhalt → size fängt beides.
  private lastSeen = new Map<string, { mtime: number; size: number }>();
  private disposers: Array<() => void> = [];

  constructor(
    private adapter: SidecarAdapter,
    private clientId: string,
    private onChanged: OnYjsChanged,
    // Optional: ohne Hook verhält sich der Watcher wie bisher (eigene Dateien
    // werden nur getrackt).
    private onOwnChanged?: OnOwnSidecarChanged
  ) {}

  // Task 14: Nach einer erkannten ID-Kollision provisioniert main.ts neu; ab dann
  // sind die Dateien der alten ID für den Watcher fremd (und lösen Merges aus).
  setClientId(clientId: string): void {
    this.clientId = clientId;
  }

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

  // Gegenstück zu extractForeign: notePath, wenn der Pfad die Sidecar DIESES
  // Geräts ist. Legacy-Dateien zählen nicht — sie tragen keine clientId.
  private extractOwn(path: string): string | null {
    const m = QOLLAB_RE.exec(path);
    return m && m[2] === this.clientId ? m[1] : null;
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
      // Task 12: statSidecar statt adapter.stat — ein stale stat auf eine bereits
      // gesehene Sidecar würde ein Update unterdrücken (Review m-3).
      const stat = await statSidecar(this.adapter, path);
      const cur = { mtime: stat?.mtime ?? 0, size: stat?.size ?? 0 };
      const prev = this.lastSeen.get(path);
      const notePath = this.extractForeign(path);
      if (notePath === null) {
        // Eigene oder uninteressante Datei. Task 14: eine VERÄNDERTE eigene Datei
        // ist der einzige Hinweis darauf, dass ein zweites Gerät dieselbe clientId
        // trägt — hier abzweigen, statt sie wie bisher stumm mitzutracken.
        await this.checkOwnSidecar(path, prev, cur);
        this.lastSeen.set(path, cur);
        continue;
      }
      if (!this.hasChanged(prev, cur)) {
        this.lastSeen.set(path, cur); // unverändert — nur tracken
        continue;
      }
      // Fix-Runde (Review F-2a): lastSeen erst NACH erfolgreichem onChanged
      // fortschreiben. Sonst konsumiert ein abgebrochener Merge (IO-Fehler) den
      // Trigger dauerhaft — dieselbe Sidecar löst bis zum nächsten mtime/size-
      // Wechsel oder Neustart nie wieder aus.
      if (await this.runChanged(notePath)) this.lastSeen.set(path, cur);
    }
    // Verschwundene Dateien vergessen (kein Trigger).
    for (const key of [...this.lastSeen.keys()]) {
      if (!seen.has(key)) this.lastSeen.delete(key);
    }
  }

  // Führt den Merge aus. false = Trigger NICHT verbraucht (Merge abgebrochen), der
  // Aufrufer lässt lastSeen dann unangetastet, damit der nächste Scan erneut
  // auslöst. Ein Wurf darf zudem den laufenden Scan nicht abbrechen — die übrigen
  // Sidecars sollen weiterverarbeitet werden.
  private async runChanged(notePath: string): Promise<boolean> {
    try {
      return (await this.onChanged(notePath)) !== false;
    } catch (err) {
      // R2-2: Ohne Log äußerte sich ein echter Programmierfehler im Merge-Pfad nur
      // noch als „triggert alle 30 s erneut" — der Wurf wird hier ja bewusst
      // geschluckt, damit er den laufenden Scan nicht abbricht.
      console.error('Qollab: Merge fehlgeschlagen für', notePath, err);
      return false;
    }
  }

  // Task 14: Änderung an der eigenen Sidecar melden. Ein Wurf darf den Scan nicht
  // abbrechen (gleiche Regel wie runChanged) — die übrigen Sidecars sollen
  // weiterlaufen.
  private async checkOwnSidecar(
    path: string,
    prev: { mtime: number; size: number } | undefined,
    cur: { mtime: number; size: number }
  ): Promise<void> {
    if (!this.onOwnChanged) return;
    const notePath = this.extractOwn(path);
    if (notePath === null) return;
    if (!this.hasChanged(prev, cur)) return;
    try {
      await this.onOwnChanged(notePath, path, cur);
    } catch (err) {
      console.error('Qollab: Kollisionsprüfung fehlgeschlagen für', path, err);
    }
  }

  // Neu (prev undefined) oder mtime ODER size verschieden. `!==` statt `>`, damit
  // auch rückwärts springende mtime (Clock-Skew) und gleich bleibende mtime bei
  // geänderter size erkannt werden — sonst still übersprungen bis zum Neustart.
  private hasChanged(
    prev: { mtime: number; size: number } | undefined,
    cur: { mtime: number; size: number }
  ): boolean {
    return prev === undefined || prev.mtime !== cur.mtime || prev.size !== cur.size;
  }

  // Sofort-Trigger beim Öffnen einer .md: Einzel-Scan ihres Sidecar-Verzeichnisses.
  // Enthält es eine neue/geänderte fremde Sidecar → onChanged (schnelles Feedback,
  // ohne auf das Poll-Intervall zu warten).
  async scanNote(notePath: string): Promise<void> {
    const paths = await listYjsInDir(this.adapter, notePath);
    const scanned: Array<[string, { mtime: number; size: number }]> = [];
    let trigger = false;
    for (const path of paths) {
      const stat = await statSidecar(this.adapter, path);
      const cur = { mtime: stat?.mtime ?? 0, size: stat?.size ?? 0 };
      scanned.push([path, cur]);
      if (this.extractForeign(path) === null) continue;
      if (this.hasChanged(this.lastSeen.get(path), cur)) trigger = true;
    }
    // F-2a wie in poll: bei abgebrochenem Merge bleibt lastSeen unverändert,
    // damit der nächste Scan denselben Stand erneut auslöst.
    if (trigger && !(await this.runChanged(notePath))) return;
    for (const [path, cur] of scanned) this.lastSeen.set(path, cur);
  }
}
