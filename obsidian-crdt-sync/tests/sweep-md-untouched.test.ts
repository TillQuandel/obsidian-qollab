// Task 19/B, Hebel 2 — `TFile.stat` statt Dateizugriff
//
// BEFUND: Der Hebel ist im Bestand bereits umgesetzt. `snapshotStaleMarkdownFiles`
// entscheidet ausschliesslich über `file.stat.mtime` (eine synchrone
// In-Memory-Property; Obsidian füllt sie beim Vault-Scan aus einem echten
// `lstat` und hält sie über den File-Watcher aktuell) und liest die `.md` erst,
// nachdem es sich zum Handeln entschieden hat. Als eigenständige Änderung
// bringt Hebel 2 deshalb NULL — gemessen auf echtem Dateisystem: `readFile=0`
// in allen vier Abdeckungs-Szenarien, vor wie nach Task 19.
//
// Diese Tests ändern nichts, sie halten den Zustand fest. Ohne sie ist die
// Eigenschaft nur eine Beobachtung: ein künftiger `await vault.read(file)` vor
// dem `continue` — etwa um einen Hash zu bilden — macht aus dem billigsten
// Zweig des Sweeps den teuersten, und keine bestehende Zusage stünde dagegen.

import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB, VaultMock } from './helpers/vault-mock';

const OWN_ID = 'deadbeef';
const PEER_ID = '00000001';
const GUID = 'a'.repeat(32);

function sidecar(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent('x.md', text);
  return toAB(encodeStateFile(GUID, mgr.encodeState('x.md')));
}

function countReads(vault: VaultMock): { paths: string[] } {
  const c = { paths: [] as string[] };
  const orig = vault.read.bind(vault);
  vault.read = async (file: { path: string }) => {
    c.paths.push(file.path);
    return orig(file);
  };
  return c;
}

function makePlugin(vault: VaultMock): CrdtSyncPlugin {
  const vaultWithEvents = Object.assign(vault, { on: () => ({}), offref: () => {} });
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

describe('B/2: der Sweep fasst die .md für seine Entscheidung nicht an', () => {
  it('gedeckte und ungedeckte Notes werden ohne einen einzigen .md-Read übersprungen', async () => {
    const vault = makeVaultMock();
    // Gedeckt: eigene Sidecar neuer als die .md → „Snapshot aktuell".
    for (let i = 0; i < 5; i++) {
      const p = `o/gedeckt-${i}.md`;
      vault._textFiles.set(p, 'Inhalt\n');
      vault._mdMtimes.set(p, 10);
      vault._files.set(`.qollab/${p}.${OWN_ID}.yjs`, sidecar('Inhalt\n'));
      vault._mtimes.set(`.qollab/${p}.${OWN_ID}.yjs`, 99);
    }
    // Ungedeckt: keine eigene Sidecar, nichts zu adoptieren (Task 13/B).
    for (let i = 0; i < 5; i++) {
      const p = `o/nackt-${i}.md`;
      vault._textFiles.set(p, 'Inhalt\n');
      vault._mdMtimes.set(p, 10);
    }

    const reads = countReads(vault);
    const plugin = makePlugin(vault);
    await plugin.onload();
    await plugin.runStartupSweep();
    plugin.onunload();

    expect(reads.paths).toEqual([]);
  });

  it('gelesen wird erst, wenn der Sweep sich zum Handeln entschieden hat', async () => {
    const vault = makeVaultMock();
    const arbeit = 'o/adoptierbar.md';
    vault._textFiles.set(arbeit, 'Lokal\n');
    vault._mdMtimes.set(arbeit, 10);
    vault._files.set(`.qollab/${arbeit}.${PEER_ID}.yjs`, sidecar('Fremd\n'));
    vault._mtimes.set(`.qollab/${arbeit}.${PEER_ID}.yjs`, 5);
    // Eine übersprungene Note daneben, damit „liest nur die eine" etwas aussagt.
    vault._textFiles.set('o/ruhig.md', 'Inhalt\n');
    vault._mdMtimes.set('o/ruhig.md', 10);

    const reads = countReads(vault);
    const plugin = makePlugin(vault);
    await plugin.onload();
    await plugin.runStartupSweep();
    plugin.onunload();

    expect(new Set(reads.paths)).toEqual(new Set([arbeit]));
  });
});
