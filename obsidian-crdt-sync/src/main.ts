import { Notice, Plugin, TFile } from 'obsidian';
import { CrdtManager } from './crdt-manager';
import { SyncHandler, TombstoneStore, QOLLAB_DIR } from './sync-handler';
import {
  SidecarAdapter,
  DirListingCache,
  createDirListingCache,
  listYjsInDir,
  ensureSidecarFolder,
  dirname,
  statSidecar,
  sidecarExists,
  readSidecar,
  listAllSidecars,
} from './sidecar-io';
import { SidecarWatcher } from './sidecar-watcher';
import { CrdtSyncSettings, CrdtSyncSettingTab, DEFAULT_SETTINGS, generateClientId } from './settings';
import { migrateTombstones, tombstoneKey } from './tombstones';
import { PathQueue } from './path-queue';
import { threeWayMerge } from './text-merge';

// Uint8Array → ArrayBuffer für Obsidians adapter.writeBinary (das nur ArrayBuffer
// akzeptiert). encodeStateFile liefert Uint8Array.
function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  return (data instanceof Uint8Array
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : data) as ArrayBuffer;
}

// Task 14: Schlüssel der gerätelokalen Geräte-ID. App.saveLocalStorage legt sie im
// Electron-Profil ab — vault-spezifisch UND gerätelokal, also außerhalb jedes
// Datei-Syncs. In data.json (= im Vault, wird mitsynchronisiert) hat sie nichts zu
// suchen: zwei Geräte mit derselben ID schreiben denselben Sidecar-Pfad, und der
// Self-Ignore des Watchers legt den automatischen Remote-Merge still lahm.
const CLIENT_ID_KEY = 'qollab-client-id';
// Task 17/F-3: Schlüssel der gerätelokalen Einstellungen — `enabled` und die
// Tombstone-Map. Dieselbe Begründung wie bei der clientId: `data.json` liegt in
// `<vault>/.obsidian/plugins/qollab/`, also im Sync-Scope des dokumentierten
// Standard-Aufbaus. Der Kommentar in settings.ts stellte das für die clientId
// fest und zog die Konsequenz nur dort; die Tombstone-Map hieß trotzdem
// „Gerätelokal", war es aber nicht. Konkret ging dabei kaputt: `saveSettings`
// schreibt die GANZE Map, also Last-Writer-Wins statt Vereinigung; ein Tombstone
// des einen Geräts trifft auf dem anderen womöglich eine lebende Inkarnation;
// und `enabled: false` schaltet das andere Gerät still ab.
//
// `statusNotice` bleibt bewusst in `data.json`: eine reine Anzeigepräferenz ohne
// Zustandssemantik. Falsch geteilt kostet sie höchstens eine nicht angezeigte
// Meldung — sie kann weder Dateien löschen noch den Sync stilllegen.
const DEVICE_SETTINGS_KEY = 'qollab-device-settings';
// Task 19/B (Hebel 1): Fortschrittsmerker des Startup-Sweeps. Note-Pfad →
// [mtime, size] der `.md`, wie sie beim letzten Sweep aussah, als er „eigener
// Snapshot ist aktuell" festgestellt hat. Beim nächsten Start genügt der
// Vergleich gegen `TFile.stat` (In-Memory-Property, kostet nichts), um dieselbe
// Feststellung ohne einen einzigen Dateizugriff zu treffen.
//
// Gerätelokal aus demselben Grund wie DEVICE_SETTINGS_KEY: `data.json` liegt im
// Sync-Scope. Ein geteilter Merker beschriebe den Zustand des anderen Geräts und
// liesse den Sweep genau die Notes überspringen, die hier noch nie erfasst
// wurden — der Snapshot bliebe veraltet, und der erste Merge darauf löschte nie
// erfassten `.md`-Inhalt. 1 625 Einträge kosten rund 100 KB im Electron-Profil.
const SWEEP_CURSOR_KEY = 'qollab-sweep-cursor';
type SweepCursor = Record<string, [number, number]>;
// Das Sidecar-Dateiformat (`<note>.<clientId>.yjs`) verlangt exakt 8 Hex-Zeichen.
// Alles andere aus dem Speicher wird verworfen statt in Dateinamen weitergereicht.
const CLIENT_ID_RE = /^[0-9a-f]{8}$/;
// Szenariosuche Fund 37: Wortlaut der Meldung über eine fremd geschriebene eigene
// Hilfsdatei — exportiert, damit `docs-consistency.test.ts` den README-Absatz
// gegen den tatsächlichen Wortlaut halten kann statt gegen eine zweite Textkopie.
// Begründung des Wortlauts steht bei `onOwnSidecarChanged`.
export const FOREIGN_OWN_SIDECAR_NOTICE =
  'Qollab: Die Sync-Datei dieses Geräts wurde von außen verändert — entweder trägt ' +
  'ein zweites Gerät dieselbe Geräte-ID, oder es wurde eine Sicherung zurückgespielt. ' +
  'Dieses Gerät arbeitet ab jetzt unter einer neuen Geräte-ID weiter.';

export default class CrdtSyncPlugin extends Plugin {
  settings: CrdtSyncSettings;
  // Geräte-ID dieser Installation (gerätelokal, siehe CLIENT_ID_KEY).
  clientId: string;
  // Alt-ID aus data.json, nur für die einmalige Migration nach localStorage.
  private legacyClientId = '';
  private crdtManager: CrdtManager;
  private syncHandler: SyncHandler;
  private sidecarWatcher: SidecarWatcher;
  // Adapter-gestützte Sidecar-IO (.qollab/ ist für den Vault-Index unsichtbar).
  private sidecarAdapter: SidecarAdapter;
  // Gerätelokaler Tombstone-Store (Teil der Plugin-Data). Schlüssel ist das Paar
  // (notePath, guid) — siehe tombstones.ts.
  private tombstoneStore: TombstoneStore = {
    has: (guid: string, notePath: string) =>
      tombstoneKey(notePath, guid) in this.settings.tombstones,
    // Review F-4: alle Paare in-memory setzen, dann EIN saveSettings. Vorher lief
    // pro Paar ein voller data.json-Write.
    addAll: async (guids: string[], notePaths: string[]) => {
      if (guids.length === 0 || notePaths.length === 0) return;
      const deletedAt = Date.now();
      for (const guid of guids) {
        for (const notePath of notePaths) {
          this.settings.tombstones[tombstoneKey(notePath, guid)] = deletedAt;
        }
      }
      await this.saveSettings();
    },
  };
  // Guard: verhindert Endlos-Loop wenn wir selbst eine .md-Datei schreiben
  private writingPaths = new Set<string>();
  // R2: Pro-Pfad-Dedup für korrupte-Datei-Notices (einmal pro Session).
  private corruptNoticePaths = new Set<string>();
  // Task 12: Zähler für aufeinanderfolgende IO-Lesefehler pro Sidecar-Pfad. Ein
  // einzelner Fehler ist transient (EBUSY beim Sync-Write) und bleibt still; hält
  // er an, ist die Note faktisch vom Sync abgeschnitten und der Nutzer muss es
  // erfahren — sonst ist „synct nicht mehr" nicht von „alles in Ordnung"
  // unterscheidbar.
  private unreadableCounts = new Map<string, number>();
  // Task 17/F-6: derselbe Zähler für den Schreibpfad (siehe noteUnwritable).
  private unwritableCounts = new Map<string, number>();
  private static readonly UNREADABLE_NOTICE_AFTER = 3;
  // Serialisiert ALLE Doc-Mutationen pro Note-Pfad (Remote-Merge, lokale
  // Änderung, Startup-Sweep) — verhindert verschränkte Mutationen desselben
  // Y.Doc und damit verlorene Updates.
  private pathQueue = new PathQueue();
  private unloaded = false;
  // Task 17/F-2: Läuft gerade ein Startup-Sweep? Solange ja, werden Remote-Trigger
  // abgewiesen statt bedient (siehe runStartupSweep).
  private sweepRunning = false;

