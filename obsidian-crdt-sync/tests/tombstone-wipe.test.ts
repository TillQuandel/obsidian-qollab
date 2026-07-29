// F1-Wipe-Regression + Guard-2-Verifikation
//
// Szenario: A löscht note.md. B war offline und editiert weiter. Der Sync-Dienst
// behandelt Delete-vs-Edit als Konflikt und behält die .md (Standard OneDrive/Dropbox)
// → note.md kehrt auf A zurück.
//
// Phase 1: B's stale Sidecar (GUID G, auf A getombstoned) erreicht A — .md fehlt.
//   Guard 1 (loadAndMerge): früher legte ensureDoc hier einen leeren Orphan-Sidecar an
//   (neue GUID Gx). Mit Guard 1 bricht loadAndMerge vor ensureDoc ab (return null).
// Phase 2: .md ist via Sync zurück; B schreibt erneut unter G.
//   Ohne Guard 1 würde der leere Gx-Stand den Write-Back auf '' kippen.
//   Mit Guard 1 ist kein Orphan da → adopt-Zweig injiziert .md-Text → FULL bleibt.
//
// Guard 2 (onRemoteYjsUpdate): block wenn merged==='' UND keine Ops im Doc
// (historienloser Frisch-Doc). Echte Leerung (Delete-Ops im Doc) darf nicht geblockt werden.

import CrdtSyncPlugin from '../src/main';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'note.md';
// Codex-LOW: gültige 8-lowercase-hex clientIds (filterYjsFiles-konform)
const B_YJS = '.qollab/note.md.deadbeef.yjs';
const OWN_YJS = '.qollab/note.md.a1b2c3d4.yjs';
const G = 'ff'.repeat(16); // GUID der gelöschten Inkarnation
const FULL = 'Wichtiger Inhalt\nZeile 2\nZeile 3\n';

// Baut einen Sidecar mit GUID G und dem angegebenen Textinhalt.
function bSidecar(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(encodeStateFile(G, mgr.encodeState(NOTE)));
}

function makeWipePlugin(vault: ReturnType<typeof makeVaultMock>) {
  const plugin = new (CrdtSyncPlugin as any)({ vault }, {});
  plugin.settings = {
    enabled: true,
    statusNotice: false,
    clientId: 'a1b2c3d4', // Codex-LOW: gültige 8-hex clientId
    tombstones: { [G]: Date.now() }, // A hat GUID G getombstoned
  };
  plugin.crdtManager = new CrdtManager();
  plugin.syncHandler = new SyncHandler(vault as any, plugin.crdtManager, 'a1b2c3d4', {
    has: (g: string) => g in plugin.settings.tombstones,
    add: async (g: string) => {
      plugin.settings.tombstones[g] = Date.now();
    },
  });
  return plugin as any;
}

describe('F1-Guard 1: kein Orphan-Sidecar ohne .md, Note überlebt .md-Resurrection', () => {
  it('Phase 1 legt keinen eigenen Sidecar an; Phase 2 lässt .md intakt', async () => {
    const vault = makeVaultMock();
    const plugin = makeWipePlugin(vault);

    // Phase 1: B's stale Sidecar (G, getombstoned) kommt an — .md noch nicht da.
    vault._files.set(B_YJS, bSidecar(FULL));
    await plugin.onRemoteYjsUpdate(NOTE);

    // Guard 1 muss vor ensureDoc/saveState abbrechen — kein Orphan-Sidecar.
    expect(vault._files.has(OWN_YJS)).toBe(false);

    // Phase 2: .md ist via Sync zurück. B schreibt erneut unter G.
    vault._textFiles.set(NOTE, FULL);
    vault._files.set(B_YJS, bSidecar(FULL + 'Neue Zeile von B\n'));
    await plugin.onRemoteYjsUpdate(NOTE);

    // .md muss FULL enthalten — kein Wipe durch leeren Orphan-State.
    expect(vault._textFiles.get(NOTE)).toBe(FULL);
  });
});

