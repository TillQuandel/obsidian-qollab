// Szenariosuche Welle 2 — Wechselwirkung der Fixes vom 31.07.–02.08.
//
// Reine REPRODUKTIONEN. Keine Änderung unter `src/`. Jeder Block hat eine
// Gegenprobe, die das Messinstrument gegen einen bekannten Zustand validiert:
// ohne sie beweist das Schweigen einer Messung nichts.

import { Notice, TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import {
  makeVaultMock,
  makeLocalStorage,
  toArrayBuffer as toAB,
  VaultMock,
} from './helpers/vault-mock';

const OWN_ID = 'deadbeef';
const GUID = 'a'.repeat(32);

function sidecarFor(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent('x.md', text);
  return toAB(encodeStateFile(GUID, mgr.encodeState('x.md')));
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  f.stat = { mtime: 0, ctime: 0, size: 0 };
  return f;
}

beforeEach(() => {
  (Notice as any).messages.length = 0;
});

// ===========================================================================
// A) `reconcileSweepCursor` gegen EINE überlebende Datei
//
// Der Fix aus `e3494a6` nennt seine Feststellung „EXAKT, keine Heuristik":
// Merker gefüllt + kein einziges `.qollab`-File ⇒ Verlust. Der Merker ist aber
// PRO NOTE geführt, die Prüfung ist ALL-OR-NOTHING über den ganzen Baum. Eine
// einzige verbliebene oder neu geschriebene Datei — und jede `saveState` nach
// dem Verlust schreibt genau eine — macht die Selbstheilung für ALLE übrigen
// Notizen unerreichbar, ohne Meldung.
// ===========================================================================

function makeCoveredVault(ordner: string[], proOrdner: number): VaultMock {
  const vault = makeVaultMock();
  for (const o of ordner) {
    for (let i = 0; i < proOrdner; i++) {
      const p = `${o}/note-${i}.md`;
      vault._textFiles.set(p, `Inhalt ${o} ${i}\n`);
      vault._mdMtimes.set(p, 10);
      vault._files.set(`.qollab/${p}.${OWN_ID}.yjs`, sidecarFor(`Inhalt ${o} ${i}\n`));
      vault._mtimes.set(`.qollab/${p}.${OWN_ID}.yjs`, 99);
    }
    vault._folders.add(`.qollab/${o}`);
  }
  vault._folders.add('.qollab');
  return vault;
}

function countSidecarStats(vault: VaultMock): { n: number } {
  const c = { n: 0 };
  const orig = vault.adapter.stat.bind(vault.adapter);
  vault.adapter.stat = async (p: string) => {
    if (p.endsWith('.yjs')) c.n++;
    return orig(p);
  };
  return c;
}

function makeDevice(vault: VaultMock, store: any, shared: { value: any }) {
  const vaultWithEvents = Object.assign(vault, { on: () => ({}), offref: () => {} });
  store.saveLocalStorage('qollab-client-id', OWN_ID);
  const app = {
    vault: vaultWithEvents,
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: store.loadLocalStorage,
    saveLocalStorage: store.saveLocalStorage,
  };
  const plugin: any = new (CrdtSyncPlugin as any)(app, {});
  plugin.loadData = async () => shared.value;
  plugin.saveData = async (d: any) => {
    shared.value = JSON.parse(JSON.stringify(d));
  };
  return plugin;
}

async function sweep(vault: VaultMock, store: any, shared: { value: any }) {
  const plugin = makeDevice(vault, store, shared);
  await plugin.onload();
  await plugin.runStartupSweep();
  plugin.onunload();
  return plugin;
}

const cursorOf = (store: any) =>
  (store._store.get('qollab-sweep-cursor') ?? {}) as Record<string, unknown>;
const qollabNotices = () =>
  (Notice as any).messages.filter((m: string) => m.includes('.qollab'));

function deleteAllSidecars(vault: VaultMock): void {
  vault._files.clear();
  vault._mtimes.clear();
  vault._folders.clear();
}

describe('A) reconcileSweepCursor: eine einzige Datei entwertet den Fix', () => {
  // Gegenprobe / Instrument-Validierung: der Vollverlust wird erkannt. Ohne
  // diesen Nachweis könnte das Schweigen im Teilverlust auch am Harness liegen.
  it('KONTROLLE — Vollverlust: Meldung, Merker verworfen, jede Note wieder angesehen', async () => {
    const vault = makeCoveredVault(['alpha', 'beta'], 3);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);
    expect(Object.keys(cursorOf(store))).toHaveLength(6);

    deleteAllSidecars(vault);
    (Notice as any).messages.length = 0;
    const stats = countSidecarStats(vault);
    await sweep(vault, store, shared);

    expect(qollabNotices()).toHaveLength(1);
    expect(cursorOf(store)).toEqual({});
    expect(stats.n).toBe(6);
  });

  // A1: Der Nutzer löscht einen UNTERORDNER von `.qollab` (oder der Datei-Sync
  // trägt die Löschung nur teilweise zu). Für die Notizen darunter ist der
  // Zustand exakt der aus R2-35: eigene UND fremde Hilfsdatei weg, `.md`
  // unverändert, Merker warm. Der Poll sieht dort nichts (keine Datei = kein
  // Trigger), `loadAndMerge` hat nichts zurückzuholen.
  it('A1 — halber `.qollab`-Baum gelöscht: kein Wort, kein Blick, Merker bleibt warm', async () => {
    const vault = makeCoveredVault(['alpha', 'beta'], 3);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);
    expect(Object.keys(cursorOf(store))).toHaveLength(6);

    // Nur `.qollab/alpha` verschwindet. `.qollab/beta` bleibt vollständig.
    for (const k of [...vault._files.keys()]) {
      if (k.startsWith('.qollab/alpha/')) {
        vault._files.delete(k);
        vault._mtimes.delete(k);
      }
    }
    vault._folders.delete('.qollab/alpha');

    (Notice as any).messages.length = 0;
    const stats = countSidecarStats(vault);
    await sweep(vault, store, shared);

    // GEMESSEN: keine Meldung, kein einziger Dateizugriff, Merker unverändert.
    expect(qollabNotices()).toHaveLength(0);
    expect(stats.n).toBe(0);
    expect(Object.keys(cursorOf(store))).toHaveLength(6);
    // Und die drei alpha-Notizen haben nachweislich keine Hilfsdatei mehr.
    expect([...vault._files.keys()].filter((k) => k.startsWith('.qollab/alpha/'))).toEqual([]);
  });

  // A2: der eigentliche Wechselwirkungs-Fall. `.qollab` wird VOLLSTÄNDIG
  // gelöscht, während die App läuft (Obsidian feuert für Dot-Ordner keine
  // Events, das Plugin merkt nichts). Der nächste `saveState` — ein einziger
  // Tastendruck in einer einzigen Notiz, oder der neue `holeEigenenStandNach`
  // im rename-Pfad — legt `.qollab` mit EINER Datei wieder an. Damit ist die
  // Selbstheilung beim nächsten Start tot.
  it('A2 — ein `saveState` nach dem Verlust schaltet die Selbstheilung dauerhaft ab', async () => {
    const vault = makeCoveredVault(['alpha'], 5);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);
    expect(Object.keys(cursorOf(store))).toHaveLength(5);

    // Nutzer löscht `.qollab` im Explorer, App läuft weiter.
    deleteAllSidecars(vault);

    // Genau ein Edit in genau einer Notiz, über den regulären modify-Pfad.
    const laufend = makeDevice(vault, store, shared);
    const handlers = new Map<string, (...a: any[]) => any>();
    (laufend as any).app.vault.on = (e: string, cb: any) => {
      handlers.set(e, cb);
      return {};
    };
    await laufend.onload();
    vault._textFiles.set('alpha/note-2.md', 'Inhalt alpha 2\nneue Zeile\n');
    await handlers.get('modify')!(tfile('alpha/note-2.md'));
    laufend.onunload();

    // `.qollab` trägt jetzt exakt eine Datei.
    expect([...vault._files.keys()]).toHaveLength(1);

    (Notice as any).messages.length = 0;
    const angesehen: string[] = [];
    const origStat = vault.adapter.stat.bind(vault.adapter);
    vault.adapter.stat = async (p: string) => {
      if (p.endsWith('.yjs')) angesehen.push(p);
      return origStat(p);
    };
    await sweep(vault, store, shared);

    // GEMESSEN: der Verlust der übrigen vier Notizen bleibt unbemerkt und
    // ungemeldet; sie werden weiterhin blind übersprungen. Angesehen wird
    // ausschließlich die eine Notiz, deren `.md` sich geändert hat.
    expect(qollabNotices()).toHaveLength(0);
    expect(angesehen.filter((p) => !p.includes('note-2'))).toEqual([]);
    // Die vier unberührten Notizen behalten ihren warmen Merker — obwohl ihre
    // Historie nachweislich weg ist. Sie kommen nie wieder in den Sync.
    expect(Object.keys(cursorOf(store)).sort()).toEqual([
      'alpha/note-0.md',
      'alpha/note-1.md',
      'alpha/note-3.md',
      'alpha/note-4.md',
    ]);
    expect([...vault._files.keys()]).toHaveLength(1);
  });
});

