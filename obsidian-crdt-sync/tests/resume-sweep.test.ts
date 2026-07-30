// Task 17 / F-5 — Wiedereinschalten löste keinen Sweep aus
//
// Der Toggle setzte nur `enabled` und speicherte. Der Sweep hing ausschließlich an
// `onLayoutReady`, das in dieser Sitzung längst gefeuert hatte. Edits aus der
// Aus-Phase lebten also nur in der `.md` — und weil während „aus" die Trigger
// korrekt aufgestaut werden (`onRemoteYjsUpdate` gibt `false`, `lastSeen` bleibt
// stehen), arbeitete der erste Poll nach dem Einschalten sie sofort ab und
// überschrieb sie. Deterministisch binnen eines Poll-Intervalls, kein Race.

import { Setting, TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtSyncSettingTab } from '../src/settings';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'deadbeef';
const OWN_PATH = '.qollab/note.md.deadbeef.yjs';
const PEER_PATH = '.qollab/note.md.00000001.yjs';
const GUID = 'a'.repeat(32);

const BASE = 'line-0\n';
const BASE_Y = 'line-0\nEDIT-Y\n'; // Fremd-Edit, kommt während der Aus-Phase an
const BASE_Z = 'line-0\nEDIT-Z\n'; // Edit der Nutzerin während der Aus-Phase

function sidecar(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(encodeStateFile(GUID, mgr.encodeState(NOTE)));
}

async function boot(vault: VaultMock) {
  const vaultWithEvents = Object.assign(vault, {
    on: () => ({}),
    offref: () => {},
  });
  let layoutCb: (() => any) | null = null;
  const storage = makeLocalStorage();
  storage.saveLocalStorage('qollab-client-id', OWN_ID);
  const app = {
    vault: vaultWithEvents,
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: (cb: () => any) => {
        layoutCb = cb;
      },
    },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin: any = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin, app, layout: () => layoutCb };
}

// Den echten Schalter umlegen, nicht `settings.enabled` von Hand setzen — die
// Logik, um die es geht, sitzt im onChange-Handler des Toggles.
function syncToggle(app: any, plugin: any): (v: boolean) => Promise<void> {
  (Setting as any).toggles.length = 0;
  new CrdtSyncSettingTab(app, plugin).display();
  const entry = (Setting as any).toggles.find((t: any) => t.name === 'Sync aktiviert');
  expect(entry).toBeDefined();
  return entry.toggle._onChange;
}

describe('F-5: Wiedereinschalten holt die Aus-Phase nach', () => {
  it('Edit aus der Aus-Phase überlebt den ersten Poll nach dem Einschalten', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._files.set(OWN_PATH, sidecar(BASE));

    const { plugin, app, layout } = await boot(vault);
    await layout()!(); // normaler Start: Sweep, Watcher-Start, Initial-Poll

    const setEnabled = syncToggle(app, plugin);

    // 1. Sie schaltet „Sync aktiviert" aus.
    await setEnabled(false);
    expect(plugin.settings.enabled).toBe(false);

    // 2. Sie arbeitet weiter — der modify-Handler fällt am enabled-Guard ab, ihr
    //    Text lebt nur in der .md.
    vault._textFiles.set(NOTE, BASE_Z);
    vault._mdMtimes.set(NOTE, 999);

    // 3. Der Peer editiert in derselben Zeit; seine Sidecar kommt an.
    vault._files.set(PEER_PATH, sidecar(BASE_Y));
    vault._mtimes.set(PEER_PATH, 500);

    // 4. Der Poll läuft weiter, staut den Trigger aber korrekt auf.
    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get(NOTE)).toBe(BASE_Z);

    // 5. Sie schaltet wieder ein.
    await setEnabled(true);

    // 6. Der nächste Tick arbeitet die aufgestauten Trigger ab.
    await plugin.sidecarWatcher.poll();

    // Ohne Sweep beim Einschalten wäre EDIT-Z hier aus Datei UND CRDT weg.
    expect(vault._textFiles.get(NOTE)).toContain('EDIT-Z');
    expect(vault._textFiles.get(NOTE)).toContain('EDIT-Y');
  });
});
