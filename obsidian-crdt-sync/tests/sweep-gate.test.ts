// Task 17 / F-2 — Kein Gate zwischen Startup-Sweep und den schon laufenden Triggern
//
// Poll-Intervall und `file-open`-Listener wurden in `onload` registriert, der Sweep
// lief erst in `onLayoutReady`. Ein Trigger, der eine Note erreicht, bevor der Sweep
// sie erfasst hat, merged ohne den nur in der `.md` lebenden Inhalt — und der
// Write-Back schreibt ihn weg (`data === preMerge`).
//
// Der einzige bestehende Reihenfolge-Test (`main-handlers.test.ts:123-145`) pinnt
// nur „Sweep vor `sidecarWatcher.poll`", also den EINEN awaiteten Aufruf. Die zwei
// ungebundenen Pfade — Intervall und `file-open` — deckt er nicht ab. Genau die
// stehen hier.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const NOTE = 'note.md';
// Wird als erste Note gesweept und parkt den Sweep, bis der Test ihn freigibt.
const BLOCKER = 'a-blocker.md';
const GUID = 'a'.repeat(32);
const OWN_ID = 'deadbeef';
const PEER_PATH = '.qollab/note.md.00000001.yjs';
const OWN_PATH = '.qollab/note.md.deadbeef.yjs';

const BASE = 'line-0\n';
const BASE_Y = 'line-0\nEDIT-Y\n'; // Fremd-Edit, lebt nur in der Peer-Sidecar
const BASE_Z = 'line-0\nEDIT-Z\n'; // extern erfasster Edit, lebt nur in der .md

function sidecar(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(encodeStateFile(GUID, mgr.encodeState(NOTE)));
}

// Mock-App, die Intervall- und file-open-Registrierung mitschneidet.
function makeApp(vault: VaultMock) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const registrations: string[] = [];
  let layoutCb: (() => any) | null = null;

  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
  const workspace = {
    on: (event: string, cb: (...args: any[]) => any) => {
      registrations.push('file-open');
      handlers.set('ws:' + event, cb);
      return { __event: 'ws:' + event };
    },
    offref: () => {},
    onLayoutReady: (cb: () => any) => {
      layoutCb = cb;
    },
  };
  const storage = makeLocalStorage();
  // Geräte-ID festnageln, sonst wäre OWN_PATH eine FREMDE Sidecar und der
  // Adopt-Zweig (unionMerge mit der .md) verdeckte den Fund.
  storage.saveLocalStorage('qollab-client-id', OWN_ID);
  const app = {
    vault: vaultWithEvents,
    workspace,
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const origSetInterval = window.setInterval;
  (window as any).setInterval = (fn: any, ms: number) => {
    registrations.push('interval');
    return origSetInterval(fn, ms);
  };
  return { app, handlers, registrations, layout: () => layoutCb };
}

describe('F-2: Trigger-Registrierung liegt hinter dem Sweep', () => {
  it('onload registriert weder Intervall noch file-open; beide erst nach dem Sweep', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    const { app, registrations, layout } = makeApp(vault);
    const plugin: any = new (CrdtSyncPlugin as any)(app, {});

    await plugin.onload();

    // Kern: zwischen onload und onLayoutReady liegt der ganze Layout-Restore.
    // Wäre hier schon etwas scharf, könnte es den Sweep unterlaufen.
    expect(registrations).toEqual([]);

    const order: string[] = [];
    jest.spyOn(plugin, 'snapshotStaleMarkdownFiles').mockImplementation(async () => {
      order.push('sweep');
    });
    jest.spyOn(plugin.sidecarWatcher, 'start').mockImplementation((...args: any[]) => {
      order.push('start');
      return undefined as any;
    });
    jest.spyOn(plugin.sidecarWatcher, 'poll').mockImplementation(async () => {
      order.push('poll');
    });

    await layout()!();

    expect(order).toEqual(['sweep', 'start', 'poll']);
  });
});

// Task 17 / R-2 — Die Reihenfolge darf nicht über eine Ausnahme erzwungen werden
//
// Mit `startSidecarWatcher()` hinter `await runStartupSweep()` legte ein
// werfender Sweep den Watcher für die GANZE Sitzung stumm: kein Intervall, kein
// `file-open`, also keinerlei Remote-Merges. Bis `5c169dc` stand `start()` in
// `onload` und war davon unabhängig. Der Wurf verschwindet dabei lautlos —
// Obsidian ignoriert den Rückgabewert von `onLayoutReady`.
describe('R-2: ein werfender Sweep legt den Watcher nicht still', () => {
  it('Watcher startet und pollt auch nach einem Sweep-Fehler', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    const { app, layout } = makeApp(vault);
    const plugin: any = new (CrdtSyncPlugin as any)(app, {});
    await plugin.onload();

    const order: string[] = [];
    jest.spyOn(plugin, 'snapshotStaleMarkdownFiles').mockImplementation(async () => {
      order.push('sweep');
      // Der belegte Auslöser: EBUSY beim Aufräumen einer Sidecar, durchgereicht
      // von `hasAdoptableGuid` (fängt nur `SidecarReadError`).
      throw new Error('EBUSY: adapter.remove');
    });
    jest.spyOn(plugin.sidecarWatcher, 'start').mockImplementation(() => {
      order.push('start');
      return undefined as any;
    });
    jest.spyOn(plugin.sidecarWatcher, 'poll').mockImplementation(async () => {
      order.push('poll');
    });

    await layout()!();

    // Reihenfolge bleibt erzwungen — der Watcher hängt weiter HINTER dem Sweep,
    // er hängt nur nicht mehr an dessen Erfolg.
    expect(order).toEqual(['sweep', 'start', 'poll']);
    // Und das Gate ist offen, sonst wiese jeder Trigger sich selbst ab.
    expect(plugin.sweepRunning).toBe(false);
  });
});