// ===========================================================================
// C) `reconcileSweepCursor` ist der erste IO-Schritt des Sweeps — und der
//    einzige AUSSERHALB des Pro-Datei-`try`, den Task 17/R-2 ausdrücklich um
//    die ganze Pro-Datei-Arbeit gelegt hat („einzelne Datei bricht den Sweep
//    nicht ab"). Ein transienter Lesefehler auf `.qollab` (das
//    Sync-Tool-hält-ein-Handle-Szenario, um das Task 17 kreist) reisst damit
//    seit dem Fix den GANZEN Sweep ab, bevor eine einzige Notiz angesehen wurde.
//
//    Der Kontrast isoliert die Ursache: derselbe IO-Fehler, einmal mit warmem
//    und einmal mit leerem Merker. Bei leerem Merker kehrt
//    `reconcileSweepCursor` vor jedem Dateizugriff zurück — dann trägt der
//    Sweep den Fehler wie vorgesehen pro Datei.
// ===========================================================================

function makeStaleVault(n: number): VaultMock {
  const vault = makeVaultMock();
  for (let i = 0; i < n; i++) {
    const p = `alpha/note-${i}.md`;
    vault._textFiles.set(p, `Inhalt ${i}\n`);
    vault._mdMtimes.set(p, 10);
    vault._files.set(`.qollab/${p}.${OWN_ID}.yjs`, sidecarFor(`Inhalt ${i}\n`));
    vault._mtimes.set(`.qollab/${p}.${OWN_ID}.yjs`, 99);
  }
  vault._folders.add('.qollab');
  vault._folders.add('.qollab/alpha');
  return vault;
}

