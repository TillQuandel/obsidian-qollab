// Task 16 — Der Y.Doc darf der .md nicht unbemerkt vorauslaufen.
//
// Ausgangslage: `applyLocalContent` zieht ausstehende Fremd-Sidecars in den Doc
// (Task 11/12), schreibt die .md aber NICHT zurück — das passiert allein im
// Write-Back von `onRemoteYjsUpdate` (Poll, 30 s). Zwischen Fremd-Merge und Poll
// gilt: der Doc kennt den Fremd-Edit, die .md nicht.
//
// Nimmt der nächste lokale Diff den Doc als Basis, ist das Delta „Basis → .md"
// genau die LÖSCHUNG des Fremd-Edits. `setContent` schreibt sie als Delete-Op,
// `saveState` persistiert sie, der Sync trägt sie zur Gegenseite — der Satz ist
// auf beiden Geräten weg, ohne Meldung und unheilbar (fund-endzustaende.md, Fund 1).
//
// Getestet wird auf zwei Ebenen:
//   - Plugin-Ebene (echter modify-Handler, echter Watcher): zwei Tastendrücke
//     ohne Poll dazwischen.
//   - Handler-Ebene: die Invariante von `mergeForLocalDiff` selbst — ein Doc-
//     Vorlauf darf nie als lokale Löschung verbucht werden, unabhängig davon, ob
//     ein Aufrufer die .md zwischendurch zurückschreibt.

import { Notice, TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile, encodeStateFile } from '../src/state-file';
import {
  makeVaultMock,
  makeLocalStorage,
  toArrayBuffer,
  type VaultMock,
} from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'aaaa1111';
const FOREIGN_ID = 'bbbb2222';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const FOREIGN_PATH = `.qollab/${NOTE}.${FOREIGN_ID}.yjs`;

const BASE = 'L1\nL2\nL3\n';
const WITH_FOREIGN = 'L1\nL2\nL3\nFREMD\n';

const count = (text: string, needle: string): number => text.split(needle).length - 1;

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

