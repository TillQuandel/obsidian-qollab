// Task 17 / F-6 — Sidecar-Schreibfehler hatten keinen Rückkanal
//
// `saveState` rief `writeBinary` ohne `catch`; `applyLocalContent` fängt nur
// `SidecarReadError`. Warf der Write (OneDrive hält ein Handle, Pfad zu lang,
// Volume voll), gab es keine Markierung, keinen Zähler, keine Notice, keinen
// Retry — der Wurf endete als unbehandelte Promise im modify-Handler bzw. im
// bewussten leeren `catch` des Sweeps. Der LESEpfad hat für dieselbe Ungewissheit
// seit Task 12 zwei Rückkanäle und eine Schwellen-Notice; diese Asymmetrie ist der
// Fund. In keiner der Bestands-Suiten gab es bis hierher einen
// Sidecar-Schreibfehler-Test.

import { Notice, TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'deadbeef';
const OWN_PATH = '.qollab/note.md.deadbeef.yjs';
const PEER_PATH = '.qollab/note.md.00000001.yjs';
const GUID = 'a'.repeat(32);

function sidecar(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(encodeStateFile(GUID, mgr.encodeState(NOTE)));
}

// Lässt writeBinary für den EIGENEN Sidecar-Pfad werfen, bis `fail` false wird.
function breakOwnWrite(vault: VaultMock): { fail: boolean; attempts: () => number } {
  const state = { fail: true, count: 0 };
  const orig = vault.adapter.writeBinary.bind(vault.adapter);
  vault.adapter.writeBinary = async (p: string, data: any) => {
    if (state.fail && p === OWN_PATH) {
      state.count++;
      throw new Error('EBUSY: resource busy or locked');
    }
    return orig(p, data);
  };
  return {
    get fail() {
      return state.fail;
    },
    set fail(v: boolean) {
      state.fail = v;
    },
    attempts: () => state.count,
  } as any;
}

async function boot(vault: VaultMock) {
  const vaultWithEvents = Object.assign(vault, { on: () => ({}), offref: () => {} });
  const storage = makeLocalStorage();
  storage.saveLocalStorage('qollab-client-id', OWN_ID);
  const app = {
    vault: vaultWithEvents,
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin: any = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return plugin;
}

describe('F-6: Schreibfehler wird markiert statt verschluckt', () => {
  it('applyLocalContent wirft nicht, markiert die Note und meldet den Pfad', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, 'Inhalt\n');
    const broken = breakOwnWrite(vault);

    const unwritable: string[] = [];
    const handler = new SyncHandler(
      vault as any,
      new CrdtManager(),
      OWN_ID,
      undefined,
      undefined,
      undefined,
      (p) => unwritable.push(p)
    );

    await expect(handler.applyLocalContent(NOTE, 'Inhalt\n')).resolves.not.toThrow();

    expect(vault._files.has(OWN_PATH)).toBe(false);
    expect(handler.hasUnpersistedState(NOTE)).toBe(true);
    expect(unwritable).toEqual([OWN_PATH]);
  });

  it('der nächste Trigger holt den Schreibversuch nach und räumt die Markierung ab', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, 'Inhalt\n');
    const broken = breakOwnWrite(vault);

    const handler = new SyncHandler(vault as any, new CrdtManager(), OWN_ID);
    await handler.applyLocalContent(NOTE, 'Inhalt\n');
    expect(handler.hasUnpersistedState(NOTE)).toBe(true);

    broken.fail = false;
    await handler.applyLocalContent(NOTE, 'Inhalt und mehr\n');

    expect(handler.hasUnpersistedState(NOTE)).toBe(false);
    expect(vault._files.has(OWN_PATH)).toBe(true);
  });
});

describe('F-6: Schwellen-Notice wie beim unlesbaren Sidecar', () => {
  it('meldet nach drei Fehlversuchen genau einmal', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, 'Inhalt\n');
    breakOwnWrite(vault);

    const plugin = await boot(vault);
    (Notice as any).messages.length = 0;

    for (let i = 0; i < 5; i++) {
      await plugin.syncHandler.applyLocalContent(NOTE, `Inhalt ${i}\n`);
    }

    const matching = (Notice as any).messages.filter((m: string) => m.includes(OWN_PATH));
    expect(matching.length).toBe(1);
    expect(matching[0]).toContain('nicht geschrieben');
  });

  it('onRemoteYjsUpdate verbucht den Trigger nicht, solange der Stand nicht persistiert ist', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, 'line-0\n');
    vault._files.set(PEER_PATH, sidecar('line-0\nEDIT-Y\n'));
    breakOwnWrite(vault);

    const plugin = await boot(vault);
    const consumed = await plugin.onRemoteYjsUpdate(NOTE);

    // false = „Trigger nicht verbraucht": der Watcher lässt lastSeen stehen und
    // liefert denselben Stand erneut — das IST der Retry.
    expect(consumed).toBe(false);
    expect(plugin.syncHandler.hasUnpersistedState(NOTE)).toBe(true);
    // Der Merge selbst ist trotzdem in der Datei gelandet; verloren geht nichts.
    expect(vault._textFiles.get(NOTE)).toContain('EDIT-Y');
  });
});
