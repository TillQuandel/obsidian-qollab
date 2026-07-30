// Task 17 / F-4 — `settings.enabled` war kein Aus-Schalter
//
// Geprüft wurde `enabled` nur im modify-Handler, im Sweep und in
// `onRemoteYjsUpdate`. Die Handler für `rename` und `delete` sowie die
// Kollisions-Reprovisionierung liefen unabhängig davon weiter: das
// „ausgeschaltete" Plugin setzte also Tombstones, löschte Sidecars und vergab
// neue Geräte-IDs — Zustandsänderungen in einem Modus, in dem die Nutzerin
// Untätigkeit erwartet. Besonders unangenehm: ein sync-vermittelter Rename kommt
// als delete+create an und tombstonte so eine LEBENDE Inkarnation.
//
// Festgelegt ist „aus" = keine neuen Markierungen, keine neue Geräte-ID, kein
// Merge. Sidecar-Housekeeping bei rename/delete läuft weiter — sonst verwaisen
// Dateien, die niemand mehr aufräumt. Der dritte Test pinnt genau diese Ausnahme.

import { Notice, TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { makeVaultMock, makeLocalStorage, VaultMock } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'deadbeef';
const OWN_PATH = '.qollab/note.md.deadbeef.yjs';
const PEER_PATH = '.qollab/note.md.00000001.yjs';

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

async function boot(vault: VaultMock) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
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
  return { plugin, handlers };
}

describe('F-4: „aus" heißt keine Zustandsänderung', () => {
  it('delete setzt bei enabled:false keinen Tombstone (räumt die Sidecars aber auf)', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, 'Inhalt\n');
    const { plugin, handlers } = await boot(vault);

    // Eine lebende Inkarnation, wie sie ein sync-vermittelter Rename mitbringt.
    await plugin.syncHandler.applyLocalContent(NOTE, 'Inhalt\n');
    expect(vault._files.has(OWN_PATH)).toBe(true);

    plugin.settings.enabled = false;
    await handlers.get('delete')!(tfile(NOTE));

    // Kein Tombstone — sonst beerdigt das ausgeschaltete Plugin eine Inkarnation,
    // die auf dem anderen Gerät weiterlebt, und der Zustand heilt erst nach
    // 90 Tagen.
    expect(Object.keys(plugin.settings.tombstones)).toEqual([]);
    // Housekeeping läuft weiter: keine verwaisten Sidecars.
    expect(vault._files.has(OWN_PATH)).toBe(false);
  });

  it('Kollisionsprüfung provisioniert bei enabled:false keine neue Geräte-ID', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, 'Inhalt\n');
    const { plugin } = await boot(vault);

    // Eigene Signatur etablieren …
    await plugin.syncHandler.applyLocalContent(NOTE, 'Inhalt\n');
    // … dann schreibt „ein zweites Gerät mit derselben ID" andere Bytes darüber.
    vault._files.set(OWN_PATH, new Uint8Array([1, 2, 3, 4, 5]).buffer);
    vault._mtimes.set(OWN_PATH, 4242);

    plugin.settings.enabled = false;
    (Notice as any).messages.length = 0;

    const acted = await plugin.onOwnSidecarChanged(NOTE, OWN_PATH, { mtime: 4242, size: 5 });

    expect(acted).toBe(false);
    expect(plugin.clientId).toBe(OWN_ID);
    expect((Notice as any).messages).toEqual([]);
  });

  it('rename zieht die Sidecars auch bei enabled:false mit (bewusste Ausnahme)', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, 'Inhalt\n');
    vault._files.set(OWN_PATH, new ArrayBuffer(1));
    vault._files.set(PEER_PATH, new ArrayBuffer(1));
    const { plugin, handlers } = await boot(vault);

    plugin.settings.enabled = false;
    await handlers.get('rename')!(tfile('renamed.md'), NOTE);

    // Würde der Handler stillgelegt, blieben die Sidecars unter dem alten Pfad
    // als Waisen liegen — genau der Zustand, den niemand aufräumen kann.
    expect(vault._files.has('.qollab/renamed.md.deadbeef.yjs')).toBe(true);
    expect(vault._files.has('.qollab/renamed.md.00000001.yjs')).toBe(true);
    expect(vault._files.has(OWN_PATH)).toBe(false);
  });
});