// Ein Gerät über den ECHTEN onload-Pfad (modify-Handler, Watcher, Write-Back).
// onLayoutReady bleibt ein No-op — Sweep/Initial-Scan werden gezielt gerufen.
async function bootDevice(vault: VaultMock): Promise<{
  plugin: any;
  handlers: Map<string, (...args: any[]) => any>;
}> {
  const storage = makeLocalStorage();
  storage.saveLocalStorage('qollab-client-id', OWN_ID);
  const handlers = new Map<string, (...args: any[]) => any>();
  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
  const app = {
    vault: vaultWithEvents,
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  plugin._data = { enabled: true, statusNotice: false, tombstones: {} };
  await plugin.onload();
  return { plugin, handlers };
}

// Ein Tastendruck: neuer .md-Inhalt + Obsidians modify-Event.
async function type(
  vault: VaultMock,
  handlers: Map<string, (...args: any[]) => any>,
  text: string
): Promise<void> {
  vault._textFiles.set(NOTE, text);
  vault._mdMtimes.set(NOTE, (vault._mdMtimes.get(NOTE) ?? 0) + 1);
  await handlers.get('modify')!(tfile(NOTE));
}

// Fremd-Sidecar des Peers: leitet von UNSEREM Stand ab, damit die gemeinsamen
// Zeilen dieselben Yjs-Item-IDs tragen (sonst dedupliziert der Merge nicht) und
// nur `FREMD` die Client-ID des Peers trägt. Die zugehörige .md kommt bewusst
// NICHT mit — genau die vom README beschriebene Ankunftsreihenfolge.
function placeForeignSidecar(vault: VaultMock, fromPath = OWN_PATH): void {
  const own = decodeStateFile(new Uint8Array(vault._files.get(fromPath)!));
  const peer = new CrdtManager();
  peer.applyUpdate(NOTE, own.update);
  peer.setContent(NOTE, WITH_FOREIGN);
  vault._files.set(
    FOREIGN_PATH,
    toArrayBuffer(encodeStateFile(own.guid!, peer.encodeState(NOTE)))
  );
  vault._mtimes.set(FOREIGN_PATH, (vault._mtimes.get(OWN_PATH) ?? 0) + 1);
}

describe('Doc-Vorlauf: lokaler Diff darf einen gemergten Fremd-Edit nicht löschen', () => {
  it('Plugin-Ebene: zweiter Tastendruck ohne Poll dazwischen behält den Fremd-Edit', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);

    // Erster Kontakt: unsere Note wird erfasst, eigene Sidecar entsteht.
    await type(vault, handlers, BASE);
    expect(vault._files.has(OWN_PATH)).toBe(true);

    // Der Datei-Sync bringt NUR die Sidecar des Peers (die .md ist noch unterwegs).
    placeForeignSidecar(vault);

    // Tastendruck 1: mergePendingForeign zieht FREMD in den Doc.
    await type(vault, handlers, `${BASE}LOKAL1\n`);
    expect(plugin.crdtManager.getContent(NOTE)).toContain('FREMD');

    // Tastendruck 2 — OHNE Poll dazwischen. Der Nutzer tippt auf dem Text weiter,
    // den seine Datei aktuell trägt (was auch immer davon zurückgeschrieben wurde).
    await type(vault, handlers, `${vault._textFiles.get(NOTE)}LOKAL2\n`);

    const doc = plugin.crdtManager.getContent(NOTE);
    expect(count(doc, 'FREMD')).toBe(1); // RED (ohne Fix): 0 — als Delete-Op verworfen
    expect(count(doc, 'LOKAL1')).toBe(1);
    expect(count(doc, 'LOKAL2')).toBe(1);

    // Und die Löschung darf auch nicht in der eigenen Sidecar stehen (sie ist das,
    // was der Sync zur Gegenseite trägt).
    const persisted = new CrdtManager();
    persisted.applyUpdate(NOTE, decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!)).update);
    expect(count(persisted.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('Plugin-Ebene Kontrolle: der Tastendruck selbst holt die .md auf, der Poll ist danach ein No-op', async () => {
    // Review Runde 2, F-4: Dieser Test hieß „Poll zwischen den Tastendrücken" und
    // behauptete damit eine Bedingung, die es seit Weg A nicht mehr gibt — löschte
    // man den Poll heraus, blieb er grün. Jetzt prüft er, was tatsächlich passiert:
    // der Write-Back des Tastendrucks bringt FREMD in die Datei, der Poll findet
    // nichts mehr zu tun. Die erste Assertion ist die Unterscheidungskraft: ohne den
    // Write-Back im modify-Handler trägt die .md hier noch kein FREMD.
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    await type(vault, handlers, `${BASE}LOKAL1\n`);
    expect(vault._textFiles.get(NOTE)).toContain('FREMD');
    const beforePoll = vault._textFiles.get(NOTE);
    // Der 30-s-Poll läuft — und ändert nichts mehr.
    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get(NOTE)).toBe(beforePoll);

    await type(vault, handlers, `${vault._textFiles.get(NOTE)}LOKAL2\n`);

    const doc = plugin.crdtManager.getContent(NOTE);
    // Genau EINMAL: der Write-Back hat FREMD in die .md gebracht, ein Diff gegen
    // eine veraltete Basis würde ihn als lokale Einfügung ein zweites Mal anwenden.
    expect(count(doc, 'FREMD')).toBe(1);
    expect(count(doc, 'LOKAL1')).toBe(1);
    expect(count(doc, 'LOKAL2')).toBe(1);
    expect(vault._textFiles.get(NOTE)).toBe(doc);
  });

  it('Plugin-Ebene: ein verweigerter Write-Back lässt den Fremd-Edit nicht fallen', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    // Obsidian speichert den nächsten Tastendruck, WÄHREND unser Merge in der
    // Sidecar-IO hängt. Beim Write-Back trägt die Datei damit nicht mehr den Text,
    // den wir gemergt haben — geschrieben wird bewusst nicht (der Edit dürfte nicht
    // überschrieben werden). Der Doc bleibt der Datei also voraus.
    const origProcess = vault.process.bind(vault);
    let raced = false;
    vault.process = async (file: { path: string }, fn: (data: string) => string) => {
      if (!raced) {
        raced = true;
        vault._textFiles.set(NOTE, `${vault._textFiles.get(NOTE)}LOKAL2\n`);
      }
      return origProcess(file, fn);
    };

    await type(vault, handlers, `${BASE}LOKAL1\n`);
    expect(plugin.crdtManager.getContent(NOTE)).toContain('FREMD');
    expect(vault._textFiles.get(NOTE)).not.toContain('FREMD');

    // Obsidians modify-Event für den im Rennen gespeicherten Text.
    await type(vault, handlers, vault._textFiles.get(NOTE)!);

    const doc = plugin.crdtManager.getContent(NOTE);
    expect(count(doc, 'FREMD')).toBe(1);
    expect(count(doc, 'LOKAL1')).toBe(1);
    expect(count(doc, 'LOKAL2')).toBe(1);
  });

  it('Plugin-Ebene: ein GESCHEITERTER Write-Back vergiftet die Diff-Basis nicht', async () => {
    // Review Runde 2, F-2: `vault.process` ruft den Callback und scheitert DANACH
    // am Schreiben (EBUSY / Handle des Sync-Dienstes — das von Task 12 belegte
    // Realumfeld; ebenso volles Volume, read-only). Die Datei trägt weiter den
    // alten Text, die Basis stand aber schon auf dem gemergten. Der nächste
    // `modify` difft dann „gemergt → alt", also die LÖSCHUNG des Fremd-Edits:
    // exakt Fund 1, am Fix vorbei.
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    const origProcess = vault.process.bind(vault);
    let failNext = true;
    vault.process = async (file: { path: string }, fn: (data: string) => string) => {
      if (failNext) {
        failNext = false;
        fn(vault._textFiles.get(file.path)!); // Callback läuft …
        throw new Error('EBUSY'); // … der Write nicht.
      }
      return origProcess(file, fn);
    };

    // Der Wurf darf den modify-Handler nicht als unbehandelte Rejection verlassen.
    await expect(type(vault, handlers, `${BASE}LOKAL1\n`)).resolves.toBeUndefined();
    // Die Datei trägt weiter den Text von vor dem Write-Back.
    expect(vault._textFiles.get(NOTE)).toBe(`${BASE}LOKAL1\n`);
    expect(plugin.crdtManager.getContent(NOTE)).toContain('FREMD');

    await type(vault, handlers, `${BASE}LOKAL1\nLOKAL2\n`);

    const doc = plugin.crdtManager.getContent(NOTE);
    expect(count(doc, 'FREMD')).toBe(1); // RED (HEAD): 0 — als Delete-Op verworfen
    expect(count(doc, 'LOKAL2')).toBe(1);
  });

  it('Plugin-Ebene: verweigerter Write-Back, dann Sync-Overwrite — kein doppelter Fremd-Edit', async () => {
    // Review Runde 2, F-1: derselbe Einstieg wie der Test darüber (Write-Back
    // verweigert, Doc bleibt voraus, Basis steht auf dem .md-Text OHNE FREMD).
    // Danach überschreibt der Datei-Sync die .md mit der GEMERGTEN Fassung des
    // Peers — sie trägt FREMD also schon. Nimmt der Diff jetzt die alte Basis,
    // enthält `patch_make` die Fremd-Einfügung, die `other` bereits hat, und
    // `patch_apply` dedupliziert nicht (WARNUNG in text-merge.ts) → FREMD zweimal.
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    const origProcess = vault.process.bind(vault);
    let raced = false;
    vault.process = async (file: { path: string }, fn: (data: string) => string) => {
      if (!raced) {
        raced = true;
        vault._textFiles.set(NOTE, `${vault._textFiles.get(NOTE)}LOKAL2\n`);
      }
      return origProcess(file, fn);
    };

    await type(vault, handlers, `${BASE}LOKAL1\n`);
    expect(plugin.crdtManager.getContent(NOTE)).toContain('FREMD');
    expect(vault._textFiles.get(NOTE)).not.toContain('FREMD');

    // Der Datei-Sync legt die gemergte Fassung des Peers ab (robocopy liefert .md
    // und Sidecar zusammen — der Task-11-Realfall). LOKAL1/LOKAL2 fallen dabei aus
    // der Datei heraus; das ist die noch offene Rückwärtsbewegung (README §Grenzen)
    // und NICHT Gegenstand dieses Tests.
    await type(vault, handlers, WITH_FOREIGN);

    const doc = plugin.crdtManager.getContent(NOTE);
    expect(count(doc, 'FREMD')).toBe(1); // RED (HEAD): 2 — Basis ohne FREMD, content mit
  });

  it('Handler-Ebene: eine .md, die den Doc-Vorlauf schon trägt, verdoppelt ihn nicht', async () => {
    // Review Runde 2, F-1 isoliert: die Basis (zuletzt gesehener .md-Text) kennt
    // FREMD nicht, der Doc und der neue .md-Inhalt kennen es beide. Der Kurzschluss
    // `content === mergedText` greift NICHT, weil sich die beiden zusätzlich um
    // LOKAL1 unterscheiden.
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);
    placeForeignSidecar(vault);

    // Tastendruck: FREMD kommt in den Doc, die .md behält LOKAL1 (kein Write-Back).
    vault._textFiles.set(NOTE, `${BASE}LOKAL1\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\n`);
    expect(count(manager.getContent(NOTE), 'FREMD')).toBe(1);

    // Sync-Overwrite mit der gemergten Peer-Fassung (trägt FREMD, nicht LOKAL1).
    vault._textFiles.set(NOTE, WITH_FOREIGN);
    await handler.applyLocalContent(NOTE, WITH_FOREIGN);

    expect(count(manager.getContent(NOTE), 'FREMD')).toBe(1); // RED (HEAD): 2
  });

  it('Handler-Ebene: der Doc-Vorlauf allein macht aus dem nächsten Diff keine Löschung', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    // Eigener Stand (Basis) auf der Platte + im Doc.
    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);

    // Fremd-Sidecar ohne zugehörige .md.
    placeForeignSidecar(vault);

    // Tastendruck 1: Fremd-Merge, Doc läuft der .md voraus (kein Write-Back auf
    // dieser Ebene — genau der Zustand, den der Fix aushalten muss).
    vault._textFiles.set(NOTE, `${BASE}LOKAL1\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\n`);
    expect(manager.getContent(NOTE)).toContain('FREMD');
    expect(vault._textFiles.get(NOTE)).not.toContain('FREMD');

    // Tastendruck 2 auf derselben (vorlauf-freien) .md.
    vault._textFiles.set(NOTE, `${BASE}LOKAL1\nLOKAL2\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\nLOKAL2\n`);

    const doc = manager.getContent(NOTE);
    expect(count(doc, 'FREMD')).toBe(1); // RED (ohne Fix): 0
    expect(count(doc, 'LOKAL1')).toBe(1);
    expect(count(doc, 'LOKAL2')).toBe(1);
  });

  it('Plugin-Ebene: nach gelungenem Write-Back bleibt das Löschen der Fremd-Zeile eine Löschung', async () => {
    // Review Runde 2, F-4: deckt `writeBackMerged` → `noteLocalDiffBase` ab
    // (main.ts, Setzen nach dem Write). Ohne diese Zeile bliebe die Basis auf dem
    // .md-Text von VOR dem Write-Back; der Diff „Basis → content" wäre dann leer
    // und die bewusste Löschung der Fremd-Zeile verpuffte — sie käme bei jedem
    // Versuch zurück. Genau die Eigenschaft, die Task 16 nicht opfern darf
    // (Prüfpunkt 6 des Reviews: fremden Text löschen zu können ist der Normalfall).
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    await type(vault, handlers, `${BASE}LOKAL1\n`);
    const afterMerge = vault._textFiles.get(NOTE)!;
    expect(afterMerge).toContain('FREMD'); // Write-Back ist gelungen.

    // Der Nutzer löscht die Zeile der Kollegin bewusst.
    await type(vault, handlers, afterMerge.replace('FREMD\n', ''));

    expect(plugin.crdtManager.getContent(NOTE)).not.toContain('FREMD');
    expect(count(plugin.crdtManager.getContent(NOTE), 'LOKAL1')).toBe(1);
  });

  it('Plugin-Ebene: Poll-Write-Back ohne vorangehenden modify-Write-Back (Review F-3)', async () => {
    // Die Probe PX des Reviews: die Fremd-Sidecar kommt an, OHNE dass im
    // Merge-Fenster getippt wird. Der Write-Back läuft also allein über den Poll
    // (onRemoteYjsUpdate), und erst DANACH tippt die Nutzerin. Diesen Ablauf deckte
    // vorher kein Test ab — T2 hatte seine Prämisse verloren, weil Weg A die .md
    // schon beim Tastendruck zurückschreibt.
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    await plugin.sidecarWatcher.poll();
    const afterPoll = vault._textFiles.get(NOTE)!;
    expect(afterPoll).toBe(WITH_FOREIGN);

    await type(vault, handlers, `${afterPoll}LOKAL\n`);

    const doc = plugin.crdtManager.getContent(NOTE);
    expect(count(doc, 'FREMD')).toBe(1);
    expect(count(doc, 'LOKAL')).toBe(1);
  });

  it('Plugin-Ebene: nach dem Poll-Write-Back bleibt das Löschen der Fremd-Zeile eine Löschung', async () => {
    // Review Runde 2, F-3/F-4: deckt `noteLocalDiffBase` nach dem ERSTEN
    // Write-Back in `onRemoteYjsUpdate` ab. Ohne die Zeile bliebe die Basis auf dem
    // .md-Stand von vor dem Poll (ohne FREMD) — der Diff auf den gelöschten Stand
    // wäre leer und die Löschung verpuffte.
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get(NOTE)).toBe(WITH_FOREIGN);

    await type(vault, handlers, BASE); // Fremd-Zeile bewusst wieder weg

    expect(plugin.crdtManager.getContent(NOTE)).not.toContain('FREMD');
  });

  it('Plugin-Ebene: der Startup-Sweep schreibt den gemergten Stand in die .md', async () => {
    // Review Runde 2, F-4: deckt den Write-Back im Startup-Sweep ab. Der Sweep ist
    // der Pfad, der eine bei geschlossener App angekommene Fremd-Sidecar in den Doc
    // zieht; ohne Write-Back startete die Sitzung im Vorlauf-Zustand und die Datei
    // trüge den Fremd-Edit erst nach dem ersten Poll.
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);
    // Die .md ist neuer als die eigene Sidecar — sonst überspringt der Sweep sie
    // (mtime-Vergleich, Task 12/m-3).
    vault._mdMtimes.set(NOTE, 999);

    await plugin.snapshotStaleMarkdownFiles();

    expect(vault._textFiles.get(NOTE)).toBe(WITH_FOREIGN);
  });

  it('Plugin-Ebene: der zweite Write-Back setzt die Basis auf den tatsächlichen Dateiinhalt', async () => {
    // Review Runde 2, F-4: deckt `noteLocalDiffBase` nach dem ZWEITEN Write-Back in
    // `onRemoteYjsUpdate` ab (pending-Zweig). Dort reicht `main.ts` einen
    // synthetischen Text in `applyLocalContent` (`threeWay`), der so nie in der
    // Datei stand — und der setzt die Basis auf sich selbst. Steht am Ende ein
    // DRITTER Text in der Datei (Editor-Save zwischen den beiden Write-Back-
    // Versuchen), muss die Basis auf ihn korrigiert werden; sonst verbucht der
    // nächste Diff die Differenz „threeWay → Datei" als lokale Löschung.
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    // Editor-Save 1 landet WÄHREND loadAndMerge (Sidecar-IO) in der Datei → der
    // erste Write-Back findet `data !== preMerge` und reicht sie als `pending`.
    const origRead = vault.adapter.readBinary.bind(vault.adapter);
    let injected = false;
    vault.adapter.readBinary = async (p: string) => {
      if (!injected && p === FOREIGN_PATH) {
        injected = true;
        vault._textFiles.set(NOTE, `${BASE}EDIT1\n`);
      }
      return origRead(p);
    };
    // Editor-Save 2 landet zwischen erstem und zweitem Write-Back-Versuch → der
    // zweite findet einen Text, den weder wir noch `pending` kennen, und schreibt
    // nicht. Die Datei trägt danach genau diesen dritten Text.
    const origProcess = vault.process.bind(vault);
    let calls = 0;
    vault.process = async (file: { path: string }, fn: (data: string) => string) => {
      calls += 1;
      if (calls === 2) vault._textFiles.set(NOTE, `${BASE}EDIT2\n`);
      return origProcess(file, fn);
    };

    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get(NOTE)).toBe(`${BASE}EDIT2\n`);
    expect(count(plugin.crdtManager.getContent(NOTE), 'FREMD')).toBe(1);

    // Obsidians modify-Event für Save 2. Ist die Basis der Dateiinhalt, ist der
    // Diff leer und der Fremd-Edit bleibt.
    await type(vault, handlers, `${BASE}EDIT2\n`);

    expect(count(plugin.crdtManager.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('Plugin-Ebene: eine Meldung pro ankommendem Fremd-Edit, nicht pro Tastendruck', async () => {
    // Review Runde 2, F-7: Der Write-Back im modify-Pfad meldet mit derselben
    // `Notice` wie der Poll-Write-Back, und `statusNotice` ist per Default an. Die
    // Sorge wäre eine Meldung pro Tastendruck. Gemessen: nein — nach dem ersten
    // Tastendruck trägt die .md den Fremd-Stand, `merged === expected`, und
    // `writeBackMerged` kehrt vor dem Write zurück. Die Obergrenze ist also die
    // Ankunftsrate fremder Hilfsdateien, nicht die Tipprate.
    (Notice as any).messages = [];
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const storage = makeLocalStorage();
    storage.saveLocalStorage('qollab-client-id', OWN_ID);
    const handlers = new Map<string, (...args: any[]) => any>();
    const vaultWithEvents = Object.assign(vault, {
      on: (event: string, cb: (...args: any[]) => any) => {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref: () => {},
    });
    const plugin = new (CrdtSyncPlugin as any)(
      {
        vault: vaultWithEvents,
        workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
        loadLocalStorage: storage.loadLocalStorage,
        saveLocalStorage: storage.saveLocalStorage,
      },
      {}
    );
    // Default-Einstellung, nicht die Test-Abschaltung.
    plugin._data = { enabled: true, statusNotice: true, tombstones: {} };
    await plugin.onload();

    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    // Fünf Tastendrücke nach der Ankunft EINER Fremd-Sidecar.
    for (let i = 1; i <= 5; i += 1) {
      await type(vault, handlers, `${vault._textFiles.get(NOTE)}LOKAL${i}\n`);
    }

    const merges = (Notice as any).messages.filter((m: string) => /automatisch gemergt/.test(m));
    expect(merges).toHaveLength(1);
    expect(count(plugin.crdtManager.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('Handler-Ebene: Gegenprobe — gleichnamige Neuanlage nach dem Löschen bleibt heil', async () => {
    // Review Runde 2, F-4: GEGENPROBE, kein unterscheidender Test. Die Mutation
    // „`localDiffBase.delete` in `disposeNote` entfernt" lässt die volle Suite grün
    // — und das ist korrekt so: die Neuanlage läuft in den Adopt-Zweig von
    // `ensureDoc`, der die Basis gar nicht liest. Der Test hält den Endzustand fest,
    // damit ein künftiger Pfad, der die Basis hier doch liest, auffällt.
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    vault._textFiles.set(NOTE, 'ALT-A\nALT-B\n');
    await handler.applyLocalContent(NOTE, 'ALT-A\nALT-B\n');

    // Note gelöscht (delete-Handler) …
    handler.disposeNote(NOTE);
    vault._files.delete(OWN_PATH);
    vault._textFiles.delete(NOTE);

    // … und gleichnamig neu angelegt, mit völlig anderem Inhalt.
    vault._textFiles.set(NOTE, 'NEU\n');
    await handler.applyLocalContent(NOTE, 'NEU\n');

    expect(manager.getContent(NOTE)).toBe('NEU\n');
  });

  it('Handler-Ebene: renameNote zieht die Diff-Basis mit', async () => {
    // Review Runde 2, F-4: dieselbe Datei unter neuem Namen. Bliebe der Eintrag auf
    // dem alten Pfad, wäre die Basis unter dem neuen Pfad leer und fiele auf den
    // Doc-Text zurück — der Vorlauf wäre dort wieder blind und der nächste
    // Tastendruck löschte den Fremd-Edit.
    const NEW = 'umbenannt.md';
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);
    placeForeignSidecar(vault);

    // Tastendruck: FREMD kommt in den Doc, die .md bleibt zurück (kein Write-Back
    // auf Handler-Ebene) — der Vorlauf-Zustand.
    vault._textFiles.set(NOTE, `${BASE}LOKAL1\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\n`);
    expect(manager.getContent(NOTE)).toContain('FREMD');

    // Rename: Sidecars ziehen um (das tut der Handler nicht selbst), Doc wird
    // verworfen und unter dem neuen Pfad neu aufgebaut.
    vault._files.set(`.qollab/${NEW}.${OWN_ID}.yjs`, vault._files.get(OWN_PATH)!);
    vault._files.set(`.qollab/${NEW}.${FOREIGN_ID}.yjs`, vault._files.get(FOREIGN_PATH)!);
    vault._files.delete(OWN_PATH);
    vault._files.delete(FOREIGN_PATH);
    vault._textFiles.delete(NOTE);
    vault._textFiles.set(NEW, `${BASE}LOKAL1\n`);
    handler.renameNote(NOTE, NEW);

    // Tastendruck auf dem neuen Pfad.
    vault._textFiles.set(NEW, `${BASE}LOKAL1\nLOKAL2\n`);
    await handler.applyLocalContent(NEW, `${BASE}LOKAL1\nLOKAL2\n`);

    const doc = manager.getContent(NEW);
    expect(count(doc, 'FREMD')).toBe(1);
    expect(count(doc, 'LOKAL2')).toBe(1);
  });

  it('Handler-Ebene: eine echte lokale Löschung bleibt eine Löschung', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    vault._textFiles.set(NOTE, `${BASE}WEG\n`);
    await handler.applyLocalContent(NOTE, `${BASE}WEG\n`);

    // Der Nutzer löscht seine eigene Zeile wieder.
    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);

    expect(manager.getContent(NOTE)).toBe(BASE);
  });

  it('Handler-Ebene: Task-11-Netz — Sync-Overwrite mit dem gemergten Stand erzeugt kein Duplikat', async () => {
    // Abgrenzung zu Task 11: die .md kommt per Datei-Sync bereits MIT dem
    // Fremd-Edit, die Fremd-Sidecar liegt ungemergt daneben. Hier darf der Diff
    // die Fremd-Einfügung nicht als eigene Op erfinden (Duplikat).
    //
    // Review Runde 2, F-4, ehrliches Etikett: Dieser Test kann keine Task-16-Zeile
    // rot machen. Er läuft komplett in den Kurzschluss `content === mergedText`
    // (sync-handler.ts), `base` wird also nie gelesen. Er ist ein Netz für Task 11,
    // kein Test für Task 16. Der unterscheidende Fall — dieselbe Lage PLUS eine
    // zusätzliche Abweichung, so dass der Kurzschluss nicht greift — steht als
    // eigener Test weiter oben („eine .md, die den Doc-Vorlauf schon trägt").
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);
    placeForeignSidecar(vault);

    vault._textFiles.set(NOTE, WITH_FOREIGN);
    await handler.applyLocalContent(NOTE, WITH_FOREIGN);

    expect(count(manager.getContent(NOTE), 'FREMD')).toBe(1);
    const merged = await handler.loadAndMerge(NOTE);
    expect(count(merged as string, 'FREMD')).toBe(1);
  });
});
