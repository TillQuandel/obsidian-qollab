// Task 17 / F-3 — Tombstones und `enabled` sind nicht gerätelokal
//
// `data.json` liegt in `<vault>/.obsidian/plugins/qollab/` — im Sync-Scope des
// dokumentierten Standard-Aufbaus (in Tills Vault zusätzlich git-getrackt).
// `settings.ts:4-8` stellt das für die `clientId` selbst fest und zog die
// Konsequenz nur dort; für die Tombstone-Map behauptete `settings.ts:12`
// „Gerätelokal". Folgen: `saveSettings` schreibt die ganze Map (Last-Writer-Wins
// statt Vereinigung), ein Tombstone des einen Geräts trifft auf dem anderen
// womöglich eine lebende Inkarnation, und `enabled: false` schaltet das andere
// Gerät still ab.
//
// Die Tests modellieren das exakt: EIN geteilter `data.json`-Speicher, ZWEI
// getrennte Geräte-Speicher (App.loadLocalStorage/saveLocalStorage liegt im
// Obsidian-Profil, also außerhalb jedes Datei-Syncs).

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { makeVaultMock, makeLocalStorage, VaultMock } from './helpers/vault-mock';
import { tombstoneKey } from '../src/tombstones';

const NOTE = 'note.md';
const GUID = 'a'.repeat(32);

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

// Ein Speicher für data.json, den sich beide Geräte teilen — genau der Zustand,
// den `README.md:28` empfiehlt.
function makeSharedData(initial: any = null) {
  return { value: initial ? JSON.parse(JSON.stringify(initial)) : null };
}

async function bootDevice(vault: VaultMock, shared: { value: any }) {
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
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin: any = new (CrdtSyncPlugin as any)(app, {});
  plugin.loadData = async () => shared.value;
  plugin.saveData = async (d: any) => {
    shared.value = JSON.parse(JSON.stringify(d));
  };
  await plugin.onload();
  return { plugin, handlers, storage };
}

describe('F-3: Migration aus data.json in den Geräte-Speicher', () => {
  it('übernimmt enabled und Tombstones und entfernt beide aus data.json', async () => {
    const vault = makeVaultMock();
    const key = tombstoneKey(NOTE, GUID);
    const shared = makeSharedData({
      enabled: false,
      statusNotice: false,
      tombstones: { [key]: Date.now() },
    });

    const { plugin, storage } = await bootDevice(vault, shared);

    // Übernommen …
    expect(plugin.settings.enabled).toBe(false);
    expect(plugin.settings.tombstones[key]).toBeDefined();
    // … im Geräte-Speicher abgelegt …
    const device: any = storage.loadLocalStorage('qollab-device-settings');
    expect(device.enabled).toBe(false);
    expect(device.tombstones[key]).toBeDefined();
    // … und aus data.json entfernt. Das ist der Teil, ohne den die Datei die
    // Werte weiter zum anderen Gerät trüge.
    expect(shared.value).not.toHaveProperty('enabled');
    expect(shared.value).not.toHaveProperty('tombstones');
    // statusNotice bleibt bewusst in data.json (reine Anzeigepräferenz).
    expect(shared.value.statusNotice).toBe(false);
  });
});

describe('F-3: kein Übersprung zwischen zwei Geräten über data.json', () => {
  it('ein Tombstone von Gerät A erreicht Gerät B nicht', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, 'Inhalt\n');
    const shared = makeSharedData();

    const A = await bootDevice(vault, shared);
    // Gerät A löscht die Note → Tombstone auf (NOTE, GUID der Inkarnation).
    await A.plugin.syncHandler.applyLocalContent(NOTE, 'Inhalt\n');
    await A.handlers.get('delete')!(tfile(NOTE));
    expect(Object.keys(A.plugin.settings.tombstones).length).toBeGreaterThan(0);

    // Der geteilte data.json trägt ihn nicht — nur so kann er B nicht treffen.
    expect(shared.value ?? {}).not.toHaveProperty('tombstones');

    // Gerät B startet frisch am selben Vault (eigener Geräte-Speicher).
    const B = await bootDevice(vault, shared);
    expect(Object.keys(B.plugin.settings.tombstones)).toEqual([]);
  });

  it('enabled:false auf Gerät A schaltet Gerät B nicht ab', async () => {
    const vault = makeVaultMock();
    const shared = makeSharedData();

    const A = await bootDevice(vault, shared);
    A.plugin.settings.enabled = false;
    await A.plugin.saveSettings();

    const B = await bootDevice(vault, shared);
    expect(B.plugin.settings.enabled).toBe(true);
    // Und A bleibt auf seinem eigenen Stand.
    expect(A.plugin.settings.enabled).toBe(false);
  });
});
