import { Notice, Plugin, TFile } from 'obsidian';
import { CrdtManager } from './crdt-manager';
import { SyncHandler, TombstoneStore, QOLLAB_DIR } from './sync-handler';
import {
  SidecarAdapter,
  listYjsInDir,
  ensureSidecarFolder,
  dirname,
  statSidecar,
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
// Das Sidecar-Dateiformat (`<note>.<clientId>.yjs`) verlangt exakt 8 Hex-Zeichen.
// Alles andere aus dem Speicher wird verworfen statt in Dateinamen weitergereicht.
const CLIENT_ID_RE = /^[0-9a-f]{8}$/;

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
      listYjsFiles: (notePath: string) => listYjsInDir(adapter, notePath),
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
      (path: string) => this.noteUnwritable(path)
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
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (!this.settings.enabled) return;
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        if (this.writingPaths.has(file.path)) return;

        await this.pathQueue.run(file.path, async () => {
          if (this.unloaded) return;
          const content = await this.app.vault.read(file);
          if (this.unloaded) return;
          const merged = await this.syncHandler.applyLocalContent(file.path, content);
          if (this.unloaded) return;
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
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        await this.pathQueue.runAll([oldPath, file.path], async () => {
          // Sidecars sind für den Index unsichtbar → über den Adapter listen und
          // umziehen. Zielordner ggf. anlegen (Rename in einen anderen Ordner).
          const sidecars = await listYjsInDir(this.sidecarAdapter, oldPath);
          for (const sc of sidecars) {
            const suffix = sc.slice(`${QOLLAB_DIR}/${oldPath}`.length);
            const newPath = `${QOLLAB_DIR}/${file.path}${suffix}`;
            await ensureSidecarFolder(this.sidecarAdapter, dirname(newPath));
            await this.sidecarAdapter.rename(sc, newPath);
          }
          this.syncHandler.renameNote(oldPath, file.path);
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
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.endsWith('.md')) return;
        await this.pathQueue.run(file.path, async () => {
          // Task 17/F-4: „aus" heißt keine neuen Markierungen. Ein Tombstone ist
          // eine Zustandsänderung mit 90 Tagen Halbwertszeit, und ein
          // sync-vermittelter Rename kommt als delete+create an — das
          // ausgeschaltete Plugin beerdigte damit eine LEBENDE Inkarnation. Das
          // Sidecar-Housekeeping darunter läuft weiter: unterbliebe es, blieben
          // Waisen liegen, die niemand mehr aufräumt.
          const guids = this.settings.enabled
            ? await this.syncHandler.guidsToTombstone(file.path)
            : null;
          if (guids) {
            await this.tombstoneStore.addAll(
              guids,
              this.syncHandler.incarnationPaths(file.path)
            );
          }
          // Sidecars über den Adapter listen und entfernen (Index-blind).
          const sidecars = await listYjsInDir(this.sidecarAdapter, file.path);
          for (const sc of sidecars) await this.sidecarAdapter.remove(sc);
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
    this.writingPaths.add(file.path);
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
      this.writingPaths.delete(file.path);
    }
    // Review F-2: Die Basis erst NACH dem bestätigten Write setzen. Im Callback
    // gesetzt, stand sie auf `merged`, während die Datei nach einem gescheiterten
    // Write weiter `expected` trug — der nächste `modify` difft dann „merged →
    // expected", also genau die Löschung des Fremd-Edits, die dieser Task
    // verhindern soll (gemessen: FREMD=0). `changed` ist nur true, wenn der Callback
    // `merged` zurückgegeben hat UND `process` durchgelaufen ist.
    if (changed) this.syncHandler.noteLocalDiffBase(file.path, merged);
    // Dieselbe Meldung wie beim Write-Back in onRemoteYjsUpdate: für den Nutzer ist
    // es dasselbe Ereignis („die Note wurde automatisch zusammengeführt"), nur
    // ausgelöst vom eigenen Tippen statt vom Poll. Ohne sie verschwände das Signal
    // genau in den Fällen, die dieser Write-Back dem Poll vorwegnimmt.
    if (changed && this.settings.statusNotice) {
      new Notice(`CRDT Sync: ${file.name} automatisch gemergt.`);
    }
  }

  private async snapshotStaleMarkdownFiles(): Promise<void> {
    if (!this.settings.enabled) return;

    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
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
        // Sidecar-mtime über den Adapter (Index-blind für .qollab/). Ist der eigene
        // Sidecar mindestens so neu wie die .md, ist der Snapshot aktuell.
        const statePath = this.syncHandler.stateFilePath(file.path);
        // Task 12 (m-3): frischer stat — eine stale Adapter-mtime würde die .md
        // fälschlich als „Snapshot aktuell" überspringen.
        const stat = await statSidecar(this.sidecarAdapter, statePath);
        if (stat && stat.mtime >= file.stat.mtime) {
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
        if (!stat && !(await this.syncHandler.hasAdoptableGuid(file.path))) {
          continue;
        }

        // Pro-Datei-Arbeit über dieselbe Queue wie modify/Remote-Merge — der Sweep
        // darf nicht parallel zu einem laufenden Merge denselben Doc mutieren.
        //
        // Task 16: Write-Back wie im modify-Handler. Der Sweep ist der Pfad, der beim
        // Start eine bei geschlossener App angekommene Fremd-Sidecar in den Doc zieht;
        // ohne Write-Back startete die Sitzung genau im Vorlauf-Zustand.
        await this.pathQueue.run(file.path, async () => {
          if (this.unloaded) return;
          const content = await this.app.vault.read(file);
          if (this.unloaded) return;
          const merged = await this.syncHandler.applyLocalContent(file.path, content);
          if (this.unloaded) return;
          await this.writeBackMerged(file, content, merged);
        });
      } catch {
        // Einzelne Datei darf den Sweep nicht abbrechen
      }
    }
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
    new Notice('Qollab: Geräte-ID-Kollision erkannt, neu provisioniert.');
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
    this.app.saveLocalStorage(DEVICE_SETTINGS_KEY, {
      enabled: this.settings.enabled,
      tombstones: this.settings.tombstones,
    });
    const { enabled, tombstones, ...shared } = this.settings;
    void enabled;
    void tombstones;
    await this.saveData(shared);
  }
}
