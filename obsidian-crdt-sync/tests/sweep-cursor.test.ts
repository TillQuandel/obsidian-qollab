// Task 19/B, Hebel 1 — Fortschrittsmerker für den Startup-Sweep
//
// Der Sweep ist teuer, weil das Plugin kein Gedächtnis hat: Er fragt bei JEDEM
// Start für JEDE Note erneut die Platte, ob der eigene Snapshot aktuell ist —
// obwohl sich seit dem letzten Lauf nichts geändert hat. Obsidian macht es für
// seinen eigenen Index anders (`MetadataCache.initialize`: `TFile.stat.mtime`/
// `.size` gegen den persistierten Wert, gelesen wird nur bei Abweichung), und
// `TFile.stat` ist eine In-Memory-Property, kostet also nichts.
//
// Auflage aus Task 17/F-3, hier mitgepinnt: Der Merker gehört NICHT nach
// `data.json` — die liegt in `<vault>/.obsidian/plugins/qollab/` und damit im
// Sync-Scope. Ein geteilter Merker beschriebe den Zustand des jeweils anderen
// Geräts und liesse den Sweep genau die Notes überspringen, die hier noch nie
// erfasst wurden.
//
// Zuschnitt: Der Merker deckt AUSSCHLIESSLICH die Feststellung „eigener
// Snapshot ist aktuell" ab. Die Frage „gibt es eine fremde Sidecar zu
// adoptieren?" hängt nicht am `.md`-Stand und darf deshalb nicht über den
// `.md`-Stand zwischengespeichert werden — für die ist Hebel 3 zuständig.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const OWN_ID = 'deadbeef';
const GUID = 'a'.repeat(32);

function sidecar(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent('x.md', text);
  return toAB(encodeStateFile(GUID, mgr.encodeState('x.md')));
}

// N Notes, alle mit eigener Sidecar, die NEUER ist als die `.md` — der Sweep
// stellt für jede fest „Snapshot aktuell" und tut nichts.
function makeCoveredVault(n: number): VaultMock {
  const vault = makeVaultMock();
  for (let i = 0; i < n; i++) {
    const p = `ordner/note-${i}.md`;
    vault._textFiles.set(p, `Inhalt ${i}\n`);
    vault._mdMtimes.set(p, 10);
    vault._files.set(`.qollab/${p}.${OWN_ID}.yjs`, sidecar(`Inhalt ${i}\n`));
    vault._mtimes.set(`.qollab/${p}.${OWN_ID}.yjs`, 99);
  }
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

// Ein GERÄT: eigener localStorage, eigene data.json. Über `store` lässt sich ein
// Neustart derselben Installation modellieren (Speicher bleibt, Plugin ist neu).
function makeDevice(vault: VaultMock, store = makeLocalStorage(), shared = { value: null as any }) {
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
  return { plugin, store, shared };
}

async function sweep(vault: VaultMock, store?: any, shared?: any) {
  const d = makeDevice(vault, store, shared);
  await d.plugin.onload();
  await d.plugin.runStartupSweep();
  d.plugin.onunload();
  return d;
}

describe('B/1: der Sweep merkt sich, was er beim letzten Mal gesehen hat', () => {
  it('zweiter Start ohne Änderung kostet keinen einzigen Sidecar-Zugriff', async () => {
    const vault = makeCoveredVault(30);
    const store = makeLocalStorage();
    const shared = { value: null as any };

    const first = countSidecarStats(vault);
    await sweep(vault, store, shared);
    expect(first.n).toBe(30);

    // Zweiter Start desselben Geräts: nichts hat sich geändert.
    const second = countSidecarStats(vault);
    await sweep(vault, store, shared);
    expect(second.n).toBe(0);
  });

  it('eine geänderte .md wird trotz Merker erfasst', async () => {
    const vault = makeCoveredVault(5);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    // Externer Edit bei geschlossener App: Inhalt UND mtime ändern sich.
    const p = 'ordner/note-2.md';
    vault._textFiles.set(p, 'Von aussen geaendert\n');
    vault._mdMtimes.set(p, 500);

    await sweep(vault, store, shared);

    const own = vault._files.get(`.qollab/${p}.${OWN_ID}.yjs`)!;
    const mgr = new CrdtManager();
    mgr.applyUpdate(p, new Uint8Array(own).subarray(20));
    expect(mgr.getContent(p)).toContain('Von aussen geaendert');
  });

  it('gleiche mtime, andere Größe wird ebenfalls erfasst', async () => {
    const vault = makeCoveredVault(3);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    // Der pathologische Fall der mtime-Heuristik: OneDrive rundet .md-mtimes auf
    // ganze Sekunden. Die Größe ist die zweite Prüfung — sie muss mitzählen.
    const p = 'ordner/note-1.md';
    vault._textFiles.set(p, 'Anderer, laengerer Inhalt\n');
    // mtime bleibt bewusst stehen; nur die Größe ändert sich.
    const stats = countSidecarStats(vault);
    await sweep(vault, store, shared);
    expect(stats.n).toBeGreaterThan(0);
  });

  it('der Merker liegt gerätelokal, nicht in data.json', async () => {
    const vault = makeCoveredVault(4);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    const local = JSON.stringify([...store._store.entries()]);
    expect(local).toContain('ordner/note-0.md');
    // data.json wird mitsynchronisiert — dort hat der Merker nichts zu suchen.
    expect(JSON.stringify(shared.value ?? {})).not.toContain('ordner/note-0.md');
  });

  it('ein zweites Gerät erbt den Merker nicht', async () => {
    const vault = makeCoveredVault(6);
    const shared = { value: null as any };
    const storeA = makeLocalStorage();
    await sweep(vault, storeA, shared);

    // Gerät B teilt den Vault (und damit data.json), aber nicht den
    // Geräte-Speicher. Es muss den vollen Sweep fahren.
    const storeB = makeLocalStorage();
    const stats = countSidecarStats(vault);
    await sweep(vault, storeB, shared);
    expect(stats.n).toBe(6);
  });

  it('gelöschte Notes fallen aus dem Merker heraus', async () => {
    const vault = makeCoveredVault(3);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    vault._textFiles.delete('ordner/note-1.md');
    await sweep(vault, store, shared);

    expect(JSON.stringify([...store._store.entries()])).not.toContain('ordner/note-1.md');
  });
});