// Offline-Edit an allen Notizen: die `.md` ist jetzt neuer als die Hilfsdatei.
function offlineEdits(vault: VaultMock, n: number): void {
  for (let i = 0; i < n; i++) {
    const p = `alpha/note-${i}.md`;
    vault._textFiles.set(p, `Inhalt ${i}\noffline\n`);
    vault._mdMtimes.set(p, 500);
  }
}

// EIN transienter Lesefehler auf `.qollab` — genau der Fall, für den Task 17/R-2
// den Pro-Datei-`try` gebaut hat („einzelne Datei bricht den Sweep nicht ab").
function einTransienterListenfehler(vault: VaultMock): void {
  const orig = vault.adapter.list.bind(vault.adapter);
  let verbraucht = false;
  vault.adapter.list = async (dir: string) => {
    if (!verbraucht && dir.startsWith('.qollab')) {
      verbraucht = true;
      throw new Error('EBUSY: resource busy or locked');
    }
    return orig(dir);
  };
}

describe('C) reconcileSweepCursor: neuer Totalabbruch-Punkt vor der ersten Notiz', () => {
  it('C1 — warmer Merker + Lesefehler auf `.qollab`: KEINE einzige Notiz wird erfasst', async () => {
    const vault = makeStaleVault(3);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared); // Merker füllen
    expect(Object.keys(cursorOf(store))).toHaveLength(3);

    offlineEdits(vault, 3);
    einTransienterListenfehler(vault);

    const plugin = makeDevice(vault, store, shared);
    await plugin.onload();
    await expect(plugin.runStartupSweep()).rejects.toThrow('EBUSY');

    // Kein einziger Offline-Edit ist im CRDT gelandet — der Fehler traf
    // `hasAnySidecarFile`, also vor der ersten Notiz.
    const erfasst = [0, 1, 2].filter((i) =>
      plugin.crdtManager.getContent(`alpha/note-${i}.md`).includes('offline')
    );
    expect(erfasst).toEqual([]);
    plugin.onunload();
  });

  // C3: die Folge. `onLayoutReady` fängt den Wurf nur, um DANACH den Watcher zu
  // starten und zu pollen — das Gate `sweepRunning` steht dann schon wieder auf
  // false. Genau davor schützt Task 17/F-2: „vor Sweep-Ende sind die lokalen
  // Snapshots nicht aktuell, und ein Merge auf dieser Grundlage löscht nie
  // erfassten `.md`-Inhalt."
  it('C3 — SCHADEN: der Poll hinter dem abgebrochenen Sweep löscht den Offline-Edit', async () => {
    const vault = makeStaleVault(1);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    const p = 'alpha/note-0.md';
    const eigen = `.qollab/${p}.${OWN_ID}.yjs`;
    const basisBytes = vault._files.get(eigen)!;
    // Offline-Edit bei geschlossener App.
    vault._textFiles.set(p, 'Inhalt 0\nOFFLINE\n');
    vault._mdMtimes.set(p, 500);
    // Der Peer hat vom gemeinsamen Stand aus weitergeschrieben.
    vault._files.set(`.qollab/${p}.cafebabe.yjs`, fremdSidecar(basisBytes, 'Inhalt 0\nFREMD\n'));

    einTransienterListenfehler(vault);

    const plugin = makeDevice(vault, store, shared);
    await plugin.onload();
    // Das ist wörtlich der Ablauf aus `onLayoutReady`.
    try {
      await plugin.runStartupSweep();
    } catch {
      /* onLayoutReady loggt nur */
    }
    await plugin.sidecarWatcher.poll();

    const datei = vault._textFiles.get(p) ?? '';
    expect(datei).toContain('FREMD');
    expect(datei).toContain('OFFLINE');
    plugin.onunload();
  });

  it('KONTROLLE C2 — derselbe eine Fehler bei leerem Merker: 2 von 3 Notizen kommen durch', async () => {
    const vault = makeStaleVault(3);
    const store = makeLocalStorage(); // Merker leer → reconcile macht kein IO
    const shared = { value: null as any };

    offlineEdits(vault, 3);
    einTransienterListenfehler(vault);

    const plugin = makeDevice(vault, store, shared);
    await plugin.onload();
    await expect(plugin.runStartupSweep()).resolves.toBeUndefined();

    // Derselbe eine Fehler kostet genau EINE Notiz, nicht den ganzen Sweep.
    const erfasst = [0, 1, 2].filter((i) =>
      plugin.crdtManager.getContent(`alpha/note-${i}.md`).includes('offline')
    );
    expect(erfasst).toEqual([1, 2]);
    plugin.onunload();
  });
});

