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
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

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
