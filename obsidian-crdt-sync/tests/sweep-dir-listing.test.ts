// Task 19/B, Hebel 3 — ein Verzeichnis-Listing je ORDNER statt je NOTE
//
// Die Sidecars aller Notes eines Ordners liegen in EINEM Verzeichnis
// (`listYjsInDir`). Der Startup-Sweep listet es trotzdem einmal je Note neu:
// `hasAdoptableGuid` → `listYjsFiles` → `readdir`. Das ist quadratisch in der
// Notenzahl je Ordner und multiplikativ in der Gerätezahl.
//
// Kontraintuitiv, und genau deshalb hier gepinnt: Eine Note OHNE Hilfsdatei
// kostet mehr als eine mit. Mit eigener aktueller Sidecar ist der Sweep nach
// einem `stat` fertig (`main.ts`); ohne sie muss er fragen „gibt es hier etwas
// zu adoptieren?", und diese Frage geht durch das ganze Verzeichnis.
//
// Gemessen wird die Zahl der Verzeichnis-Zugriffe des ECHTEN Sweeps
// (`plugin.runStartupSweep()`), nicht ein Nachbau der Entscheidungsfolge.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const OWN_ID = 'deadbeef';
const PEER_ID = '00000001';
const PEER_GUID = 'a'.repeat(32);

function sidecar(text: string, guid = PEER_GUID): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent('x.md', text);
  return toAB(encodeStateFile(guid, mgr.encodeState('x.md')));
}

// Ordner mit `covered` Notes MIT eigener aktueller Sidecar und `bare` Notes
// ganz ohne. Genau die zweite Klasse löst je Note ein Listing aus.
function makeVault(covered: number, bare: number): VaultMock {
  const vault = makeVaultMock();
  for (let i = 0; i < covered; i++) {
    const p = `ordner/gedeckt-${i}.md`;
    vault._textFiles.set(p, 'Inhalt\n');
    vault._mdMtimes.set(p, 1);
    vault._files.set(`.qollab/${p}.${OWN_ID}.yjs`, sidecar('Inhalt\n'));
    vault._mtimes.set(`.qollab/${p}.${OWN_ID}.yjs`, 99);
  }
  for (let i = 0; i < bare; i++) {
    const p = `ordner/nackt-${i}.md`;
    vault._textFiles.set(p, 'Inhalt\n');
    vault._mdMtimes.set(p, 1);
  }
  return vault;
}

// Zählt Verzeichnis-Zugriffe auf dem Adapter. Der Mock hat kein `getBasePath`,
// deshalb läuft sidecar-io über `adapter.exists` + `adapter.list` — beide
// zusammen sind ein Verzeichnis-Zugriff im Sinne dieser Messung.
function countDirAccess(vault: VaultMock): { list: number; existsDir: number } {
  const c = { list: 0, existsDir: 0 };
  const origList = vault.adapter.list.bind(vault.adapter);
  const origExists = vault.adapter.exists.bind(vault.adapter);
  vault.adapter.list = async (p: string) => {
    c.list++;
    return origList(p);
  };
  vault.adapter.exists = async (p: string) => {
    if (p.startsWith('.qollab') && !p.endsWith('.yjs')) c.existsDir++;
    return origExists(p);
  };
  return c;
}

function makePlugin(vault: VaultMock): CrdtSyncPlugin {
  const vaultWithEvents = Object.assign(vault, {
    on: () => ({}),
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
  return new CrdtSyncPlugin(app as any, {} as any);
}

describe('B/3: der Sweep listet je Ordner, nicht je Note', () => {
  it('40 ungedeckte Notes in einem Ordner kosten EIN Listing', async () => {
    const vault = makeVault(10, 40);
    const counts = countDirAccess(vault);
    const plugin = makePlugin(vault);
    await plugin.onload();
    await plugin.runStartupSweep();
    plugin.onunload();

    // Bestand: 40 (eines je ungedeckter Note). Ziel: 1 (eines je Ordner).
    expect(counts.list).toBe(1);
    expect(counts.existsDir).toBe(1);
  });

  it('das Ergebnis des Sweeps bleibt dasselbe: adoptierbare Fremd-Sidecar wird geprägt', async () => {
    const vault = makeVault(3, 3);
    // Eine der nackten Notes bekommt eine adoptierbare Fremd-Sidecar.
    const p = 'ordner/nackt-1.md';
    vault._files.set(`.qollab/${p}.${PEER_ID}.yjs`, sidecar('Fremd-Text\n'));
    vault._mtimes.set(`.qollab/${p}.${PEER_ID}.yjs`, 5);

    const plugin = makePlugin(vault);
    await plugin.onload();
    await plugin.runStartupSweep();
    plugin.onunload();

    // Adoption ist gelaufen: eigener State existiert, Fremd-Inhalt ist drin.
    expect(vault._files.has(`.qollab/${p}.${OWN_ID}.yjs`)).toBe(true);
    expect(vault._textFiles.get(p)).toContain('Fremd-Text');
    // Und die Notes ohne alles bleiben unangetastet (Task 13/B).
    expect(vault._files.has('.qollab/ordner/nackt-0.md.deadbeef.yjs')).toBe(false);
  });

  it('mehrere Ordner: ein Listing je Ordner, nicht eines je Note', async () => {
    const vault = makeVaultMock();
    for (let f = 0; f < 4; f++) {
      for (let i = 0; i < 10; i++) {
        const p = `o${f}/n-${i}.md`;
        vault._textFiles.set(p, 'Inhalt\n');
        vault._mdMtimes.set(p, 1);
      }
      // Ein Sidecar je Ordner, damit der Ordner überhaupt existiert.
      vault._files.set(`.qollab/o${f}/n-0.md.${PEER_ID}.yjs`, sidecar('Fremd\n'));
      vault._mtimes.set(`.qollab/o${f}/n-0.md.${PEER_ID}.yjs`, 5);
    }
    const counts = countDirAccess(vault);
    const plugin = makePlugin(vault);
    await plugin.onload();
    await plugin.runStartupSweep();
    plugin.onunload();

    // 4 Ordner. Bestand: 40. Die eine adoptierende Note je Ordner darf zusätzlich
    // frisch listen (Arbeitspfad, bewusst nicht aus dem Sweep-Cache bedient).
    expect(counts.list).toBeLessThanOrEqual(4 + 4 * 3);
    expect(counts.list).toBeGreaterThanOrEqual(4);
  });
});