// ===========================================================================
// B) Der neue modify-Abbruch stellt „lokaler Edit nicht erfasst" her — ohne
//    die Markierung zu setzen, an der der Rest des Systems genau diesen
//    Zustand erkennt (`abortedReads` / `pendingLocalContent`, Task 12/F-2b).
//
// Der Fix-Kommentar sagt: „Verloren ist er nicht — der nächste `modify` erfasst
// ihn unter dem neuen Pfad". Trifft aber vorher ein Fremd-Trigger ein, schreibt
// `onRemoteYjsUpdate` über `data === preMerge` den Doc-Stand zurück — und der
// kennt den Edit nicht.
// ===========================================================================

function makeApp(vault: VaultMock) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
  const storage = makeLocalStorage();
  const app = {
    vault: vaultWithEvents,
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
    },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  return { app, handlers };
}

async function loadPlugin(vault: VaultMock) {
  const { app, handlers } = makeApp(vault);
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin: plugin as any, handlers };
}

const ALT = 'a.md';
const NEU = 'b.md';
const BASIS = 'Zeile 1\nZeile 2\n';
const MIT_LOKAL = 'Zeile 1\nZeile 2\nLOKAL\n';

// Eine kompatible Fremd-Hilfsdatei: gleiche GUID, gleiche Historie wie unsere,
// plus eine Zeile des Peers.
function fremdSidecar(eigeneBytes: ArrayBuffer, peerText: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.applyUpdate('p', decodeStateFile(new Uint8Array(eigeneBytes)).update);
  mgr.setContent('p', peerText);
  const guid = decodeStateFile(new Uint8Array(eigeneBytes)).guid!;
  return toAB(encodeStateFile(guid, mgr.encodeState('p')));
}

