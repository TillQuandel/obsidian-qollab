// Szenariosuche R2-35 — `.qollab` von Hand gelöscht: der Sweep-Merker macht den
// Verlust unsichtbar
//
// Der Ordner `.qollab` enthält ausschließlich Binärdateien und erklärt sich
// nirgends. Wird er von Hand gelöscht, synct die Löschung mit — beide Geräte
// verlieren ihre Historie. Danach gibt es keinen Selbstheilungspfad: Der
// Fortschrittsmerker (Task 19/B) sagt für jede unveränderte `.md` „eigener
// Snapshot ist aktuell" und überspringt sie OHNE einen einzigen Dateizugriff.
// Die Aussage ist nach dem Verlust falsch — den Snapshot gibt es nicht mehr.
// Qollab bleibt stumm und untätig; für die Nutzerin ist „synct nicht mehr" von
// „alles in Ordnung" nicht unterscheidbar.
//
// Der Zustand ist EXAKT feststellbar, nicht heuristisch: Der Merker trägt
// Einträge (dieses Gerät hat also schon einmal vollständig gesweept), aber es
// gibt keine einzige Sidecar mehr. Eine Neuinstallation sieht anders aus — der
// Merker liegt gerätelokal und ist dort ebenfalls leer.
//
// Was dieser Test NICHT verlangt: dass der Sweep danach etwas prägt. Prägen
// beide Geräte dieselbe Note unabhängig neu, entstehen zwei unabhängige
// Op-Ketten — der abgeschlossene Erstkontakt-Fall, für den Koordination über
// einen Datei-Sync beweisbar unmöglich ist. Die Regel aus Task 13/B (ohne
// adoptierbare Fremd-Sidecar wird nichts geprägt) bleibt deshalb unangetastet
// und wird hier ausdrücklich mitgeprüft.

import { Notice } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile, encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const OWN_ID = 'deadbeef';
const GUID = 'a'.repeat(32);

function sidecar(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent('x.md', text);
  return toAB(encodeStateFile(GUID, mgr.encodeState('x.md')));
}

// N Notes, alle mit eigener Sidecar, die neuer ist als die `.md` — der Sweep
// stellt für jede „Snapshot aktuell" fest und füllt damit den Merker.
function makeCoveredVault(n: number): VaultMock {
  const vault = makeVaultMock();
  for (let i = 0; i < n; i++) {
    const p = `ordner/note-${i}.md`;
    vault._textFiles.set(p, `Inhalt ${i}\n`);
    vault._mdMtimes.set(p, 10);
    vault._files.set(`.qollab/${p}.${OWN_ID}.yjs`, sidecar(`Inhalt ${i}\n`));
    vault._mtimes.set(`.qollab/${p}.${OWN_ID}.yjs`, 99);
  }
  vault._folders.add('.qollab');
  vault._folders.add('.qollab/ordner');
  return vault;
}

// Zählt Sidecar-stat-Aufrufe: das Maß für „der Sweep hat wirklich nachgesehen".
function countSidecarStats(vault: VaultMock): { n: number } {
  const c = { n: 0 };
  const orig = vault.adapter.stat.bind(vault.adapter);
  vault.adapter.stat = async (p: string) => {
    if (p.endsWith('.yjs')) c.n++;
    return orig(p);
  };
  return c;
}

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

// Der Nutzer löscht `.qollab` im Explorer; der Datei-Sync trägt die Löschung
// weiter. `keepEmptyDirs` bildet die Variante ab, in der der Sync die Dateien
// entfernt, die (leeren) Ordner aber stehen lässt.
function deleteQollabFolder(vault: VaultMock, keepEmptyDirs = false): void {
  vault._files.clear();
  vault._mtimes.clear();
  if (!keepEmptyDirs) vault._folders.clear();
}

const cursorOf = (store: any) => (store._store.get('qollab-sweep-cursor') ?? {}) as Record<string, unknown>;
const qollabNotices = () => (Notice as any).messages.filter((m: string) => m.includes('.qollab'));

beforeEach(() => {
  (Notice as any).messages.length = 0;
});