describe('F1-Guard 2: echte Leerung bleibt möglich', () => {
  it('Doc mit Delete-Ops, merged="": Write-Back leert die .md (Guard 2 greift nicht)', async () => {
    const vault = makeVaultMock();
    const plugin = new (CrdtSyncPlugin as any)({ vault }, {});
    plugin.settings = { enabled: true, statusNotice: false, clientId: 'a1b2c3d4', tombstones: {} };
    plugin.crdtManager = new CrdtManager();
    plugin.syncHandler = new SyncHandler(vault as any, plugin.crdtManager, 'a1b2c3d4');

    // Gemeinsame Basis: FULL auf eigenem und Remote-Doc (geteilte Yjs-Historie).
    const base = new CrdtManager();
    base.setContent(NOTE, FULL);
    const baseState = base.encodeState(NOTE);

    // Eigener Sidecar: Basis-Stand (FULL, als Legacy-Format).
    vault._files.set(OWN_YJS, toAB(baseState));

    // Remote: Basis übernehmen, dann allen Text löschen → Delete-Ops im Doc.
    const remote = new CrdtManager();
    remote.applyUpdate(NOTE, baseState);
    remote.setContent(NOTE, '');
    vault._files.set(B_YJS, toAB(remote.encodeState(NOTE)));

    vault._textFiles.set(NOTE, FULL);

    await plugin.onRemoteYjsUpdate(NOTE);

    // Guard 2 darf echte Leerung (Doc hat Delete-Ops → hasOps=true) nicht blocken.
    expect(vault._textFiles.get(NOTE)).toBe('');
  });
});

// Test 3 (Task 15 — Nicht-Regression): Zombie-Schutz ueberlebt Fix A/B.
//
// Szenario: note-t3.md wird geloescht (Tombstone auf G_OLD_WIPE via delete-Handler),
// dann gleichnamig neu angelegt. Geraet-B-Sidecar (GUID G_OLD_WIPE, GLEICHER Pfad)
// trifft ein. Er muss weiterhin ignoriert und geloescht werden.
//
// Dieser Test muss VOR UND NACH Fix GRUEN sein (Nicht-Regression).
// Falls er nach Fix rot wird, ist das ein Rueckschritt im Zombie-Schutz.
//
// Testet: Nach Fix A schreibt delete-Handler key = 'note-t3.md G_OLD_WIPE'.
// decodeSiblings prueft has(G_OLD_WIPE, 'note-t3.md') -> Treffer -> stale Sidecar geloescht.

const G_OLD_WIPE = 'cc'.repeat(16);
const B_ID_WIPE = 'babe0001';
const NOTE_T3 = 'note-t3.md';

function makeSidecarT3(guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE_T3, text);
  return toAB(encodeStateFile(guid, mgr.encodeState(NOTE_T3)));
}

async function bootT3(vault: ReturnType<typeof makeVaultMock>) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const storage = makeLocalStorage();
  const app = {
    vault: {
      ...vault,
      on: (event: string, cb: (...args: any[]) => any) => {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref: () => {},
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
    },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin: plugin as any, handlers };
}

describe('Test 3 — Zombie-Schutz: stale Sidecar unter GLEICHEM Pfad geblockt (Nicht-Regression)', () => {
  it('stale Geraet-B-Sidecar (gleicher Pfad) nach delete+Neuanlage geloescht', async () => {
    const { TFile } = require('obsidian');
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootT3(vault);
    const OWN_ID_T3: string = plugin.clientId;

    vault._files.set(
      `.qollab/${NOTE_T3}.${OWN_ID_T3}.yjs`,
      makeSidecarT3(G_OLD_WIPE, 'original')
    );
    vault._textFiles.set(NOTE_T3, 'original');

    // Delete -> Tombstone auf G_OLD_WIPE (global vor Fix, pfad-spezifisch nach Fix).
    const fT3 = new TFile();
    fT3.path = NOTE_T3;
    fT3.name = NOTE_T3;
    fT3.stat = { mtime: 0, ctime: 0, size: 0 };
    await handlers.get('delete')!(fT3);

    // note-t3.md wird gleichnamig neu angelegt.
    vault._textFiles.set(NOTE_T3, 'neuer inhalt');

    // Stale Geraet-B-Sidecar (alte GUID, gleicher Pfad) trifft ein.
    const B_SIDECAR_T3 = `.qollab/${NOTE_T3}.${B_ID_WIPE}.yjs`;
    vault._files.set(B_SIDECAR_T3, makeSidecarT3(G_OLD_WIPE, 'stale'));

    await plugin.onRemoteYjsUpdate(NOTE_T3);

    // Zombie-Schutz: stale Sidecar muss geloescht sein.
    expect(vault._files.has(B_SIDECAR_T3)).toBe(false);
  });
});