  async onload() {
    await this.loadSettings();
    this.clientId = await this.provisionClientId();

    this.crdtManager = new CrdtManager();
    const vault = this.app.vault;

    // Sidecars laufen ausschließlich über den Adapter — der Vault-Index ist blind
    // für den Dot-Ordner .qollab/. Die .md-Note dagegen ist indiziert und bleibt
    // auf der Vault-API (getAbstractFileByPath/read/process).
    const rawAdapter = vault.adapter;
    this.sidecarAdapter = {
      exists: (p) => rawAdapter.exists(p),
      readBinary: (p) => rawAdapter.readBinary(p),
      writeBinary: (p, data) => rawAdapter.writeBinary(p, toArrayBuffer(data)),
      remove: (p) => rawAdapter.remove(p),
      mkdir: (p) => rawAdapter.mkdir(p),
      stat: (p) => rawAdapter.stat(p),
      list: (p) => rawAdapter.list(p),
      rename: (from, to) => rawAdapter.rename(from, to),
      // Task 12: Auf Desktop (FileSystemAdapter) liest sidecar-io direkt am
      // Dateisystem statt über die verzögerte Adapter-Sicht. Duck-Typing statt
      // instanceof, damit Mobile/Test-Adapter ohne die Methode auskommen.
      getBasePath:
        typeof (rawAdapter as any).getBasePath === 'function'
          ? () => (rawAdapter as any).getBasePath() as string
          : undefined,
    };
    if (!this.sidecarAdapter.getBasePath) {
      // Einmalig beim Bind, nicht pro Aufruf: auf Mobile ist der Fallback der
      // legitime Normalfall. Benennt Obsidian getBasePath aber um, fiele Qollab
      // still auf genau die verzögerte Sicht zurück, die Task 12 ausgelöst hat.
      console.warn(
        'Qollab: kein Direktzugriff auf die Vault-Wurzel (getBasePath fehlt) — ' +
          'Sidecar-Lesezugriffe laufen über die vault.adapter-Sicht, die verzögert sein kann.'
      );
    }
    const adapter = this.sidecarAdapter;

    // Schlankes VaultLike: Vault-API für die indizierte .md, Adapter für Sidecars.
    const vaultLike = {
      getAbstractFileByPath: (p: string) => vault.getAbstractFileByPath(p),
      read: (file: { path: string }) => vault.read(file as TFile),
      adapter,
      listYjsFiles: (notePath: string, cache?: DirListingCache) =>
        listYjsInDir(adapter, notePath, cache),
    };

    this.syncHandler = new SyncHandler(
      vaultLike as any,
      this.crdtManager,
      this.clientId,
      this.tombstoneStore,
      // R2: korrupte Sidecar-Datei → einmalige Notice pro Session.
      (path: string) => {
        if (!this.corruptNoticePaths.has(path)) {
          this.corruptNoticePaths.add(path);
          new Notice(`Qollab: beschädigte Sync-Datei übersprungen: ${path}`);
        }
      },
      // Task 12: unlesbare (nicht korrupte) Sidecar → erst nach mehreren Versuchen
      // melden, damit ein transienter EBUSY nicht sofort nervt.
      (path: string) => this.noteUnreadable(path),
      // Task 17/F-6: dasselbe für den Schreibpfad.
      (path: string) => this.noteUnwritable(path),
      // Task 19/C: zwei unverwandte Änderungsketten vereinigt → melden.
      (notePath: string) => this.noteUnrelatedMerge(notePath),
      // Task 20: eine getrennt entstandene Fassung wurde verworfen → melden.
      (notePath: string, guid: string) => this.noteDiscardedIncarnation(notePath, guid)
    );

    // Eigener Wächter statt Vault-Events: Obsidian feuert für .qollab nie. Poll-Scan
    // per Intervall + Sofort-Trigger beim Öffnen einer Note.
    this.sidecarWatcher = new SidecarWatcher(
      adapter,
      this.clientId,
      async (notePath) => {
        // Rückgabe durchreichen: false = Merge abgebrochen, der Watcher darf den
        // Trigger dann nicht als verbraucht verbuchen (F-2a).
        return this.pathQueue.run(notePath, () => this.onRemoteYjsUpdate(notePath));
      },
      // Task 14: Änderungen an der EIGENEN Sidecar prüfen (Kollisionserkennung).
      (notePath, path, cur) => this.onOwnSidecarChanged(notePath, path, cur)
    );
    // Task 17/F-2: `sidecarWatcher.start` läuft NICHT hier, sondern in
    // onLayoutReady hinter dem Sweep — siehe dort.

    // Wenn Nutzer eine .md-Note bearbeitet → CRDT-State aktualisieren + speichern.
    // Read UND applyLocalContent laufen über dieselbe Queue wie der Remote-Merge:
    // so liest die Task die .md erst, nachdem ein evtl. laufender Merge sein
    // Write-Back abgeschlossen hat, statt einen stale-Text hereinzuspielen.
    //
    // Task 16: Der Write-Back gehört auch hierher, nicht nur in onRemoteYjsUpdate.
    // applyLocalContent zieht ausstehende Fremd-Sidecars ein (Task 11/12) — danach
    // ist der Doc der Datei voraus, und bis zum 30-s-Poll bliebe er das. Genau in
    // diesem Fenster tippt der Nutzer weiter (Obsidian feuert modify wenige Sekunden
    // nach jedem Tippstopp), und der nächste Diff verbuchte den Vorlauf als
    // Löschung. Es ist kein zusätzlicher Write: es ist DERSELBE, nur früher.
    //
    // Szenariosuche 2026-08-02: Der Pfad wird EINMAL festgehalten und danach
    // durchgehend verwendet — Warteschlangen-Schlüssel und Arbeitspfad müssen
    // derselbe sein. Obsidian mutiert `TFile.path` beim Umbenennen IN PLACE (der
    // rename-Handler unten verlässt sich selbst darauf: er bekommt `(file,
    // oldPath)` und liest den NEUEN Pfad aus `file.path`). Vorher wurde
    // `file.path` hier zweimal gelesen — als Schlüssel und im Rumpf erneut —,
    // und dazwischen lagen der `vault.read` UND die gesamte Wartezeit in der
    // Warteschlange.
    //
    // Fällt eine Umbenennung in dieses Fenster, hielt der Task den Schlüssel des
    // ALTEN Pfades und arbeitete auf dem NEUEN. Das ist kein Ausnahmefall: der
    // Auto-Note-Mover benennt anhand von Frontmatter/Tags um, beide Abläufe
    // entspringen also demselben Schreibvorgang — die Überlappung ist
    // strukturell.
    //
    // Der Schaden lief so: Unter dem neuen Pfad gibt es weder Doc noch Sidecar
    // (die liegen noch am alten), also prägte `ensureDoc` eine FRISCHE GUID über
    // einer lebenden Historie und baute den Doc aus dem `.md`-Text neu auf.
    // Danach zog der rename-Task die echte Historie auf denselben Pfad und
    // setzte die alte GUID zurück — der Doc im Speicher blieb der frisch
    // geprägte. Beim nächsten Abgleich galt die eigene Sidecar als kompatibel
    // (gleiche GUID) und wurde angewandt; Yjs dedupliziert nach Item-ID, nicht
    // nach Inhalt: der ganze Notiztext stand doppelt, ohne jede Meldung.
    //
    // Weicht `file.path` im Rumpf ab, wird deshalb ABGEBROCHEN statt unter dem
    // falschen Schlüssel gearbeitet — beide Alternativen wären falsch: der neue
    // Pfad ist nicht durch die Warteschlange gedeckt, und unter dem alten liefe
    // der Write-Back darunter trotzdem über das TFile-Objekt gegen den NEUEN
    // Pfad (Diff-Basis und Schreib-Guard lägen dann auf zwei verschiedenen
    // Pfaden). Der rename-Handler zieht Sidecars und Zustand ohnehin um.
    //
    // Preis des Abbruchs: Ein in `content` schon gelesener Nutzer-Edit ist danach
    // nur in der `.md`, nicht im Doc. Der erste Entwurf hielt ihn deshalb für
    // sicher — „der nächste `modify` erfasst ihn unter dem neuen Pfad,
    // spätestens der Startup-Sweep". Das gilt aber nur, solange kein FREMDER
    // Trigger dazwischenkommt (Szenariosuche Welle 2, Fund 1): Trifft vorher eine
    // Fremd-Sidecar ein, läuft `onRemoteYjsUpdate` über `data === preMerge` in
    // den Normalzweig und schreibt den Doc-Stand zurück, der den Edit nicht
    // kennt. Kein Delete-Op, keine Meldung, kein Weg zurück.
    //
    // Für exakt diesen Zustand — gelesen, nicht erfasst — gibt es seit Task
    // 12/F-2b `abortedReads`. Steht die Markierung, holt `onRemoteYjsUpdate` den
    // Lauf nach und schreibt nicht, solange er scheitert. Der Abbruch bleibt also,
    // meldet den Text aber über denselben Rückkanal wie der IO-Abbruch (siehe
    // `noteUncapturedLocalContent`). Der Preis schrumpft damit auf das, was er
    // sein sollte: ein verzögerter, kein verlorener Edit.
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (!this.settings.enabled) return;
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        const notePath = file.path;
        if (this.writingPaths.has(notePath)) return;

        await this.pathQueue.run(notePath, async () => {
          if (this.unloaded) return;
          const content = await this.app.vault.read(file);
          if (this.unloaded) return;
          if (file.path !== notePath) {
            this.syncHandler.noteUncapturedLocalContent(notePath, content);
            return;
          }
          const merged = await this.syncHandler.applyLocalContent(notePath, content);
          // Hier NICHT markieren: `applyLocalContent` ist durchgelaufen, der Edit
          // steht im Doc und in der eigenen Sidecar. Offen bleibt allein der
          // Write-Back — der bekannte, von Task 16 abgedeckte Doc-Vorlauf.
          if (this.unloaded || file.path !== notePath) return;
          await this.writeBackMerged(file, content, merged);
        });
      })
    );

    // Rename: .yjs-Dateien mitumbenennen. Gleiche Inkarnation → GUID bleibt,
    // Map-Eintrag zieht auf den neuen Pfad um.
    //
    // Über die Queue auf BEIDEN Pfaden (Task 15 Fix C). oldPath, damit ein dort
    // geparkter Task (loadAndMerge/applyLocalContent) nicht parallel zum
    // renameNote den GUID-Map-Eintrag mutiert (Orphan-.yjs + GUID-Divergenz).
    // newPath, weil der Task ausschließlich newPath-Zustand mutiert (umbenannte
    // Sidecars, guids[newPath], Doc) — delete- und modify-Tasks derselben Note
    // laufen danach auf newPath und liefen bisher auf einer davon unabhängigen
    // Kette: ein paralleles delete(newPath) zog am Rename vorbei, fand noch keine
    // GUID, setzte keinen Tombstone, und der Rename stellte die Sidecars danach
    // wieder auf (Befund 4/7). runAll nimmt beide Keys in einem Schritt —
    // verschachtelte run-Aufrufe würden newPath erst beim Body-Start belegen und
    // den Race offen lassen (siehe path-queue.ts).
    //
    // Keine verschachtelten run/runAll-Aufrufe auf `oldPath` ODER `file.path` in
    // diesem Body — beide Keys sind hier gehalten, ein verschachtelter Aufruf
    // wartet auf sich selbst und hängt (Review M-2: seit Fix C sind es zwei Keys
    // statt einem, die Falle ist doppelt so breit).
    //
    // Task 17/F-4: Dieser Handler läuft bewusst AUCH bei `enabled: false`. Er tut
    // nichts als Housekeeping — Sidecars mitziehen und den GUID-Map-Eintrag
    // umhängen; er schreibt keine Markierung und legt nichts Neues an. Stillgelegt
    // blieben die Sidecars unter dem alten Pfad als Waisen liegen, für die es
    // keinen Aufräumpfad gibt (`enabled-off-switch.test.ts` pinnt das).
    //
    // Szenariosuche F3: Der Umzug der Hilfsdateien kann scheitern, und zwar
    // deterministisch. Der Hilfsdatei-Pfad ist konstruktiv 22 Zeichen länger als
    // der Note-Pfad; ein Rename in einen tieferen Ordner reißt damit die
    // Windows-Pfadgrenze für die Hilfsdatei, während die `.md` noch passt.
    // Zweiter Auslöser: ein Sync-Dienst hält ein Handle auf die gerade
    // geschriebene `.yjs`. Die Schleife hatte kein `try`/`catch` — der erste Wurf
    // verließ den Handler, die übrigen Dateien blieben liegen, und `renameNote`
    // lief NIE.
    //
    // Warum DURCHZIEHEN und nicht zurückrollen (das war die Entwurfsfrage):
    //
    //   1. Die `.md` ist schon umgezogen. Dieser Handler ist eine Nachricht über
    //      etwas Geschehenes, kein Vorgang, der sich abbrechen ließe.
    //      „Alles oder nichts" könnte nur die HILFSDATEIEN zurückholen — und das
    //      Ergebnis wäre exakt der Schadenszustand: Note unter dem neuen Pfad,
    //      gesamter Zustand unter dem alten. Der nächste Edit findet dort weder
    //      Doc noch eigenen Stand und prägt eine frische Inkarnation über einer
    //      lebenden Historie. Ein Rollback stellte den Schaden also sicher, den er
    //      zu verhindern vorgibt.
    //   2. Ein Rollback wäre selbst wieder eine Folge von Renames auf demselben
    //      IO-Pfad, der gerade geworfen hat (gehaltenes Handle: die Rückrichtung
    //      trifft dieselbe Datei). Ein Rückweg, der halb scheitern kann, ist keine
    //      Atomarität, sondern eine zweite Sorte halber Umzüge.
    //   3. Der tragende Zustand liegt im SPEICHER (`guids`, Doc, `localDiffBase`,
    //      `priorPaths`, `ownSignatures`). Sein Umzug kostet nichts und kann nicht
    //      scheitern. Also: den Zustand IMMER der `.md` folgen lassen und danach
    //      die Platte nachziehen.
    //
    // Kein zweiter Rückkanal: Der Rückkanal aus Task 17/F-6 trägt hier, aber
    // nicht über den gescheiterten Rename — der passiert pro Pfad genau einmal
    // und erreichte die Schwelle von drei Versuchen nie. Er trägt über die
    // REPARATUR: der eigene Stand wird unter dem neuen Pfad geschrieben, und
    // dieser Write ist ein gewöhnlicher `saveState` mit Markierung, Wiederholung
    // beim nächsten Trigger und Meldung ab dem dritten Fehlversuch. Genau der
    // Fall, in dem der Nutzer handeln muss (Zielpfad dauerhaft zu lang), landet
    // damit im bestehenden Kanal statt in einem neuen daneben.
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        await this.pathQueue.runAll([oldPath, file.path], async () => {
          // Pfad EINMAL festhalten (Obsidian mutiert `TFile.path` in place, siehe
          // modify-Handler oben) — Warteschlangen-Schlüssel und Arbeitspfad.
          const neuerPfad = file.path;
          // Szenariosuche R3-F8: Ändert sich nur die Groß-/Kleinschreibung eines
          // ORDNERS, muss dessen Name auf der Platte eigens nachgezogen werden —
          // der Umzug der einzelnen Dateien unten leistet das nicht (Begründung
          // bei `ordnerSchreibweiseNachziehen`). Vor dem Listing, damit die
          // Dateien danach ohnehin schon am Ziel liegen.
          let misslungen = !(await this.ordnerSchreibweiseNachziehen(oldPath, neuerPfad));
          // Sidecars sind für den Index unsichtbar → über den Adapter listen und
          // umziehen. Zielordner ggf. anlegen (Rename in einen anderen Ordner).
          const sidecars = await listYjsInDir(this.sidecarAdapter, oldPath);
          for (const sc of sidecars) {
            const suffix = sc.slice(`${QOLLAB_DIR}/${oldPath}`.length);
            const newPath = `${QOLLAB_DIR}/${neuerPfad}${suffix}`;
            try {
              await ensureSidecarFolder(this.sidecarAdapter, dirname(newPath));
              await this.sidecarAdapter.rename(sc, newPath);
            } catch (err) {
              // Pro Datei fangen: Eine Datei, die nicht mitkommt, darf die
              // übrigen nicht am alten Pfad festhalten. Dort sind sie
              // unerreichbar — ohne `.md` steigt der Poll sofort aus und der
              // Sweep läuft nur über indizierte `.md`-Dateien.
              misslungen = true;
              // Meldungen verschwinden nach Sekunden, eine liegengebliebene
              // Fremd-Hilfsdatei bleibt. Sie kostet nichts als Platz: der Peer
              // schreibt seinen Stand nach dem Rename unter dem neuen Pfad neu.
              console.warn(`Qollab: Sync-Datei konnte nicht mitumziehen: ${sc} → ${newPath}`, err);
            }
          }
          this.syncHandler.renameNote(oldPath, neuerPfad);
          if (misslungen) await this.holeEigenenStandNach(oldPath, neuerPfad);
        });
      })
    );

    // Delete: .yjs-Dateien mitlöschen. VOR dem Löschen die GUID dieser
    // Inkarnation tombstonen — so kann eine stale fremde .yjs derselben GUID die
    // gleichnamig neu angelegte Note später nicht wiederauferstehen lassen. Über
    // die Queue, damit ein geparkter Task auf demselben Pfad nicht nach dem
    // Delete resumed und via saveState die gelöschte .yjs wieder anlegt
    // (Resurrection). Keine verschachtelten run-Aufrufe mit gleichem Key hier.
    //
    // Getombstont wird die ganze Pfad-Historie dieser Inkarnation (Review C-1),
    // nicht nur der zuletzt bewohnte Pfad: nach `alt.md → neu.md → delete` muss
    // auch eine verspätete Fremd-Sidecar unter `alt.md` als Leiche erkannt
    // werden. Ohne lokal gesehenen Rename (Zweitgerät: der Datei-Sync stellt den
    // Rename als delete+create zu) ist die Historie leer — dann bleibt es exakt
    // beim aktuellen Pfad, und Fix A gilt unverändert.
    //
    // Welche GUIDs überhaupt beerdigt werden, entscheidet `guidsToTombstone`
    // (Review F-1): normalerweise genau die eigene, bei einer nur per Sync
    // bekannten Note die der Fremd-Siblings. `null` heißt „Stand unbekannt"
    // (IO-Fehler) → kein Tombstone, aufräumen wie bisher.
    //
    // Szenariosuche R3-F4: Dieser Handler feuert auch, wenn NICHT gelöscht,
    // sondern nur lokal weggeräumt wurde. Dropbox („Selective Sync") und OneDrive
    // („Ordner auswählen") entfernen einen abgewählten Ordner von der Platte; die
    // Auswahl gilt pro Gerät, die Notizen leben auf dem anderen Gerät weiter. Das
    // README empfiehlt genau das. `.qollab/` ist ein eigener Top-Level-Baum und in
    // der Ordnerauswahl nicht sichtbar — die Hilfsdateien bleiben also liegen,
    // während die `.md` verschwindet.
    //
    // Beide Zweige unten waren dann falsch: der Tombstone traf eine LEBENDE
    // Inkarnation (und begrub sie beim Wiedereinschalten des Ordners erneut), und
    // gelöscht wurden ALLE Hilfsdateien, auch die des anderen Geräts — eine
    // Löschung, die der Datei-Sync brav dorthin zurückträgt und die dort die
    // Historie vernichtet, ohne dass dieses Gerät je etwas gelöscht hätte.
    //
    // Das Unterscheidungskriterium ist der ORDNER der Note. Ein Löschbefehl gilt
    // einer Note; das Wegräumen durch den Sync-Dienst nimmt den ganzen Ordner mit,
    // weil die Abwahl pro Ordner erfolgt. Ist der Ordner mit verschwunden, war es
    // also kein auf diese Note gerichteter Löschbefehl — dann bleibt alles liegen,
    // wie es liegt. Frisch am Dateisystem geprüft (statSidecar/sidecarExists), weil
    // Obsidians Index zum Zeitpunkt des Events nicht verlässlich nachgezogen ist.
    //
    // Was das kostet, unbeschönigt: Löscht der Nutzer selbst einen ganzen ORDNER
    // (oder tut es das andere Gerät und der Sync stellt es hier zu), sieht das
    // lokal identisch aus — dann bleiben die Hilfsdateien als Waisen liegen und es
    // gibt keinen Tombstone, der Zombie-Schutz aus Task 15/F-1 greift für diese
    // Notes also nicht. Die Abwägung ist bewusst: der Preis ist eine
    // Wiederbelebung unter genau demselben Pfad innerhalb von 90 Tagen, der Preis
    // der Gegenrichtung ist die garantierte Vernichtung der Historie auf einem
    // Gerät, das nichts getan hat, in einer vom README empfohlenen Konfiguration.
    // Für die Note direkt in der Vault-Wurzel gibt es keinen Ordner, der
    // verschwinden könnte — dort bleibt es unverändert beim alten Verhalten.
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        await this.pathQueue.run(file.path, async () => {
          // Wirft der Check, ist der Ordner-Zustand unbekannt — dann wie bei jedem
          // anderen Halbwissen in diesem Pfad (`guidsToTombstone` → `null`) die
          // nicht-destruktive Seite wählen. Liegengebliebene Hilfsdateien lassen
          // sich später aufräumen, eine gelöschte Historie nicht.
          const folder = dirname(file.path);
          const folderGone = folder
            ? await sidecarExists(this.sidecarAdapter, folder).then(
                (exists) => !exists,
                () => true
              )
            : false;
          // Task 17/F-4: „aus" heißt keine neuen Markierungen. Ein Tombstone ist
          // eine Zustandsänderung mit 90 Tagen Halbwertszeit, und ein
          // sync-vermittelter Rename kommt als delete+create an — das
          // ausgeschaltete Plugin beerdigte damit eine LEBENDE Inkarnation. Das
          // Sidecar-Housekeeping darunter läuft weiter: unterbliebe es, blieben
          // Waisen liegen, die niemand mehr aufräumt.
          const guids =
            this.settings.enabled && !folderGone
              ? await this.syncHandler.guidsToTombstone(file.path)
              : null;
          if (guids) {
            await this.tombstoneStore.addAll(
              guids,
              this.syncHandler.incarnationPaths(file.path)
            );
          }
          // Sidecars über den Adapter listen und entfernen (Index-blind).
          // R3-F4: nicht, wenn der Ordner mit verschwunden ist — die Hilfsdateien
          // sind dann der einzige Träger der Historie, und ihre Löschung wäre das,
          // was der Sync zum anderen Gerät zurückträgt.
          if (!folderGone) {
            const sidecars = await listYjsInDir(this.sidecarAdapter, file.path);
            for (const sc of sidecars) await this.sidecarAdapter.remove(sc);
          }
          // Der In-Memory-Zustand geht in beiden Fällen: die Note ist jetzt nicht
          // da. Kehrt sie zurück, baut `ensureDoc` den Doc aus der liegen
          // gebliebenen eigenen Sidecar mit derselben GUID wieder auf.
          this.syncHandler.disposeNote(file.path);
        });
      })
    );

    this.addSettingTab(new CrdtSyncSettingTab(this.app, this));

    // Externe FS-Edits (z.B. CLI/LLM bei geschlossener App) erzeugen kein
    // 'modify'-Event. Beim Start nachziehen: fuer jede .md, deren mtime
    // neuer ist als die zugehoerige .yjs (oder die noch keine .yjs hat),
    // die lokale Aenderung via applyLocalContent in den CRDT bringen.
    // applyLocalContent bootstrappt den Doc aus dem persistierten eigenen State
    // (nicht aus dem Text) und diff-merged nur die lokale Aenderung ein. Hat
    // dieses Geraet noch keinen eigenen State, werden fremde Sibling-.yjs-Files
    // als Basis adoptiert (Sibling-Adoption). KEIN loadAndMerge — ein explizites
    // Hereinholen fremder .yjs-Staende findet im Sweep nicht statt.
    //
    // Reihenfolge zwingend: ERST der Sweep (aktualisiert die lokalen Snapshots
    // aller stale .md via applyLocalContent), DANN der Initial-Scan des
    // Watchers (merged alle beim Start vorhandenen fremden Sidecars). Andernfalls
    // würde man mergen, bevor die lokalen Snapshots aktuell sind — der Initial-
    // Scan schließt die Lücke, dass bei geschlossener App angekommene Remote-
    // Stände sonst nie gemergt wurden.
    //
    // Task 17/F-2: Deshalb werden Poll-Intervall und `file-open`-Listener auch erst
    // HIER registriert, nach dem Sweep. Bis Task 17 standen sie in `onload` — und
    // zwischen `onload` und `onLayoutReady` liegt der ganze Layout-Restore, in dem
    // Obsidian `file-open` für die zuletzt offene Note feuert. Ein Trigger auf eine
    // noch nicht gesweepte Note lief in `loadAndMerge` (own-Branch, der den
    // `.md`-Text bewusst nicht einspielt), und der Write-Back schrieb über
    // `data === preMerge` den nur in der Datei lebenden Inhalt weg — in Datei UND
    // CRDT, auf beiden Geräten. Der frühere Reihenfolge-Kommentar galt nur für den
    // einen awaiteten `poll()`-Aufruf; die zwei ungebundenen Pfade waren nirgends
    // erzwungen.
    //
    // Die Promise wird zurückgegeben statt mit `void` verworfen: Obsidian ignoriert
    // den Rückgabewert von `onLayoutReady`, aber ein Test kann den Start-Ablauf so
    // deterministisch abwarten, statt auf Microtask-Reihenfolge zu hoffen.
    //
    // Task 17/R-2: Der Sweep-Aufruf ist deshalb gekapselt. Wirft er, hing bis
    // hierher die ganze Sitzung: `startSidecarWatcher()` wurde nie erreicht, es
    // gab weder Intervall noch `file-open` und damit KEINEN einzigen
    // Remote-Merge mehr — lautlos, weil `onLayoutReady` den Rückgabewert
    // ignoriert. Bis `5c169dc` stand `start()` in `onload` und war davon
    // unabhängig; das Gate ist die Korrektheitsbedingung, nicht der Wurf. Die
    // Reihenfolge bleibt erzwungen (der Start liegt weiter HINTER dem Sweep),
    // nur seine Existenz hängt nicht mehr am Erfolg.
    this.app.workspace.onLayoutReady(() => {
      return (async () => {
        try {
          await this.runStartupSweep();
        } catch (err) {
          // Nicht still verschlucken: ohne vollständigen Sweep sind die lokalen
          // Snapshots der nicht erfassten Notes veraltet.
          console.error('Qollab: Startup-Sweep abgebrochen', err);
        }
        if (this.unloaded) return;
        this.startSidecarWatcher();
        await this.sidecarWatcher.poll();
      })();
    });
  }

  // Registriert die beiden Trigger-Quellen des Watchers. Getrennt von `onload`,
  // damit die Reihenfolge „erst Sweep, dann Trigger" ablesbar ist (Task 17/F-2).
  private startSidecarWatcher(): void {
    this.sidecarWatcher.start({
      registerInterval: (fn, ms) => {
        const id = window.setInterval(fn, ms);
        this.registerInterval(id);
        return () => window.clearInterval(id);
      },
      onFileOpen: (cb) => {
        const ref = this.app.workspace.on('file-open', (file) =>
          cb(file instanceof TFile ? file.path : null)
        );
        this.registerEvent(ref);
        return () => this.app.workspace.offref(ref);
      },
    });
  }

  // Task 17/F-2: Der Sweep als aufrufbare Operation mit Gate. Solange er läuft,
  // beantwortet `onRemoteYjsUpdate` jeden Trigger mit `false` — der Watcher
  // verbucht ihn dann nicht (`sidecar-watcher.ts:137`), hält ihn offen und
  // wiederholt ihn. Das ist eine Korrektheitsbedingung, keine Performance-Frage:
  // vor Sweep-Ende sind die lokalen Snapshots nicht aktuell, und ein Merge auf
  // dieser Grundlage löscht nie erfassten `.md`-Inhalt.
  //
  // Die Registrierung in onLayoutReady schließt das Startfenster strukturell; das
  // Gate deckt die Fälle ab, in denen der Watcher bereits läuft — heute das
  // Wieder-Einschalten des Sync-Schalters (Task 17/F-5).
  async runStartupSweep(): Promise<void> {
    this.sweepRunning = true;
    try {
      await this.snapshotStaleMarkdownFiles();
    } finally {
      this.sweepRunning = false;
    }
  }

  // Zählt Lesefehler pro Sidecar-Pfad und meldet einmalig, sobald die Datei
  // dauerhaft unlesbar wirkt.
  //
  // R2-3: Die Dedup-Menge `corruptNoticePaths` wird sich mit der Korrupt-Notice
  // BEWUSST geteilt — ein Pfad, der bereits als „beschädigt" gemeldet wurde, meldet
  // sich nie zusätzlich als „nicht lesbar" und umgekehrt. Für den Nutzer sind beides
  // dieselbe Aussage („diese Datei blockiert den Sync"); zwei Meldungen zum selben
  // Pfad wären Lärm. Also: höchstens eine Meldung pro Pfad und Session.
  private noteUnreadable(path: string): void {
    const count = (this.unreadableCounts.get(path) ?? 0) + 1;
    this.unreadableCounts.set(path, count);
    if (count < CrdtSyncPlugin.UNREADABLE_NOTICE_AFTER) return;
    if (this.corruptNoticePaths.has(path)) return;
    this.corruptNoticePaths.add(path);
    new Notice(`Qollab: Sync-Datei wiederholt nicht lesbar — Note synct nicht: ${path}`);
  }

  // Task 17/F-6: Gegenstück für den Schreibpfad — dieselbe Schwelle, dieselbe
  // Dedup-Menge. Ein einzelner fehlgeschlagener Write ist transient (das Sync-Tool
  // hält kurz ein Handle) und wird vom nächsten Trigger nachgeholt; hält er an, ist
  // die Note faktisch vom Sync abgeschnitten, und genau das war bisher von „alles
  // in Ordnung" nicht unterscheidbar. Eigener Zähler, damit sich Lese- und
  // Schreibfehler nicht gegenseitig über die Schwelle heben — es sind zwei
  // verschiedene Störungen.
  private noteUnwritable(path: string): void {
    const count = (this.unwritableCounts.get(path) ?? 0) + 1;
    this.unwritableCounts.set(path, count);
    if (count < CrdtSyncPlugin.UNREADABLE_NOTICE_AFTER) return;
    if (this.corruptNoticePaths.has(path)) return;
    this.corruptNoticePaths.add(path);
    new Notice(`Qollab: Sync-Datei kann nicht geschrieben werden — Note synct nicht: ${path}`);
  }

  // Szenariosuche R3-F8: Der Hilfsdatei-Ordner muss die Schreibweise des neuen
  // Note-Pfads tragen. Rückgabe `false` = die Angleichung war nötig und ist
  // gescheitert (behandelt wie jede andere nicht mitgekommene Datei).
  //
  // Warum das nicht der Datei-Umzug unten erledigt — an NTFS gemessen, nicht
  // hergeleitet: Ein `rename` löst das ZIELVERZEICHNIS case-insensitiv auf und
  // setzt nur den BLATTnamen. `rename('.qollab/Ordner/a.md.x.yjs',
  // '.qollab/ordner/a.md.x.yjs')` legt die Datei also wieder in `Ordner` ab; das
  // Verzeichnis behält seinen Namen. Und es wirft dabei nicht — Obsidians
  // `FileSystemAdapter.rename` nimmt eine reine Schreibweisen-Umbenennung von der
  // „Destination file already exists"-Prüfung ausdrücklich aus. Für den Handler
  // sah der Umzug damit gelungen aus: keine Warnung, kein `misslungen`, keine
  // Reparatur. Auch `ensureSidecarFolder` half nicht — sein Existenz-Check ist
  // ebenfalls blind für die Schreibweise und legt deshalb nichts an, und ein
  // späterer `saveState` schreibt zwar in die richtige Datei, ändert ihren Namen
  // aber nie (auch gemessen).
  //
  // Was daraus folgt, ist der eigentliche Schaden: Der Wächter rechnet den
  // Note-Pfad aus dem DATEINAMEN zurück (`QOLLAB_RE`) und bekommt die alte
  // Schreibweise. `getAbstractFileByPath` ist laut `obsidian.d.ts` case sensitive,
  // findet dort also keine Note — und `onRemoteYjsUpdate` verbucht den Trigger
  // als erledigt („verwaiste Hilfsdatei"). Der Stand des anderen Geräts erreicht
  // die Note ab da nie mehr, ohne jede Meldung.
  //
  // Zugestellt wird der Fall als gewöhnliches Rename-Event je `.md`: Obsidians
  // Adapter feuert beim Umbenennen eines Ordners `renamed` zusätzlich für jeden
  // Nachfahren. Die Angleichung ist deshalb idempotent — der zweite Aufruf findet
  // den Ordner schon richtig benannt vor.
  //
  // Ausschließlich für den Fall „unterscheidet sich NUR in der Schreibweise". Ein
  // echter Ordnerwechsel läuft unverändert über den Datei-Umzug unten; dort ist
  // der Zielordner ein anderer und wird regulär angelegt.
  private async ordnerSchreibweiseNachziehen(
    altePfadNote: string,
    neuePfadNote: string
  ): Promise<boolean> {
    const alt = dirname(`${QOLLAB_DIR}/${altePfadNote}`);
    const neu = dirname(`${QOLLAB_DIR}/${neuePfadNote}`);
    if (alt === neu) return true;
    if (alt.toLowerCase() !== neu.toLowerCase()) return true;
    // Gleiche Länge (nur Schreibweise), also gibt es genau eine erste
    // abweichende Stelle — und nur dieser eine Ordner wird umbenannt. Die
    // tieferen Segmente sind unverändert und ziehen als Inhalt mit.
    const altT = alt.split('/');
    const neuT = neu.split('/');
    const i = altT.findIndex((s, k) => s !== neuT[k]);
    const von = altT.slice(0, i + 1).join('/');
    const nach = neuT.slice(0, i + 1).join('/');
    // Ohne Hilfsdatei-Ordner gibt es nichts anzugleichen — kein Fehlerfall.
    if (!(await sidecarExists(this.sidecarAdapter, von))) return true;
    try {
      await this.sidecarAdapter.rename(von, nach);
      return true;
    } catch (err) {
      console.warn(`Qollab: Sync-Ordner konnte nicht mitumziehen: ${von} → ${nach}`, err);
      return false;
    }
  }

  // Szenariosuche F3, zweite Hälfte des Fixes: Nach einem unvollständigen Umzug
  // MUSS der eigene Stand unter dem neuen Pfad liegen.
  //
  // Warum genau diese eine Datei und keine andere: Die eigene Hilfsdatei ist die
  // einzige, deren Fehlen den Zustand kippt. `ensureDoc` liest unter dem neuen
  // Pfad zuerst sie; fehlt sie, läuft der Adopt-Zweig und setzt `guids[newPath]`
  // NEU — er überschreibt also genau den Eintrag, den `renameNote` gerade
  // hinübergezogen hat, und prägt ohne adoptierbares Gegenüber eine frische
  // Inkarnation über einer lebenden Historie. Liegengebliebene FREMDE Dateien
  // kippen nichts: ihre Ops stecken längst im Doc, und der Peer schreibt seinen
  // Stand nach dem Rename ohnehin unter dem neuen Pfad neu.
  //
  // Zwei Wege, in dieser Reihenfolge:
  //   1. Es gibt einen lebenden Doc → aus ihm schreiben. Das ist der frischeste
  //      Stand und derselbe Schreibpfad wie im Normalbetrieb, inklusive
  //      Markierung/Wiederholung/Meldung aus Task 17/F-6, falls auch er scheitert
  //      (der dauerhaft zu lange Zielpfad landet damit im bestehenden Kanal).
  //   2. Kein Doc — der Regelfall beim Umbenennen einer in dieser Sitzung nie
  //      angefassten Note → die liegengebliebene eigene Datei kopieren. `rename`
  //      ist gescheitert, Lesen+Schreiben ist ein anderer Systemaufruf und kann
  //      gelingen. Ohne diesen Zweig bliebe genau der häufigste Rename ungeheilt.
  //      KEIN `saveState` hier: ohne Doc schriebe er einen LEEREN Stand unter die
  //      lebende Kennung — die Schadensklasse aus Task 17/F-1.
  //
  // Erst wenn der Stand nachweislich am neuen Pfad liegt, wird die alte Datei
  // entfernt. Eine eigene Hilfsdatei mit lebender Kennung unter einem Pfad ohne
  // Note ist der Wiederbelebungs-Vektor: wird dort je wieder eine gleichnamige
  // Note angelegt, adoptiert `ensureDoc` die alte Inkarnation samt Text. Gelöscht
  // wird ausschließlich die EIGENE Datei und ausschließlich nach erfolgreicher
  // Verdopplung ihres Inhalts — fremde Historie stirbt hier nie auf Verdacht.
  private async holeEigenenStandNach(altePfadNote: string, neuePfadNote: string): Promise<void> {
    const ziel = this.syncHandler.stateFilePath(neuePfadNote);
    const quelle = this.syncHandler.stateFilePath(altePfadNote);
    if (quelle === ziel) return;
    try {
      // Die eigene Datei war vielleicht gar nicht die gescheiterte.
      if (await sidecarExists(this.sidecarAdapter, ziel)) return;
      if (this.settings.enabled && this.crdtManager.hasDoc(neuePfadNote)) {
        await this.syncHandler.saveState(neuePfadNote);
        // Auch der Write ist gescheitert: `saveState` hat markiert und gemeldet,
        // der nächste Trigger wiederholt ihn. Die alte Datei bleibt dann liegen —
        // sie ist in diesem Moment der einzige Träger der Historie.
        if (this.syncHandler.hasUnpersistedState(neuePfadNote)) return;
      } else {
        const bytes = await readSidecar(this.sidecarAdapter, quelle);
        if (bytes === null) return; // nichts da, was nachzuziehen wäre
        await ensureSidecarFolder(this.sidecarAdapter, dirname(ziel));
        await this.sidecarAdapter.writeBinary(ziel, bytes);
      }
    } catch {
      // Zielpfad dauerhaft unbeschreibbar (zu lang) oder Quelle unlesbar. Derselbe
      // Zähler und dieselbe Meldung wie für jeden anderen Schreibfehler an diesem
      // Pfad — die Wiederholung liefert der nächste `saveState` derselben Note.
      this.noteUnwritable(ziel);
      return;
    }
    // Eigener Zweig, damit ein scheiterndes `remove` nicht als Schreibfehler am
    // ZIEL gezählt wird — dort steht der Stand ja gerade. Bleibt die Leiche
    // liegen, kostet das nur den Wiederbelebungs-Vektor unter dem alten Pfad.
    try {
      await this.sidecarAdapter.remove(quelle);
    } catch {
      console.warn(`Qollab: alte Sync-Datei blieb nach dem Umbenennen liegen: ${quelle}`);
    }
  }

  // Task 19/C — die Note wurde auf zwei Geräten getrennt weiterentwickelt, und
  // beide Fassungen stecken jetzt untereinander in der Datei.
  //
  // Warum überhaupt eine Meldung: Bis hierher war der einzige Hinweis in dieser
  // Lage die Routine-Meldung „automatisch gemergt" — dieselbe, die auch ein
  // gewöhnlicher, sauber aufgelöster Merge auslöst. Sie ist damit weder
  // unterscheidbar noch aussagekräftig, und über `statusNotice` abschaltbar. Der
  // nicht automatisch auflösbare Fall wäre dann vollständig stumm gewesen.
  //
  // Warum sie NICHT an `statusNotice` hängt: Der Schalter heißt „Meldung bei
  // automatischem Merge" und regelt den Routinefall. Hier ist gerade nichts
  // routinemäßig aufgegangen; wer die Routine-Meldungen abstellt, hat damit nicht
  // entschieden, auch die Konfliktanzeige abzustellen.
  //
  // Warum eine Meldung und keine Konfliktkopie: Beide Fassungen sind bereits in
  // der Datei (das ist der Sinn der Vereinigung). Eine zusätzliche Kopie
  // dupliziert, was ohnehin dasteht, erzeugt eine zweite zu synchronisierende
  // Datei samt eigener Hilfsdatei und beantwortet die einzige offene Frage —
  // „was davon ist doppelt?" — auch nicht. Ein Vermerk IM Text scheidet aus: er
  // wäre auf jedem Gerät ein anderer Text und damit selbst eine Änderung, die
  // synchronisiert und wieder vereinigt werden müsste (gemessen in
  // `task-19-report.md`).
  //
  // Wortlaut ohne Fachbegriffe: keine „Inkarnation", kein „CRDT", keine
  // „Hilfsdatei" — die Empfängerin soll wissen, was passiert ist und was sie tun
  // kann, nicht wie es intern heißt. Dedup wie bei den anderen Kanälen: höchstens
  // eine Meldung je Notiz und Sitzung, sonst meldet ein Startup-Sweep über einen
  // frisch geteilten Vault hundertfach.
  private unrelatedNoticePaths = new Set<string>();
  private noteUnrelatedMerge(notePath: string): void {
    if (this.unrelatedNoticePaths.has(notePath)) return;
    this.unrelatedNoticePaths.add(notePath);
    const name = (notePath.split('/').pop() ?? notePath).replace(/\.md$/, '');
    new Notice(
      `Qollab: „${name}" wurde auf zwei Geräten getrennt bearbeitet. ` +
        `Beide Fassungen stehen jetzt untereinander in der Notiz — ` +
        `bitte einmal durchsehen, Absätze können doppelt vorkommen.`,
      15000
    );
    // Für die Fehlersuche: der volle Pfad, den die Meldung bewusst weglässt.
    console.warn(`Qollab: unverwandte Stände vereinigt in ${notePath}`);
  }

  // Task 20 — das Gegenstück zu `noteUnrelatedMerge`.
  //
  // Warum es das braucht: Die Meldung oben feuert nur, wo tatsächlich VEREINIGT
  // wird, also auf dem Gerät, das seine Kette aufgibt. Gewinnt die eigene Kette
  // den Tie-Break, wird die fremde still verworfen — auf genau diesem Gerät
  // fehlt danach der Text des anderen, und bisher sagte niemand etwas. Im
  // Realtest (2026-07-31, r25/r27) schwieg das Plugin dort über beide Kanäle,
  // während der fremde Beitrag verschwand; welche Seite es trifft, entscheidet
  // der Vergleich zweier Zufallskennungen.
  //
  // Anderer Wortlaut als oben, weil es die umgekehrte Lage ist: Dort stehen
  // beide Fassungen untereinander (zu viel), hier fehlt eine (zu wenig).
  private discardedNoticePaths = new Set<string>();
  private discardedSummaryShown = false;
  // Erste Meldungen einzeln, danach gesammelt. Ein frisch geteilter Vault kann
  // Dutzende betroffene Notizen auf einmal haben — einzeln gemeldet wäre das
  // eine Meldungsflut, die niemand liest und die den Hinweis entwertet.
  private static readonly DISCARDED_NOTICE_MAX = 3;
  private noteDiscardedIncarnation(notePath: string, guid: string): void {
    // Szenariosuche 2026-07-31: Der Merker hängt an (Pfad, Kette), nicht am Pfad
    // allein. Vorher verbrauchte die erste Meldung den Pfad — traf danach die
    // Kette eines DRITTEN Geräts ein, deren Text wirklich fehlte, blieb es
    // stumm, auch im Log. Bei zwei Geräten fiel das nicht auf, weil es je Notiz
    // nur eine fremde Kette geben kann; ab drei wird aus einem Fehlalarm ein
    // stilles Verschweigen.
    const merker = `${notePath}\u0000${guid}`;
    if (this.discardedNoticePaths.has(merker)) return;
    this.discardedNoticePaths.add(merker);
    console.warn(`Qollab: getrennt entstandene Fassung verworfen in ${notePath} (${guid})`);

    if (this.discardedNoticePaths.size <= CrdtSyncPlugin.DISCARDED_NOTICE_MAX) {
      const name = (notePath.split('/').pop() ?? notePath).replace(/\.md$/, '');
      new Notice(
        `Qollab: Von „${name}" gibt es eine zweite, getrennt entstandene Fassung. ` +
          `Sie wurde hier nicht übernommen. Läuft das andere Gerät noch, holt ` +
          `Qollab den Text meist von selbst nach — bleibt er aus, muss er von ` +
          `Hand übertragen werden.`,
        15000
      );
      return;
    }
    // Ab hier genau eine Sammelmeldung. Bewusst ohne laufende Zählung: Die
    // genaue Zahl stünde erst fest, wenn alle Notes durch sind, und dafür
    // müsste die Meldung aus dem laufenden Merge herausgelöst und nachgezogen
    // werden. Der Nutzen rechtfertigt das nicht — wie viele es genau sind, steht
    // vollständig im Log, und die Handlung ist in jedem Fall dieselbe.
    if (this.discardedSummaryShown) return;
    this.discardedSummaryShown = true;
    new Notice(
      `Qollab: Auch von weiteren Notizen gibt es getrennt entstandene Fassungen, ` +
        `die hier nicht übernommen wurden. Die vollständige Liste steht in der Konsole.`,
      15000
    );
  }

  // Task 16: Ergibt der lokale Merge einen Text, der von der .md abweicht (der Doc
  // hat einen Fremd-Stand aufgenommen, den die Datei nicht hat), sofort
  // zurückschreiben statt auf den 30-s-Poll zu warten. Danach entsteht der
  // Vorlauf-Zustand im Normalbetrieb gar nicht mehr.
  //
  // Geschrieben wird nur, wenn die Datei noch genau den Text trägt, den wir gemergt
  // haben — dieselbe Regel wie beim Write-Back in onRemoteYjsUpdate: hat der Nutzer
  // während der Sidecar-IO gespeichert, würde ein blinder Write seinen Edit
  // löschen. Dann bleibt der Doc voraus, und der Schutz liegt bei der korrekten
  // Diff-Basis (`SyncHandler.localDiffBase`) — deshalb braucht Task 16 beide Hälften.
  //
  // `writingPaths` unterdrückt das modify-Event dieses Writes. Kommt es dennoch
  // (Obsidian feuert nach dem finally), ist es ein No-op: `content === mergedText`
  // in mergeForLocalDiff fängt es ab.
  //
  // Review F-7 (latent, heute unerreichbar): Das `delete` im `finally` prüft nicht,
  // ob DIESER Aufruf den Guard gesetzt hat. Beide heutigen Aufrufer (modify-Handler,
  // Startup-Sweep) halten ihn nicht selbst, und die PathQueue serialisiert sie pro
  // Pfad — der Fall tritt also nicht ein. Käme ein Aufrufer dazu, der `writingPaths`
  // schon hält (wie `onRemoteYjsUpdate` es um seine beiden Writes tut), höbe dieses
  // `delete` den äußeren Guard mitten im Write auf, und Obsidians modify-Event
  // liefe als fremder Edit in den Handler. Dieselbe Klasse wie der bereits
  // dokumentierte Verschachtelungs-Hazard der PathQueue: wer hier einen dritten
  // Aufrufer ergänzt, muss den Besitz mitführen (setzen nur, wenn nicht schon
  // gesetzt; löschen nur, wenn selbst gesetzt).
  private async writeBackMerged(
    file: TFile,
    expected: string,
    merged: string | undefined
  ): Promise<void> {
    if (merged === undefined || merged === expected) return;
    // Szenariosuche 2026-07-31: Pfad EINMAL festhalten. Obsidian mutiert
    // `TFile.path` beim Umbenennen in place (der rename-Handler verlässt sich
    // selbst darauf). Wurde hier zweimal gelesen, setzte der Guard auf den alten
    // Pfad und gab den neuen frei — der alte blieb dauerhaft in der Menge, und
    // von da an verwarf der modify-Handler JEDES Ereignis für diesen Pfad,
    // während der Poll weiter darüber schrieb.
    const bewachterPfad = file.path;
    this.writingPaths.add(bewachterPfad);
    let changed = false;
    try {
      await this.app.vault.process(file, (data) => {
        if (data !== expected) return data;
        changed = true;
        return merged;
      });
    } catch {
      // Review F-2 (Nebenbefund): Der Write kann werfen (EBUSY durch den
      // Sync-Dienst, volles Volume, read-only). Vor Task 16 schrieb dieser Pfad die
      // .md nicht und konnte hier nicht werfen — ohne `catch` verlässt der Wurf den
      // modify-Handler als unbehandelte Promise-Rejection. Verschluckt wird er
      // bewusst: der lokale Stand ist bereits erfasst und persistiert
      // (`applyLocalContent`), und der Write-Back in `onRemoteYjsUpdate` holt den
      // Schreibversuch beim nächsten Poll nach. Ein Rückkanal an die Nutzerin ist
      // ausdrücklich Task 17 (Schreibfehler-Rückkanal).
      changed = false;
    } finally {
      this.writingPaths.delete(bewachterPfad);
    }
    // Szenariosuche 2026-08-02, zweite Hälfte: Der Guard hielt den Pfad bereits
    // fest, alles NACH dem `await` las ihn aber erneut — `noteLocalDiffBase` unten
    // und der Dateiname in der Meldung. Fällt eine Umbenennung in das
    // Schreibfenster (der Auto-Note-Mover reagiert auf genau diesen Write), lagen
    // Guard und Diff-Basis auf zwei verschiedenen Pfaden: bewacht wurde der alte,
    // gemerkt der neue. Ein Lauf, der Zustand unter einem Pfad schreibt, dessen
    // Warteschlangen-Schlüssel er nie gehalten und dessen Schreib-Guard er nie
    // gesetzt hat, ist genau die Konstellation, aus der die belegte Verdopplung im
    // modify-Handler entstanden ist.
    //
    // Deshalb hier ABBRECHEN statt unter dem falschen Pfad zu merken. Verloren
    // geht dabei nichts: `renameNote` zieht die zuletzt gesehene `.md` vom alten
    // auf den neuen Pfad um, und diese Basis ist der Stand VOR dem Write —
    // `mergeForLocalDiff` fängt den Vorlauf beim nächsten `modify` über
    // `content === mergedText` ab. Die Meldung entfällt mit, sie nennte sonst
    // einen Namen, unter dem dieser Lauf nie gearbeitet hat.
    if (file.path !== bewachterPfad) return;
    // Review F-2: Die Basis erst NACH dem bestätigten Write setzen. Im Callback
    // gesetzt, stand sie auf `merged`, während die Datei nach einem gescheiterten
    // Write weiter `expected` trug — der nächste `modify` difft dann „merged →
    // expected", also genau die Löschung des Fremd-Edits, die dieser Task
    // verhindern soll (gemessen: FREMD=0). `changed` ist nur true, wenn der Callback
    // `merged` zurückgegeben hat UND `process` durchgelaufen ist.
    if (changed) this.syncHandler.noteLocalDiffBase(bewachterPfad, merged);
    // Dieselbe Meldung wie beim Write-Back in onRemoteYjsUpdate: für den Nutzer ist
    // es dasselbe Ereignis („die Note wurde automatisch zusammengeführt"), nur
    // ausgelöst vom eigenen Tippen statt vom Poll. Ohne sie verschwände das Signal
    // genau in den Fällen, die dieser Write-Back dem Poll vorwegnimmt.
    if (changed && this.settings.statusNotice) {
      new Notice(`CRDT Sync: ${file.name} automatisch gemergt.`);
    }
  }

  // Task 19/B (Hebel 1): Merker lesen. Alles, was nicht exakt die erwartete Form
  // hat, wird verworfen statt repariert — ein verlorener Merker kostet genau
  // einen vollen Sweep (das heutige Verhalten), ein fehlinterpretierter kostet
  // einen übersprungenen Offline-Edit.
  private loadSweepCursor(): SweepCursor {
    const raw = this.app.loadLocalStorage(SWEEP_CURSOR_KEY);
    if (typeof raw !== 'object' || raw === null) return {};
    const out: SweepCursor = {};
    for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'number' &&
        typeof value[1] === 'number'
      ) {
        out[path] = [value[0], value[1]];
      }
    }
    return out;
  }

  private saveSweepCursor(cursor: SweepCursor): void {
    this.app.saveLocalStorage(SWEEP_CURSOR_KEY, cursor);
  }

  // Szenariosuche R2-35: `.qollab` von Hand gelöscht.
  //
  // Der Ordner trägt ausschließlich Binärdateien und erklärt sich nirgends —
  // gelöscht wird er deshalb aus denselben Gründen wie jeder unbekannte Ordner
  // (aufräumen, Speicherplatz, Sync-Ordner sortieren). Die Löschung synct mit,
  // also verlieren BEIDE Geräte ihre Historie.
  //
  // Ohne diese Prüfung ist der Zustand endgültig und still: Der Merker sagt für
  // jede unveränderte `.md` „eigener Snapshot ist aktuell" und überspringt sie
  // ohne einen einzigen Dateizugriff — eine Aussage, die nach dem Verlust falsch
  // ist. Der Merker deckt bewusst nur die eine Feststellung ab (siehe oben), und
  // deren einzige Voraussetzung, die eigene Sidecar, ist weg. Er beschreibt
  // damit einen Snapshot, den es nicht mehr gibt, und hält den Sweep dauerhaft
  // von der Platte fern. Für die Nutzerin ist „synct nicht mehr" von „alles in
  // Ordnung" nicht unterscheidbar.
  //
  // Szenariosuche Welle 2, Fund 3: Die Feststellung wird PRO NOTIZ getroffen, so
  // genau wie der Merker geführt wird. Der erste Entwurf fragte den ganzen Baum
  // („gibt es überhaupt noch eine Datei?") und nannte das exakt — es war
  // all-or-nothing, während der Merker pro Notiz gilt. Eine einzige überlebende
  // Datei irgendwo im Baum hielt jeden anderen Eintrag warm, und jede betroffene
  // Notiz wurde weiter ohne einen einzigen Dateizugriff übersprungen, stumm und
  // dauerhaft. Zwei alltägliche Auslöser: der Teilverlust eines Unterordners, und
  // der Vollverlust bei LAUFENDER App — Obsidian feuert für Dot-Ordner keine
  // Events, und der nächste `saveState` legt `.qollab` mit genau EINER Datei neu
  // an. Hier reproduziert in `wechselwirkung-2026-08-03.test.ts` (A1, A2); eine
  // zweite, unabhängige Linse hat denselben Befund am echten Dateisystem gemessen
  // (1638 Notizen: 0 Meldungen, 0 von 25 Notizen wieder im Sync über mehrere
  // Neustarts — fremde Messung, hier nicht nachgestellt).
  //
  // Die Feststellung pro Notiz ist EXAKT, keine Heuristik: Ein Merker-Eintrag
  // heißt „der eigene Snapshot dieser Notiz war aktuell"; seine einzige
  // Voraussetzung ist die eigene Sidecar. Fehlt sie, ist die Aussage falsch und
  // der Eintrag fällt weg — die Notiz wird beim laufenden Sweep wieder voll
  // angesehen. Eine Neuinstallation fällt nicht darunter: der Merker liegt
  // gerätelokal (siehe SWEEP_CURSOR_KEY) und ist dort leer, weshalb die Prüfung
  // gar nicht erst läuft.
  //
  // KOSTEN, gemessen statt geschätzt — echtes Dateisystem, 1638 Notizen in 121
  // Ordnern, 3276 Sidecars (zwei Geräte), Median aus drei Läufen:
  //
  //   alt   Abbruch beim ersten Fund (1 readdir)          0,8 –   1,3 ms
  //   neu   ein rekursives Listing + Set                   87 –  123 ms
  //   ALT.  ein `statSidecar` je Merker-Eintrag           396 –  498 ms
  //   Bezug was der Watcher-Poll ALLE 30 s ohnehin tut    851 –  965 ms
  //         (dasselbe Listing plus ein stat je Datei)
  //
  // Der Aufpreis von ~95 ms fällt EINMAL pro Start an, in einem Plugin, das
  // dieselbe Baumwanderung alle 30 s macht und dabei rund das Zehnfache
  // ausgibt. Die naheliegende Alternative — pro Merker-Eintrag ein `stat` —
  // kostet das Vierfache und stünde in keinem Verhältnis zu dem, was der Merker
  // einspart (Task 19/B: 301 → 7 ms).
  //
  // GEHEILT wird damit: die Blindheit und das Schweigen. NICHT geheilt wird der
  // Verlust selbst — die Historie ist weg und lässt sich nicht rekonstruieren.
  // Insbesondere prägt der folgende volle Sweep NICHTS neu: Task 13/B (ohne
  // adoptierbare Fremd-Sidecar wird nicht geprägt) bleibt in Kraft, und das ist
  // hier die eigentliche Auflage. Prägten beide Geräte dieselbe Note unabhängig
  // neu, entstünden zwei unabhängige Op-Ketten — der Erstkontakt-Fall, für den
  // Koordination über einen Datei-Sync beweisbar unmöglich ist (sechs
  // Lösungswege belegt ausgeschlossen). Der Fall wird gemeldet, nicht gelöst.
  // Zurück in den Sync kommt eine Note über einen echten Edit (modify-Handler,
  // also genau ein prägendes Gerät) oder über die Adoption einer wieder
  // eingetroffenen Fremd-Sidecar — beides bestehende Pfade, die der verworfene
  // Merker lediglich wieder erreichbar macht.
  //
  // Szenariosuche Welle 2, Fund 2: Diese Methode wirft NICHT. Sie ist der erste
  // IO-Schritt des Sweeps und liegt vor und außerhalb des Pro-Datei-`try`, um den
  // Task 17/R-2 ausdrücklich die ganze Pro-Datei-Arbeit gelegt hat („eine
  // einzelne Datei bricht den Sweep nicht ab"). Ungefangen riss ein transienter
  // Lesefehler auf `.qollab` — die Fehlerklasse, um die Task 12 kreist: das
  // Sync-Tool hält ein Handle — den GANZEN Sweep ab, bevor eine einzige Notiz
  // angesehen war; `onLayoutReady` startete danach Watcher und Poll, die auf
  // nicht aktualisierten Snapshots mergen (gemessen: 0 von 3 Offline-Edits
  // überlebten). Im Fehlerfall bleibt `previous` deshalb UNVERÄNDERT stehen:
  // Verwerfen wäre eine Aussage über einen Zustand, den wir gerade nicht lesen
  // konnten, und kostete bei jedem transienten Fehler einen vollen Sweep. Der
  // Merker ist dann höchstens so falsch wie vor diesem Fix, und jede geänderte
  // `.md` wird weiterhin angesehen.
  private async reconcileSweepCursor(
    previous: SweepCursor,
    lebendeNotes: Set<string>
  ): Promise<SweepCursor> {
    if (Object.keys(previous).length === 0) return previous;

    let vorhanden: Set<string>;
    try {
      // EIN rekursives Listing, dieselbe Quelle wie der Watcher-Poll. Bewusst
      // kein bestätigendes `stat` je Kandidat: auf dem Desktop-Pfad liest
      // `listAllSidecars` mit `fs.readdir` direkt am Dateisystem, also genauso
      // cache-frei wie `statSidecar` — und der Poll trifft seine
      // Existenz-Entscheidungen seit jeher auf genau dieser Liste. Ein zweiter
      // Zugriff je Kandidat brächte keine frischere Antwort, nur Kosten.
      vorhanden = new Set(await listAllSidecars(this.sidecarAdapter));
    } catch (err) {
      console.warn(
        `Qollab: ${QOLLAB_DIR} war beim Start nicht lesbar — der Fortschrittsmerker bleibt ` +
          'unverändert stehen und der Sweep läuft normal weiter.',
        err
      );
      return previous;
    }

    const behalten: SweepCursor = {};
    let verloren = 0;
    for (const [notePath, gesehen] of Object.entries(previous)) {
      if (vorhanden.has(this.syncHandler.stateFilePath(notePath))) {
        behalten[notePath] = gesehen;
        continue;
      }
      // Gezählt — und gemeldet — wird nur, was den Nutzer betrifft: eine Notiz,
      // die es noch gibt und die ihre Historie verloren hat. Merker-Einträge
      // gelöschter oder umbenannter Notizen fallen hier ebenfalls weg (sie täten
      // es am Sweep-Ende ohnehin, weil `next` neu aufgebaut wird), sind aber kein
      // Verlust — sie im Text mitzuzählen wäre ein Fehlalarm, und ein Fehlalarm
      // macht eine spätere echte Verlustmeldung stumm.
      if (lebendeNotes.has(notePath)) verloren++;
    }

    if (verloren === 0) return behalten;

    // Sofort persistieren statt auf das Sweep-Ende zu warten: Die verworfenen
    // Einträge sind nachweislich falsch, und der Sweep kann vorher abbrechen
    // (unloaded, Wurf).
    this.saveSweepCursor(behalten);
    // Notices verschwinden nach Sekunden; der Verlust ist dauerhaft.
    console.warn(
      `Qollab: Für ${verloren} Notiz(en) fehlt die eigene Sync-Datei in ${QOLLAB_DIR}, obwohl ` +
        'dieses Gerät sie bereits angelegt hatte. Die gemeinsame Änderungshistorie dieser ' +
        'Notizen ist verloren; ihr Fortschrittsmerker wird verworfen und der Sweep sieht sie ' +
        'wieder an.'
    );
    new Notice(
      `Qollab: ${verloren === 1 ? 'Einer Notiz' : `${verloren} Notizen`} fehlt die Sync-Datei ` +
        `in ${QOLLAB_DIR} — ihre gemeinsame Änderungshistorie ist verloren (auf allen Geräten, ` +
        'sobald die Löschung mitsynchronisiert wurde). Der Text der Notizen ist unberührt. Sie ' +
        'kommen erst wieder in den Sync, wenn sie bearbeitet werden oder die Sync-Datei eines ' +
        `anderen Geräts eintrifft. Bitte ${QOLLAB_DIR} nicht löschen — dort liegt die Historie.`
    );
    return behalten;
  }

  private async snapshotStaleMarkdownFiles(): Promise<void> {
    if (!this.settings.enabled) return;

    const files = this.app.vault.getMarkdownFiles();
    // Task 19/B (Hebel 3): EIN Verzeichnis-Listing je Ordner statt je Note.
    // Lebt genau für die Dauer dieses Aufrufs und wird ausschließlich an die
    // Adoptionsfrage weitergereicht (siehe hasAdoptableGuid).
    const dirCache = createDirListingCache();
    // Task 19/B (Hebel 1): Fortschrittsmerker. `previous` ist der Stand des
    // letzten vollständigen Sweeps dieses Geräts, `next` wird währenddessen neu
    // aufgebaut — dadurch fallen gelöschte und umbenannte Notes von selbst
    // heraus, ohne eigenen Aufräumpfad.
    //
    // Die Pfade der lebenden Notizen gehen mit: `reconcileSweepCursor` meldet
    // ausschließlich Notizen, die es noch gibt (siehe dort). Der Index ist schon
    // gelesen, das kostet nichts.
    const previous = await this.reconcileSweepCursor(
      this.loadSweepCursor(),
      new Set(files.map((f) => f.path))
    );
    const next: SweepCursor = {};
    for (const file of files) {
      // Szenariosuche 2026-08-02: Pfad EINMAL festhalten, wie im modify-Handler.
      // Obsidian mutiert `TFile.path` beim Umbenennen IN PLACE, und
      // `getMarkdownFiles()` liefert genau die Objekte des Vault-Index — dieselben,
      // die der rename-Handler mutiert vorfindet. Die Pro-Datei-Arbeit hier liest
      // `file.path` an sieben Stellen über drei `await`-Grenzen hinweg
      // (`statSidecar`, `hasAdoptableGuid`, Warteschlangen-Schlüssel,
      // `vault.read`). Ohne festen Pfad war eine Stelle der Warteschlangen-
      // Schlüssel und eine spätere der Arbeitspfad — identisch zum behobenen
      // modify-Fehler, nur über ein deutlich breiteres Fenster.
      //
      // Erreichbar auf zwei Wegen, die beide beim Start zusammenfallen: Der Sweep
      // schreibt über `writeBackMerged` selbst `.md`-Dateien und löst damit
      // umbenennende Plugins aus (Auto-Note-Mover reagiert auf Frontmatter/Tags),
      // und er läuft über den ganzen Vault lange genug, dass eine Umbenennung von
      // außen (Nutzer, Datei-Sync, anderes Plugin) in eines seiner IO-Fenster
      // fällt.
      //
      // Der Schaden ist derselbe wie dort: Unter dem neuen Pfad gibt es weder Doc
      // noch Sidecar (beide liegen noch am alten), also prägt `ensureDoc` eine
      // FRISCHE GUID über einer lebenden Historie. Der rename-Handler zieht danach
      // die echte Historie auf denselben Pfad; der Doc im Speicher bleibt der
      // frisch geprägte. Beim nächsten Abgleich gilt die eigene Sidecar als
      // kompatibel (gleiche GUID) und wird angewandt — Yjs dedupliziert nach
      // Item-ID, nicht nach Inhalt: der Notiztext steht doppelt (gemessen: 2 statt
      // 1, in Datei und CRDT), ohne jede Meldung.
      //
      // Der Abbruch sitzt an EINER Stelle: im Rumpf der Warteschlange, wo
      // Schlüssel und Arbeitspfad übereinstimmen müssen. Die beiden früheren
      // `await`-Grenzen brauchen keinen eigenen — sobald alles darunter `notePath`
      // benutzt, entscheidet der Sweep dort über den alten Pfad und arbeitet auch
      // auf ihm (`statSidecar` liest, `hasAdoptableGuid` räumt höchstens Leichen
      // am alten Pfad ab, der Merker landet am alten Pfad und fällt beim nächsten
      // Sweep von selbst heraus, weil es die Note dort nicht mehr gibt). Gemessene
      // Mutationsprobe: eigene Abbrüche an diesen beiden Grenzen ändern kein
      // Testergebnis, der Abbruch in der Warteschlange fängt alle drei Fenster.
      //
      // Übersprungen wird die Note dann ohne Merker, damit der nächste Sweep sie
      // voll ansieht. Der rename-Handler zieht Sidecars und Zustand ohnehin um;
      // erfasst wird der Stand unter dem neuen Pfad (nächster `modify`,
      // spätestens der nächste Sweep).
      const notePath = file.path;

      // Bricht der Sweep hier ab, wird `next` NICHT geschrieben: er beschriebe
      // sonst nur das bereits besuchte Präfix, und alles danach verlöre seinen
      // Merker. Der alte Stand bleibt stehen und ist weiterhin korrekt — er sagt
      // ja nur aus, was beim letzten VOLLSTÄNDIGEN Lauf aktuell war.
      if (this.unloaded) return;

      // Task 17/R-2: Der `try` umschließt die GANZE Pro-Datei-Arbeit, nicht mehr
      // nur den `pathQueue.run`-Block. `statSidecar` und `hasAdoptableGuid`
      // lagen davor und ungeschützt — `hasAdoptableGuid` fängt ausschließlich
      // `SidecarReadError` und läuft über `decodeSiblings` → `removeSidecar` →
      // `adapter.remove`; ein EBUSY/EPERM beim Aufräumen (das
      // Sync-Tool-hält-ein-Handle-Szenario, um das dieser Task kreist) riss den
      // gesamten restlichen Sweep mit. Genau dessen Vollständigkeit ist die
      // Korrektheitsbedingung von F-2, deshalb greift die schon vorher
      // dokumentierte Zusage „einzelne Datei bricht den Sweep nicht ab" jetzt
      // auch für die beiden Aufrufe hier.
      try {
        // Task 19/B (Hebel 1): Sah die `.md` beim letzten vollständigen Sweep
        // genau so aus und war der Snapshot damals aktuell, ist er es immer noch
        // — der einzige Weg, den eigenen Sidecar seither zu VERALTEN, führt über
        // eine Änderung der `.md`, und die ändert (mtime, size).
        //
        // `TFile.stat` ist eine synchrone In-Memory-Property (Obsidian füllt sie
        // beim Vault-Scan aus einem echten lstat und hält sie über den
        // File-Watcher aktuell). Dieser Zweig macht also NULL IO.
        //
        // Preis, bewusst bezahlt: Wird der eigene Sidecar extern gelöscht, ohne
        // dass die `.md` sich ändert, bemerkt der Sweep das nicht mehr. Der Stand
        // ist deshalb nicht verloren — er wird beim nächsten Edit (modify) neu
        // geschrieben, und liegt eine Fremd-Sidecar vor, holt ihn der Poll über
        // `loadAndMerge` zurück. Der Merker deckt bewusst NUR diese eine
        // Feststellung ab; über fremde Sidecars sagt er nichts aus, weil deren
        // Ankunft die `.md` nicht anfasst.
        const seen = previous[notePath];
        if (seen && seen[0] === file.stat.mtime && seen[1] === file.stat.size) {
          next[notePath] = seen;
          continue;
        }

        // Szenariosuche Fund 36: Die `.md` ist anders als beim letzten Merker,
        // ihr Zeitstempel ist dabei aber NICHT vorangeschritten — sie wurde von
        // außen durch eine ältere Fassung ersetzt. Genau das tun Explorer-Copy,
        // ZIP-Entpacken und „vorherige Version wiederherstellen": sie übernehmen
        // den Zeitstempel der Sicherung.
        //
        // Für diese Notiz ist der Vergleich unten blind. Er fragt „ist die
        // Hilfsdatei neuer?" und schließt aus einem Ja auf „unser Snapshot ist
        // aktuell" — eine Aussage über Alter, wo eine über Änderung nötig wäre.
        // Die zurückgespielte Notiz wurde deshalb übersprungen, der Doc behielt
        // den neueren Stand, und der nächste Fremd-Trigger schrieb ihn über die
        // Datei zurück: die Rückspielung war lautlos weg (reproduziert in
        // `backup-restore.test.ts`).
        //
        // Der Merker beantwortet die Frage exakt und ohne Dateizugriff: er hält
        // fest, wie die `.md` aussah, als der Snapshot zuletzt NACHWEISLICH
        // aktuell war. Zwei Zahlen aus dem Gerätespeicher gegen zwei aus
        // `TFile.stat` — die Treffer-Abkürzung darüber bleibt unangetastet, der
        // Sweep-Gewinn aus Task 19/B also auch (gemessen, siehe Bericht).
        //
        // `<=` statt `<`: Bleibt der Zeitstempel stehen, während sich die Größe
        // ändert, ist er als Frische-Signal ebenso wertlos (OneDrive rundet
        // `.md`-mtimes auf ganze Sekunden — bekannte Grenze #3).
        //
        // Warum das NICHT der Fehl-Fix aus `git-rollback.test.ts` ist: Der dort
        // gepinnte erkennt einen Rollback und UNTERDRÜCKT daraufhin den lokalen
        // Diff — das frisst die legitime Offline-Löschung (Fall G) mit. Hier
        // wird nichts unterdrückt, sondern eine bisher übersprungene Notiz
        // überhaupt erst angesehen; sie läuft danach durch denselben Pfad wie
        // jede andere geänderte `.md`. Ein G)-Analogon kann daran nicht
        // scheitern, weil es keinen Fall gibt, in dem „nicht ansehen" das
        // gewünschte Ergebnis wäre.
        //
        // Ohne Merker-Eintrag (Erststart, Neuinstallation, in dieser Sitzung nie
        // als aktuell bestätigte Notiz) gibt es keine Erinnerung, an der sich
        // eine Rückdatierung messen liesse — dort bleibt es beim
        // Zeitstempel-Vergleich. Das ist die Grenze dieses Fixes.
        const zurueckdatiert = seen !== undefined && file.stat.mtime <= seen[0];

        // Sidecar-mtime über den Adapter (Index-blind für .qollab/). Ist der eigene
        // Sidecar mindestens so neu wie die .md, ist der Snapshot aktuell.
        const statePath = this.syncHandler.stateFilePath(notePath);
        // Task 12 (m-3): frischer stat — eine stale Adapter-mtime würde die .md
        // fälschlich als „Snapshot aktuell" überspringen.
        const stat = await statSidecar(this.sidecarAdapter, statePath);
        if (!zurueckdatiert && stat && stat.mtime >= file.stat.mtime) {
          // Genau diese Feststellung merkt sich der Merker — und nur sie.
          next[notePath] = [file.stat.mtime, file.stat.size];
          continue;
        }

        // Task 13/B: Ohne eigene Sidecar fehlt die Vergleichsbasis — „lokal
        // geändert" ist für diese Note nicht feststellbar, jede unveränderte Note
        // sähe wie ein Offline-Edit aus. Prägte der Sweep hier eine frische GUID,
        // bekäme beim Zwei-Geräte-Rollout JEDE Seite ihre eigene Inkarnation
        // derselben Note (Split-Brain); der Tie-Break-Verlierer verwirft danach
        // seine Historie (Realtest S05 v1: 10/10 divergent). Deshalb: ohne eigene
        // Sidecar nur dann snapshotten, wenn eine adoptierbare fremde Sidecar
        // vorliegt — dann übernimmt ensureDoc deren GUID statt eine neue zu prägen.
        // Sonst entsteht die GUID beim ersten echten Edit (modify-Handler), also
        // genau einmal und auf dem Gerät, das wirklich editiert hat.
        //
        // Offline-Edits bleiben erfasst: sie betreffen Notes, die dieses Gerät
        // schon kennt (eigene Sidecar vorhanden) — dort greift unverändert der
        // mtime-Vergleich oben.
        //
        // Review I-3: Die Frage „gibt es etwas zu adoptieren?" beantwortet der
        // SyncHandler auf derselben Basis wie ensureDoc (dekodierbare, nicht
        // getombstete GUID) — reine Datei-Existenz genügt nicht: eine korrupte oder
        // halb kopierte Fremd-Sidecar trägt keine GUID, ensureDoc prägte dann doch
        // eine frische Inkarnation.
        if (!stat && !(await this.syncHandler.hasAdoptableGuid(notePath, dirCache))) {
          continue;
        }

        // Pro-Datei-Arbeit über dieselbe Queue wie modify/Remote-Merge — der Sweep
        // darf nicht parallel zu einem laufenden Merge denselben Doc mutieren.
        //
        // Task 16: Write-Back wie im modify-Handler. Der Sweep ist der Pfad, der beim
        // Start eine bei geschlossener App angekommene Fremd-Sidecar in den Doc zieht;
        // ohne Write-Back startete die Sitzung genau im Vorlauf-Zustand.
        await this.pathQueue.run(notePath, async () => {
          // Der Abbruchpunkt (siehe oben). Geprüft wird an jeder `await`-Grenze
          // innerhalb der Warteschlange — der Wartezeit selbst, dem `vault.read`
          // und dem `applyLocalContent`: der Schlüssel ist `notePath`, also muss
          // auch der Arbeitspfad `notePath` sein. Dieselbe Regel wie im
          // modify-Handler — und derselbe Rückkanal: Ein in `content` schon
          // gelesener Edit ist nach dem Abbruch nur in der `.md`, und ein
          // Fremd-Trigger vor dem nächsten Erfassungslauf überschriebe ihn.
          // Hier wiegt das schwerer als im modify-Handler, weil das Fenster nicht
          // 30 s breit ist, sondern null: `onLayoutReady` ruft direkt hinter dem
          // Sweep `startSidecarWatcher()` und `poll()`.
          if (this.unloaded || file.path !== notePath) return;
          const content = await this.app.vault.read(file);
          if (this.unloaded) return;
          if (file.path !== notePath) {
            this.syncHandler.noteUncapturedLocalContent(notePath, content);
            return;
          }
          const merged = await this.syncHandler.applyLocalContent(notePath, content);
          if (this.unloaded || file.path !== notePath) return;
          await this.writeBackMerged(file, content, merged);
        });
      } catch {
        // Einzelne Datei darf den Sweep nicht abbrechen. Sie bekommt dann auch
        // keinen Merker — der nächste Sweep sieht sie wieder voll an.
      }
    }
    this.saveSweepCursor(next);
  }

  // Rückgabe: false = der Merge lief NICHT durch (abgebrochen/übersprungen), der
  // Watcher darf den Trigger nicht als verbraucht verbuchen (F-2a). true = erledigt.
  private async onRemoteYjsUpdate(notePath: string): Promise<boolean> {
    if (this.unloaded) return false;
    if (!this.settings.enabled) return false;
    // Task 17/F-2: Gate. Vor Sweep-Ende sind die lokalen Snapshots nicht aktuell —
    // ein Merge jetzt würde nie erfassten `.md`-Inhalt löschen. `false` heißt
    // „Trigger nicht verbraucht": der Watcher lässt `lastSeen` stehen und liefert
    // denselben Stand nach dem Sweep erneut.
    if (this.sweepRunning) return false;

    // Fix A: den .md-Inhalt VOR dem Merge festhalten. Er ist die Basis, um beim
    // Write-Back einen lokalen User-Edit zu erkennen, der zwischen Merge-
    // Berechnung und Write-Back in der Datei gelandet ist. Existiert die Datei
    // (noch) nicht, gibt es keine Basis → Normalpfad (blind schreiben) wie bisher.
    const preFile = this.app.vault.getAbstractFileByPath(notePath);
    let preMerge: string | null = null;
    if (preFile instanceof TFile) {
      preMerge = await this.app.vault.read(preFile);
      if (this.unloaded) return false;
    }

    // Guard 1: ohne .md gibt es nichts zu mergen. Ein loadAndMerge-Aufruf ohne
    // existierende .md würde ensureDoc und saveState auslösen — das persistiert
    // einen leeren eigenen Sidecar mit frischer GUID. Kehrt die .md später via
    // Sync zurück (Sync-Konfliktauflösung Delete-vs-Edit behält die Datei),
    // überschreibt dieser leere Stand beim nächsten Write-Back die Note mit ''.
    // Kommt die .md an, greift der reguläre Adopt-Zweig (ensureDoc) mit
    // .md-Injektion — kein eigener Aufruf hier nötig.
    const noteFile = this.app.vault.getAbstractFileByPath(notePath);
    // Verwaiste Sidecar ohne .md: bewusst nichts zu tun, gilt als erledigt —
    // sonst triggerte sie bei jedem Poll erneut.
    if (!noteFile) return true;

    // Fix-Runde (Review F-2b): Hat ein früherer applyLocalContent wegen eines
    // IO-Fehlers abgebrochen, lebt der lokale Edit NUR in der .md — loadAndMerge
    // injiziert den .md-Text im own-Branch bewusst nicht. Ohne Nachholen liefe der
    // Write-Back unten über `data === preMerge` und überschriebe ihn (Verlust).
    // Deshalb den Lauf hier nachholen, bevor der gemergte Stand berechnet wird.
    // Nachgeholt wird der GEMERKTE Text, nicht der aktuelle .md-Inhalt: nach einem
    // Abbruch im pending-Zweig (R2-1) ist der Doc dem .md bereits um den Remote-Stand
    // voraus, und ein Diff „.md gegen Doc" würde diesen zurückrollen.
    const uncaptured = this.syncHandler.pendingLocalContent(notePath);
    if (uncaptured !== undefined) {
      await this.syncHandler.applyLocalContent(notePath, uncaptured);
      if (this.unloaded) return false;
    }

    const merged = await this.syncHandler.loadAndMerge(notePath);
    if (this.unloaded) return false;
    // null = nichts zu mergen ODER Merge wegen IO-Fehler abgebrochen. In beiden
    // Fällen kein Write-Back; der Watcher hat lastSeen nicht fortgeschrieben.
    if (merged === null) return false;

    // Der Nachhol-Versuch ist erneut gescheitert: der lokale Edit ist weiterhin
    // nicht im CRDT erfasst, `merged` kennt ihn nicht. Ein Write-Back würde ihn
    // jetzt löschen — lieber gar nicht schreiben und beim nächsten Trigger erneut
    // versuchen.
    if (this.syncHandler.hasAbortedRead(notePath)) return false;

    // Guard 2: ein leerer, historienloser Merge-Stand darf eine vorhandene .md
    // nie überschreiben. Historienlos = Y.Doc hat keinerlei Ops (State-Vector leer,
    // store.clients.size === 0) — das passiert bei einem Frisch-Doc ohne Edits.
    // Abgrenzung: eine echte Leerung (User löscht allen Text) hinterlässt
    // Delete-Ops → hasOps() gibt true → dieser Guard greift NICHT.
    if (merged === '' && !this.crdtManager.hasOps(notePath)) return true;

    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return true;

    // Atomarer Read-Modify-Write in der process-Funktion. Der writingPaths-Guard
    // umschließt BEIDE process-Aufrufe, da jeder ein modify-Event feuert.
    this.writingPaths.add(notePath);
    let changed = false;
    try {
      // Erster Versuch, Drei-Fall-Logik:
      //   data === merged        → schon aktuell, kein Write, keine Notice.
      //   data === preMerge      → Normalfall, gemergten Stand schreiben.
      //   sonst                  → Edit im Merge-Fenster: NICHT überschreiben,
      //                            data als `pending` nach außen reichen.
      // Ohne preMerge-Basis (Datei existierte vor dem Merge nicht) gibt es keinen
      // Edit-Guard → wie bisher den gemergten Stand schreiben.
      let pending: string | null = null;
      await this.app.vault.process(file, (data) => {
        if (data === merged) return data;
        if (preMerge === null || data === preMerge) {
          changed = true;
          return merged;
        }
        pending = data;
        return data;
      });

      // Task 16: Der nächste lokale Diff setzt ab hier auf `merged` auf, nicht mehr
      // auf dem .md-Stand von vor dem Merge. In den beiden Nicht-pending-Fällen ist
      // das auch der Dateiinhalt (geschrieben oder schon so vorgefunden). Im
      // pending-Fall trägt die Datei noch `pending`, der Aufruf unten reicht aber
      // `threeWay` herein — einen Text, der auf genau diesem `merged` aufsetzt; für
      // dessen Diff ist `merged` also die richtige Basis. Der zweite Write-Back
      // korrigiert sie danach auf den echten Dateiinhalt.
      this.syncHandler.noteLocalDiffBase(notePath, merged);

      // Fix A: Ein Edit ist im Merge-Fenster gelandet. Ihn als 3-Wege-Merge
      // (Basis = preMerge, lokal = pending) auf den gemergten Remote-Stand
      // anwenden und via applyLocalContent ins CRDT bringen — so überleben beide
      // Änderungen. Danach EIN zweiter Write-Back-Versuch mit derselben Logik
      // (Basis ist jetzt `pending`). Weicht `data` erneut ab: aufgeben ohne Write,
      // der nächste modify-Event-Task konvergiert. Kein Loop, max. eine Wiederholung.
      if (pending !== null) {
        const threeWay = threeWayMerge(preMerge ?? '', pending, merged);
        await this.syncHandler.applyLocalContent(notePath, threeWay);
        // R2-1: Zweiter Write-Back-Pfad, gleiche Falle wie oben. Bricht das
        // applyLocalContent ab, ist `merged2` der Remote-Stand OHNE den
        // pending-Edit und `data === pending` würde ihn überschreiben. Die beiden
        // Bedingungen sind positiv korreliert: dieser Zweig existiert für
        // „Sync-Overwrite + Editor-Save im selben Fenster" — genau die Lage, in der
        // ein Sync-Tool Handles hält und EBUSY erzeugt. Kein Write, Trigger bleibt
        // unverbraucht; der nächste Lauf konvergiert.
        if (this.syncHandler.hasAbortedRead(notePath)) return false;
        if (!this.unloaded) {
          const merged2 = this.crdtManager.getContent(notePath);
          let written: string | undefined;
          await this.app.vault.process(file, (data) => {
            const next = ((): string => {
              if (data === merged2) return data;
              if (data === pending) {
                changed = true;
                return merged2;
              }
              return data;
            })();
            written = next;
            return next;
          });
          // Task 16: Was der Callback zurückgegeben hat, steht jetzt in der .md. Das
          // applyLocalContent(threeWay) darüber hat die Basis auf einen Text gesetzt,
          // der so nie in der Datei stand — hier steht sie wieder auf dem echten
          // Dateiinhalt.
          //
          // Review F-2: NACH dem `await`, nicht im Callback. Scheitert `process`
          // nach dem Callback am Schreiben, trägt die Datei weiter `data`; eine Basis
          // auf `next` wäre dann ein Text, der nie in der Datei stand, und der
          // nächste lokale Diff verbuchte die Differenz als Löschung.
          if (written !== undefined) this.syncHandler.noteLocalDiffBase(notePath, written);
        }
      }
    } finally {
      this.writingPaths.delete(notePath);
    }

    if (changed && this.settings.statusNotice) {
      new Notice(`CRDT Sync: ${file.name} automatisch gemergt.`);
    }
    // Task 17/F-6: Der Merge selbst ist durch und steht in der Datei — aber unser
    // Stand kam nicht auf die Platte. `false` heißt „Trigger nicht verbraucht":
    // derselbe Sidecar-Stand löst beim nächsten Poll erneut aus, und das ist der
    // Wiederholungsversuch. Ohne diese Zeile bliebe der Schreibfehler folgenlos
    // stehen, bis zufällig ein anderer Trigger dieselbe Note trifft.
    return !this.syncHandler.hasUnpersistedState(notePath);
  }

  onunload() {
    this.unloaded = true;
    this.sidecarWatcher.stop();
    this.crdtManager.disposeAll();
  }

  // Task 14, Fix B: Geräte-ID beschaffen.
  //   1. localStorage hat eine gültige ID → nutzen.
  //   2. sonst data.json-Alt-ID → einmalig übernehmen (und aus data.json entfernen).
  //   3. sonst frisch generieren.
  // Der Migrationsfall 2 kann auf BEIDEN Geräten dieselbe ID ergeben (die geklonte
  // data.json war ja überall gleich) — deshalb ist die Kollisionserkennung in
  // onOwnSidecarChanged Pflichtteil dieses Fixes und nicht Kür.
  private async provisionClientId(): Promise<string> {
    const stored = this.app.loadLocalStorage(CLIENT_ID_KEY);
    let id: string | null =
      typeof stored === 'string' && CLIENT_ID_RE.test(stored) ? stored : null;
    if (id === null) {
      id = CLIENT_ID_RE.test(this.legacyClientId) ? this.legacyClientId : generateClientId();
      this.app.saveLocalStorage(CLIENT_ID_KEY, id);
    }
    if (this.legacyClientId) {
      // loadSettings hat den Alt-Schlüssel bereits aus dem Settings-Objekt
      // getrennt; dieser Save schreibt data.json endgültig ohne clientId.
      this.legacyClientId = '';
      await this.saveSettings();
    }
    return id;
  }

  // Task 14, Fix C/D: neue Geräte-ID vergeben. Gutartig — die alte Sidecar-Datei
  // bleibt liegen und ist ab jetzt eine Fremd-Sidecar derselben GUID, die ganz
  // normal gemergt wird.
  private reprovisionClientId(): void {
    this.clientId = generateClientId();
    this.app.saveLocalStorage(CLIENT_ID_KEY, this.clientId);
    this.syncHandler.setClientId(this.clientId);
    this.sidecarWatcher.setClientId(this.clientId);
  }

  // Task 14, Fix C: Der Watcher hat eine Änderung an unserem eigenen Sidecar-Pfad
  // gesehen. War sie nicht von uns, trägt ein zweites Gerät dieselbe clientId
  // (Alt-Installation mit mitgesyncter data.json) — sonst bliebe der Peer für immer
  // hinter dem Self-Ignore unsichtbar. Dann: neu provisionieren, die Kollision EINMAL
  // melden und die Note regulär mergen (der alte Pfad ist jetzt fremd). Die alte
  // Datei wird NICHT gelöscht — sie gehört ab sofort dem anderen Gerät.
  //
  // Kein Once-Guard wie bei corruptNoticePaths (Review M-1): Pro Vorfall kann hier
  // ohnehin nur eine Meldung entstehen — nach dem Reprovisionieren matcht der alte
  // Pfad den Self-Check nicht mehr, und die restlichen Pfade des Durchlaufs tragen
  // bereits die neue ID. Ein sitzungsweiter Guard würde nur eine SPÄTERE, echte
  // zweite Kollision verschlucken.
  //
  // Szenariosuche Fund 37: Die Meldung nannte bis hierher eine Ursache
  // („Geräte-ID-Kollision erkannt"), die an dieser Stelle gar nicht feststeht.
  // Festgestellt ist ausschließlich: Jemand, der nicht wir sind, hat unsere
  // eigene Hilfsdatei geschrieben. Eine geteilte Geräte-ID ist eine mögliche
  // Ursache; eine bei laufender App zurückgespielte Sicherung ist eine andere
  // und inzwischen die wahrscheinlichere, weil die echte Kollision seit Task 14
  // eine geerbte `data.json` voraussetzt.
  //
  // Schärfer geht die Unterscheidung hier nicht: Sie bräuchte einen Vergleich
  // des Dateiinhalts gegen den eigenen Doc, und den gibt es im Regelfall nicht
  // — für jede in dieser Sitzung nicht angefasste Notiz stammt die Signatur aus
  // der ersten Sichtung des Wächters, ganz ohne Doc, und ihn aus der
  // fraglichen Datei aufzubauen wäre zirkulär. Der Zeitstempel taugt ebenfalls
  // nicht: über Gerätegrenzen ist er nicht belastbar (bekannte Grenzen #3/#27).
  //
  // Die HANDLUNG bleibt darum unverändert richtig — ein fremder Schreiber auf
  // unserem Pfad, also treten wir zur Seite. Nur die Behauptung fällt weg. Der
  // Wortlaut trägt beide Ursachen, damit die Empfängerin die für sie zutreffende
  // wiedererkennt statt nach einem zweiten Gerät zu suchen, das es nicht gibt
  // (`backup-restore.test.ts`, README-Absatz gepinnt in
  // `docs-consistency.test.ts`).
  private async onOwnSidecarChanged(
    notePath: string,
    path: string,
    cur: { mtime: number; size: number }
  ): Promise<boolean> {
    if (this.unloaded) return false;
    // Task 17/F-4: Bei ausgeschaltetem Sync wird keine neue Geräte-ID vergeben und
    // keine Kollision gemeldet — der anschließende Merge fiele ohnehin am
    // `enabled`-Guard ab, die neue ID bliebe aber. Die Prüfung läuft nach dem
    // Wieder-Einschalten erneut: der Watcher hat `lastSeen` für den eigenen Pfad
    // zwar fortgeschrieben, aber jeder weitere Fremd-Write ändert (mtime,size)
    // erneut. Bewusst kein `false`-Rückkanal wie bei den Merge-Triggern: hier gibt
    // es nichts nachzuholen, nur nichts anzurichten.
    if (!this.settings.enabled) return false;
    if (!(await this.syncHandler.isForeignSidecarWrite(path, cur))) return false;

    this.reprovisionClientId();
    new Notice(FOREIGN_OWN_SIDECAR_NOTICE, 15000);
    await this.pathQueue.run(notePath, () => this.onRemoteYjsUpdate(notePath));
    return true;
  }

  async loadSettings() {
    // Task 14: Eine Alt-Installation trägt die clientId noch in data.json. Sie wird
    // hier vom Settings-Objekt getrennt (und damit beim nächsten saveData aus
    // data.json entfernt); provisionClientId entscheidet über die Migration.
    const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
    this.legacyClientId = typeof raw.clientId === 'string' ? raw.clientId : '';
    delete raw.clientId;

    // Task 17/F-3: dieselbe Trennung für `enabled` und die Tombstone-Map. Was in
    // data.json steht, ist ab jetzt ausschließlich Migrationsquelle für den
    // ersten Start; danach lebt beides gerätelokal.
    const legacyEnabled = typeof raw.enabled === 'boolean' ? raw.enabled : undefined;
    const legacyTombstones =
      typeof raw.tombstones === 'object' && raw.tombstones !== null
        ? (raw.tombstones as Record<string, number>)
        : undefined;
    const migrated = legacyEnabled !== undefined || legacyTombstones !== undefined;
    delete raw.enabled;
    delete raw.tombstones;

    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);

    const device = (this.app.loadLocalStorage(DEVICE_SETTINGS_KEY) ?? {}) as {
      enabled?: unknown;
      tombstones?: unknown;
    };
    // Der Geräte-Speicher schlägt die Migrationsquelle: existiert er, ist die
    // Migration längst gelaufen und ein noch herumliegender data.json-Wert (vom
    // anderen Gerät nachgesynct) darf sie nicht überstimmen.
    this.settings.enabled =
      typeof device.enabled === 'boolean'
        ? device.enabled
        : (legacyEnabled ?? DEFAULT_SETTINGS.enabled);
    const tombstones =
      typeof device.tombstones === 'object' && device.tombstones !== null
        ? (device.tombstones as Record<string, number>)
        : (legacyTombstones ?? {});
    // Tombstones > 90 Tage beim Laden entfernen (hält den Speicher klein) und
    // Alt-Format-Einträge (GUID-global, vor Task 15) verwerfen.
    this.settings.tombstones = migrateTombstones(tombstones);

    // Einmalig: die migrierten Schlüssel aus data.json entfernen. Ohne diesen
    // Save bliebe die Datei die Transportschicht, die der Fix beseitigt.
    if (migrated) await this.saveSettings();
  }

  // Task 17/F-3: Geteiltes und Gerätelokales gehen an getrennte Ablagen. Das
  // Settings-Objekt bleibt der eine In-Memory-Zustand — nur die Persistenz ist
  // gesplittet, damit kein Aufrufer sich merken muss, welches Feld wohin gehört.
  async saveSettings() {
    // Szenariosuche 2026-07-31: `saveLocalStorage` ist die Web-Storage-API und
    // kann werfen (Quota; auf Mobile enger). Ungefangen riss der Wurf den
    // `delete`-Handler auf, BEVOR er aufräumt: kein Tombstone, keine gelöschten
    // Hilfsdateien, kein `disposeNote` — also genau die Zombie-Lage, gegen die
    // Task 15 gebaut wurde, plus Waisen ohne Aufräumpfad. Der Schalterstand ist
    // die kleinere Sorge; er steht im Zweifel beim nächsten Start auf dem
    // Standard, während ein halb abgebrochenes Löschen dauerhaft nachwirkt.
    try {
      this.app.saveLocalStorage(DEVICE_SETTINGS_KEY, {
        enabled: this.settings.enabled,
        tombstones: this.settings.tombstones,
      });
    } catch (err) {
      console.error('Qollab: Geräteeinstellungen konnten nicht gespeichert werden', err);
    }
    const { enabled, tombstones, ...shared } = this.settings;
    void enabled;
    void tombstones;
    await this.saveData(shared);
  }
}