// Zweite Hälfte von R-2: der Sweep soll an der Stelle gar nicht erst werfen.
// Der bestehende `catch` (main.ts, „Einzelne Datei darf den Sweep nicht
// abbrechen") umschloss nur den `pathQueue.run`-Block — `statSidecar` und
// `hasAdoptableGuid` lagen davor und ungeschützt. Ein EBUSY dort riss den
// gesamten restlichen Sweep mit, und genau dessen Vollständigkeit ist die
// Korrektheitsbedingung von F-2.
describe('R-2: ein Datei-IO-Fehler bricht den Sweep nicht ab', () => {
  it('spätere Notes werden gesweept, obwohl die erste beim Aufräumen wirft', async () => {
    const vault = makeVaultMock();
    const BLOCKER_PEER = `.qollab/${BLOCKER}.00000001.yjs`;
    const BLOCKER_LEGACY = `.qollab/${BLOCKER}.yjs`;

    // Erste Note: keine eigene Sidecar → `hasAdoptableGuid` läuft. Peer-Sidecar
    // (GUID) plus Legacy-Datei mit Ops ⇒ `decodeSiblings` räumt die Legacy-Form
    // ab — und das `remove` wirft.
    vault._textFiles.set(BLOCKER, 'egal\n');
    const peer = new CrdtManager();
    peer.setContent(BLOCKER, 'peer\n');
    vault._files.set(BLOCKER_PEER, toAB(encodeStateFile(GUID, peer.encodeState(BLOCKER))));
    const legacy = new CrdtManager();
    legacy.setContent(BLOCKER, 'alt\n');
    vault._files.set(BLOCKER_LEGACY, toAB(legacy.encodeState(BLOCKER)));

    // Zweite Note: stale .md mit hinterherhinkender eigener Sidecar — die
    // reguläre Sweep-Arbeit, die der Abbruch verschluckte.
    vault._files.set(OWN_PATH, sidecar(BASE));
    vault._textFiles.set(NOTE, BASE_Z);
    vault._mdMtimes.set(NOTE, 999);

    const origRemove = vault.adapter.remove.bind(vault.adapter);
    vault.adapter.remove = async (p: string) => {
      if (p === BLOCKER_LEGACY) throw Object.assign(new Error('EBUSY: ' + p), { code: 'EBUSY' });
      return origRemove(p);
    };

    const { app } = makeApp(vault);
    const plugin: any = new (CrdtSyncPlugin as any)(app, {});
    await plugin.onload();

    await plugin.runStartupSweep();

    // Die zweite Note ist erfasst: ihr eigener Stand wurde neu geschrieben.
    expect(vault._writeCount.get(OWN_PATH) ?? 0).toBeGreaterThan(0);
  });
});

describe('F-2: laufender Sweep hält Trigger offen, statt sie zu bedienen', () => {
  it('file-open-Scan während des Sweeps überschreibt den nur in der .md lebenden Edit nicht', async () => {
    const vault = makeVaultMock();
    // Reihenfolge zählt: getMarkdownFiles liefert Einfügereihenfolge, der Blocker
    // parkt den Sweep also VOR der eigentlichen Note.
    vault._textFiles.set(BLOCKER, 'egal\n');
    vault._files.set(`.qollab/${BLOCKER}.${OWN_ID}.yjs`, sidecar('egal\n'));
    vault._mdMtimes.set(BLOCKER, 999);

    // Eigener Stand hinkt hinterher, die .md trägt EDIT-Z (extern editiert bei
    // geschlossener App), die Peer-Sidecar trägt EDIT-Y.
    vault._files.set(OWN_PATH, sidecar(BASE));
    vault._files.set(PEER_PATH, sidecar(BASE_Y));
    vault._textFiles.set(NOTE, BASE_Z);
    vault._mdMtimes.set(NOTE, 999);

    const { app, layout } = makeApp(vault);

    let release!: () => void;
    const parked = new Promise<void>((r) => (release = r));
    const origRead = vault.read.bind(vault);
    (vault as any).read = async (file: { path: string }) => {
      if (file.path === BLOCKER) await parked;
      return origRead(file);
    };

    const plugin: any = new (CrdtSyncPlugin as any)(app, {});
    await plugin.onload();

    // Sweep starten, aber nicht abwarten — er hängt am Blocker.
    const sweep = layout()!();

    // Genau hier feuert im Realbetrieb `file-open` für die zuletzt offene Note.
    await plugin.sidecarWatcher.scanNote(NOTE);

    // Ohne Gate liefe jetzt loadAndMerge im own-Branch (die .md wird dort bewusst
    // nicht eingespielt), und der Write-Back schriebe `base+Y` — EDIT-Z wäre aus
    // Datei UND CRDT verschwunden.
    expect(vault._textFiles.get(NOTE)).toContain('EDIT-Z');

    release();
    await sweep;

    // Der Sweep hat EDIT-Z erfasst …
    expect(vault._textFiles.get(NOTE)).toContain('EDIT-Z');

    // … und der abgelehnte Trigger blieb unverbraucht: derselbe Sidecar-Stand
    // löst erneut aus und zieht EDIT-Y nach.
    await plugin.sidecarWatcher.scanNote(NOTE);
    expect(vault._textFiles.get(NOTE)).toContain('EDIT-Z');
    expect(vault._textFiles.get(NOTE)).toContain('EDIT-Y');
  });
});