describe('B) modify-Abbruch bei Umbenennung: der Edit ist ungeschützt', () => {
  // Gemeinsamer Aufbau: Notiz mit lebender Historie, dann ein Nutzer-Edit,
  // dessen modify-Lauf durch eine Umbenennung abbricht.
  async function abgebrochenerEdit() {
    const vault = makeVaultMock();
    vault._textFiles.set(ALT, BASIS);
    const { plugin, handlers } = await loadPlugin(vault);
    const datei = tfile(ALT);

    // 1) Erster Lauf: Historie unter a.md.
    await handlers.get('modify')!(datei);
    const eigen = `.qollab/${ALT}.${plugin.clientId}.yjs`;
    expect(vault._files.has(eigen)).toBe(true);
    // Stand VOR dem lokalen Edit — die Basis, von der der Peer ausgeht.
    const basisBytes = vault._files.get(eigen)!;

    // 2) Der Nutzer tippt. Obsidian schreibt die Datei und feuert modify.
    vault._textFiles.set(ALT, MIT_LOKAL);

    // 3) Im `vault.read`-Fenster benennt der Auto-Note-Mover um: dasselbe
    //    TFile-Objekt, `path` in place geändert, Inhalt wandert mit.
    const echtesRead = vault.read;
    let umbenannt = false;
    vault.read = async (file: { path: string }) => {
      const inhalt = await echtesRead(file);
      if (!umbenannt && file.path === ALT) {
        umbenannt = true;
        vault._textFiles.delete(ALT);
        vault._textFiles.set(NEU, inhalt);
        (file as TFile).path = NEU;
        (file as TFile).name = NEU;
      }
      return inhalt;
    };
    await handlers.get('modify')!(datei);
    vault.read = echtesRead;

    // 4) rename-Handler zieht Hilfsdateien und Zustand nach.
    await handlers.get('rename')!(datei, ALT);

    return { vault, plugin, handlers, basisBytes };
  }

  it('B0 — Vorbedingung: der Edit ist NUR in der .md, nicht im CRDT', async () => {
    const { vault, plugin } = await abgebrochenerEdit();
    expect(vault._textFiles.get(NEU)).toBe(MIT_LOKAL);
    expect(plugin.crdtManager.getContent(NEU)).toBe(BASIS);
  });

  it('B1 — der bestehende Rückkanal ist NICHT bewaffnet', async () => {
    const { plugin } = await abgebrochenerEdit();
    // Genau diese Markierung hält `onRemoteYjsUpdate` davon ab, einen nicht
    // erfassten Edit zu überschreiben (Task 12/F-2b, R2-1).
    expect(plugin.syncHandler.hasAbortedRead(NEU)).toBe(false);
    expect(plugin.syncHandler.pendingLocalContent(NEU)).toBeUndefined();
  });

  it('B2 — SCHADEN: der nächste Fremd-Trigger löscht den lokalen Edit', async () => {
    const { vault, plugin, basisBytes } = await abgebrochenerEdit();

    // Der Peer hat dieselbe Inkarnation weiterentwickelt — ausgehend vom Stand
    // VOR unserem lokalen Edit (den er nie gesehen hat); seine Hilfsdatei
    // trifft ein (Poll-Trigger).
    vault._files.set(`.qollab/${NEU}.cafebabe.yjs`, fremdSidecar(basisBytes, BASIS + 'FREMD\n'));

    await plugin.pathQueue.run(NEU, () => plugin.onRemoteYjsUpdate(NEU));

    const datei = vault._textFiles.get(NEU) ?? '';
    // Der Fremd-Edit ist da …
    expect(datei).toContain('FREMD');
    // … der lokale ist weg. In Datei UND CRDT.
    expect(datei).toContain('LOKAL');
    expect(plugin.crdtManager.getContent(NEU)).toContain('LOKAL');
  });

  // ------------------------------------------------------------------
  // Gegenproben: dieselbe Messung, aber mit Zuständen, in denen der Edit
  // nachweislich überleben MUSS. Sie validieren das Instrument.
  // ------------------------------------------------------------------
  it('KONTROLLE B3 — ohne Umbenennung überlebt der lokale Edit', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(ALT, BASIS);
    const { plugin, handlers } = await loadPlugin(vault);
    const datei = tfile(ALT);
    await handlers.get('modify')!(datei);
    const eigen = `.qollab/${ALT}.${plugin.clientId}.yjs`;
    const basisBytes = vault._files.get(eigen)!;

    vault._textFiles.set(ALT, MIT_LOKAL);
    await handlers.get('modify')!(datei);

    vault._files.set(`.qollab/${ALT}.cafebabe.yjs`, fremdSidecar(basisBytes, BASIS + 'FREMD\n'));
    await plugin.pathQueue.run(ALT, () => plugin.onRemoteYjsUpdate(ALT));

    const datei2 = vault._textFiles.get(ALT) ?? '';
    expect(datei2).toContain('FREMD');
    expect(datei2).toContain('LOKAL');
  });

  // B5: derselbe Abbruch im SWEEP. Das Fenster ist dort nicht 30 s breit,
  // sondern null: `onLayoutReady` ruft direkt hinter dem Sweep
  // `startSidecarWatcher()` und `poll()` — der Fremd-Trigger folgt unmittelbar.
  it('B5 — SCHADEN im Sweep-Pfad: der Offline-Edit stirbt beim direkt folgenden Poll', async () => {
    const vault = makeVaultMock();
    const OFFLINE = BASIS + 'OFFLINE\n';
    // Eigene Historie auf dem Stand BASIS, `.md` per Offline-Edit voraus.
    const eigenAlt = `.qollab/${ALT}.${OWN_ID}.yjs`;
    vault._textFiles.set(ALT, OFFLINE);
    vault._mdMtimes.set(ALT, 500);
    vault._files.set(eigenAlt, sidecarFor(BASIS));
    vault._mtimes.set(eigenAlt, 99);
    vault._folders.add('.qollab');
    const basisBytes = vault._files.get(eigenAlt)!;

    const store = makeLocalStorage();
    const shared = { value: null as any };
    const handlers = new Map<string, (...a: any[]) => any>();
    const plugin = makeDevice(vault, store, shared);
    (plugin as any).app.vault.on = (e: string, cb: any) => {
      handlers.set(e, cb);
      return {};
    };
    await plugin.onload();

    // Im `vault.read`-Fenster des Sweeps benennt etwas um (der Sweep schreibt
    // selbst `.md`-Dateien und löst damit umbenennende Plugins aus — so steht es
    // im Fix-Kommentar).
    const echtesRead = vault.read;
    let umbenannt = false;
    let umbenanntesFile: TFile | null = null;
    vault.read = async (file: { path: string }) => {
      const inhalt = await echtesRead(file);
      if (!umbenannt && file.path === ALT) {
        umbenannt = true;
        vault._textFiles.delete(ALT);
        vault._textFiles.set(NEU, inhalt);
        vault._mdMtimes.set(NEU, 500);
        (file as TFile).path = NEU;
        (file as TFile).name = NEU;
        umbenanntesFile = file as TFile;
      }
      return inhalt;
    };
    await plugin.runStartupSweep();
    vault.read = echtesRead;
    expect(umbenannt).toBe(true);

    // rename-Handler zieht nach.
    await handlers.get('rename')!(umbenanntesFile!, ALT);

    // Der Peer hat vom Stand BASIS aus weitergeschrieben; seine Hilfsdatei ist
    // beim Start schon da → der Initial-Poll direkt hinter dem Sweep triggert.
    vault._files.set(`.qollab/${NEU}.cafebabe.yjs`, fremdSidecar(basisBytes, BASIS + 'FREMD\n'));
    await plugin.pathQueue.run(NEU, () => (plugin as any).onRemoteYjsUpdate(NEU));

    const datei = vault._textFiles.get(NEU) ?? '';
    expect(datei).toContain('FREMD');
    expect(datei).toContain('OFFLINE');
    plugin.onunload();
  });

  it('KONTROLLE B4 — beim IO-Abbruch (SidecarReadError) überlebt er, weil die Markierung steht', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(ALT, BASIS);
    const { plugin, handlers } = await loadPlugin(vault);
    const datei = tfile(ALT);
    await handlers.get('modify')!(datei);
    const eigen = `.qollab/${ALT}.${plugin.clientId}.yjs`;

    // Fremd-Hilfsdatei liegt schon da, ist aber unlesbar → applyLocalContent
    // bricht mit SidecarReadError ab und MARKIERT.
    vault._files.set(
      `.qollab/${ALT}.cafebabe.yjs`,
      fremdSidecar(vault._files.get(eigen)!, BASIS + 'FREMD\n')
    );
    const origRead = vault.adapter.readBinary.bind(vault.adapter);
    vault.adapter.readBinary = async (p: string) => {
      if (p.endsWith('cafebabe.yjs')) throw new Error('EBUSY');
      return origRead(p);
    };

    vault._textFiles.set(ALT, MIT_LOKAL);
    await handlers.get('modify')!(datei);
    expect(plugin.syncHandler.hasAbortedRead(ALT)).toBe(true);

    // Datei wieder lesbar, Fremd-Trigger.
    vault.adapter.readBinary = origRead;
    await plugin.pathQueue.run(ALT, () => plugin.onRemoteYjsUpdate(ALT));

    const datei2 = vault._textFiles.get(ALT) ?? '';
    expect(datei2).toContain('FREMD');
    expect(datei2).toContain('LOKAL');
  });
});