describe('R2-35: `.qollab` von Hand gelöscht', () => {
  it('der nächste Start meldet den Verlust', async () => {
    const vault = makeCoveredVault(5);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);
    expect(Object.keys(cursorOf(store))).toHaveLength(5);

    deleteQollabFolder(vault);
    (Notice as any).messages.length = 0;
    await sweep(vault, store, shared);

    expect(qollabNotices()).toHaveLength(1);
  });

  it('der Merker wird verworfen statt fortgeschrieben', async () => {
    const vault = makeCoveredVault(5);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    deleteQollabFolder(vault);
    await sweep(vault, store, shared);

    // Ein Merker, der „Snapshot aktuell" für einen Snapshot behauptet, den es
    // nicht mehr gibt, ist schlimmer als gar keiner: er hält den Sweep dauerhaft
    // von der Platte fern.
    expect(cursorOf(store)).toEqual({});
  });

  it('der Sweep sieht danach wieder jede Note an, statt sie blind zu überspringen', async () => {
    const vault = makeCoveredVault(5);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    deleteQollabFolder(vault);
    const stats = countSidecarStats(vault);
    await sweep(vault, store, shared);

    expect(stats.n).toBe(5);
  });

  it('gilt auch, wenn der Sync leere Ordner stehen lässt', async () => {
    const vault = makeCoveredVault(5);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    deleteQollabFolder(vault, true);
    (Notice as any).messages.length = 0;
    await sweep(vault, store, shared);

    expect(qollabNotices()).toHaveLength(1);
    expect(cursorOf(store)).toEqual({});
  });

  it('meldet höchstens einmal — der zweite Start danach ist wieder still', async () => {
    const vault = makeCoveredVault(5);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    deleteQollabFolder(vault);
    await sweep(vault, store, shared);
    (Notice as any).messages.length = 0;
    await sweep(vault, store, shared);

    // Nach dem Verwerfen sieht der Zustand aus wie eine frische Installation —
    // und über die ist nichts zu melden.
    expect(qollabNotices()).toHaveLength(0);
  });
});

describe('R2-35: die Grenze zum Erstkontakt-Fall', () => {
  it('der volle Sweep prägt trotzdem nichts neu', async () => {
    const vault = makeCoveredVault(5);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    deleteQollabFolder(vault);
    await sweep(vault, store, shared);

    // Task 13/B: ohne adoptierbare Fremd-Sidecar wird NICHT geprägt. Täte der
    // Sweep es hier, bekäme beim Zwei-Geräte-Verlust jede Seite ihre eigene
    // Inkarnation derselben Note — genau der Erstkontakt-Fall, der über einen
    // Datei-Sync beweisbar nicht koordinierbar ist. Der Verlust ist zu melden,
    // nicht zu „reparieren".
    expect([...vault._files.keys()]).toEqual([]);
  });

  it('eine wieder eingetroffene Fremd-Sidecar wird adoptiert, nicht neu geprägt', async () => {
    const vault = makeCoveredVault(3);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    deleteQollabFolder(vault);
    await sweep(vault, store, shared); // erkennt den Verlust, verwirft den Merker

    // Das andere Gerät hat eine Note wieder erfasst; ihre Sidecar synct her,
    // während diese App geschlossen ist. Ohne verworfenen Merker liefe der
    // Sweep über dieselbe unveränderte `.md` erneut blind hinweg.
    const p = 'ordner/note-1.md';
    vault._files.set(`.qollab/${p}.cafebabe.yjs`, sidecar('Inhalt 1\n'));
    vault._mtimes.set(`.qollab/${p}.cafebabe.yjs`, 200);

    await sweep(vault, store, shared);

    // Genau diese eine Note bekommt wieder eine eigene Sidecar — mit der
    // ADOPTIERTEN GUID, nicht mit einer frischen. Die übrigen bleiben ungeprägt.
    const own = vault._files.get(`.qollab/${p}.${OWN_ID}.yjs`);
    expect(own).toBeDefined();
    expect(decodeStateFile(new Uint8Array(own!)).guid).toBe(GUID);
    expect(vault._files.has(`.qollab/ordner/note-0.md.${OWN_ID}.yjs`)).toBe(false);
  });
});

describe('R2-35: keine Fehlalarme', () => {
  it('eine Neuinstallation meldet nichts (leerer Merker, leerer Ordner)', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set('ordner/note-0.md', 'Inhalt\n');
    vault._mdMtimes.set('ordner/note-0.md', 10);

    await sweep(vault, makeLocalStorage(), { value: null as any });

    expect(qollabNotices()).toHaveLength(0);
  });

  it('der intakte Normalfall bleibt still und behält den Merker', async () => {
    const vault = makeCoveredVault(5);
    const store = makeLocalStorage();
    const shared = { value: null as any };
    await sweep(vault, store, shared);

    (Notice as any).messages.length = 0;
    const stats = countSidecarStats(vault);
    await sweep(vault, store, shared);

    expect(qollabNotices()).toHaveLength(0);
    expect(Object.keys(cursorOf(store))).toHaveLength(5);
    // Task 19/B bleibt in Kraft: kein einziger Dateizugriff im Normalfall.
    expect(stats.n).toBe(0);
  });
});
