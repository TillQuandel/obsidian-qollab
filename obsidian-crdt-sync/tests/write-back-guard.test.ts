import CrdtSyncPlugin from '../src/main';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { makeVaultMock } from './helpers/vault-mock';

// Fix A (HIGH) — Write-Back-Guard in onRemoteYjsUpdate.
//
// Race: Zwischen Merge-Berechnung (loadAndMerge) und Write-Back landet ein
// lokaler User-Edit in der .md. Der alte Code überschrieb ihn blind mit `merged`.
// Der Guard darf weder den lokalen Edit noch die Remote-Änderung verlieren.
//
// Getestet wird die echte Plugin-Methode `onRemoteYjsUpdate` mit direkt
// verdrahteten Privatfeldern (kein onload). Der Vault-Mock gated `readBinary` der
// Remote-.yjs; WÄHREND loadAndMerge dort hängt, wird `_textFiles` direkt geändert
// (simulierter User-Edit OHNE Queue — genau das Race). `process(file, fn)` liest
// den aktuellen `_textFiles`-Stand und schreibt die Rückgabe zurück.

const NOTE = 'note.md';
const REMOTE_YJS = '.qollab/note.md.5e307e01.yjs';
const OWN_YJS = '.qollab/note.md.10ca1000.yjs';

const BASE = 'Zeile 1\nZeile 2\n';
const REMOTE = 'Zeile 1 REMOTE\nZeile 2\n'; // Remote ändert Zeile 1
const LOCAL_EDIT = 'Zeile 1\nZeile 2 LOCAL\n'; // User ändert Zeile 2 auf der BASE
const MERGED = 'Zeile 1 REMOTE\nZeile 2 LOCAL\n'; // beide Änderungen

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// Baut ein Plugin mit direkt gesetzten Privatfeldern (kein onload).
function makePlugin(vault: ReturnType<typeof makeVaultMock>, clientId = '10ca1000') {
  const plugin = new (CrdtSyncPlugin as any)({ vault }, {});
  plugin.settings = { enabled: true, statusNotice: false, clientId, tombstones: {} };
  plugin.crdtManager = new CrdtManager();
  plugin.syncHandler = new SyncHandler(vault as any, plugin.crdtManager, clientId);
  return plugin as any;
}

// Ausgangslage: eigener State = Basis-Historie (own-Branch von ensureDoc, keine
// .md-Injektion), fremde Remote-.yjs mit Zeile-1-Änderung, .md steht auf BASE.
// `readBinary` der Remote-Sibling wird beim ERSTEN Zugriff verzögert.
function setup() {
  const vault = makeVaultMock();

  const base = new CrdtManager();
  base.setContent(NOTE, BASE);
  const baseState = base.encodeState(NOTE);
  vault._files.set(OWN_YJS, baseState.buffer as ArrayBuffer);

  const remote = new CrdtManager();
  remote.applyUpdate(NOTE, baseState);
  remote.setContent(NOTE, REMOTE);
  vault._files.set(REMOTE_YJS, remote.encodeState(NOTE).buffer as ArrayBuffer);

  vault._textFiles.set(NOTE, BASE);

  let releaseRemote!: () => void;
  const remoteGate = new Promise<void>((r) => {
    releaseRemote = r;
  });
  let gated = false;
  const rawReadBinary = vault.adapter.readBinary;
  vault.adapter.readBinary = async (path: string) => {
    if (path === REMOTE_YJS && !gated) {
      gated = true;
      await remoteGate;
    }
    return rawReadBinary(path);
  };

  const plugin = makePlugin(vault);
  return { vault, plugin, releaseRemote: () => releaseRemote() };
}

describe('Fix A: Write-Back-Guard in onRemoteYjsUpdate', () => {
  it('Normalfall ohne konkurrierenden Edit: schreibt merged in die .md', async () => {
    const vault = makeVaultMock();

    const base = new CrdtManager();
    base.setContent(NOTE, BASE);
    vault._files.set(OWN_YJS, base.encodeState(NOTE).buffer as ArrayBuffer);

    const remote = new CrdtManager();
    remote.applyUpdate(NOTE, base.encodeState(NOTE));
    remote.setContent(NOTE, REMOTE);
    vault._files.set(REMOTE_YJS, remote.encodeState(NOTE).buffer as ArrayBuffer);

    vault._textFiles.set(NOTE, BASE);

    const plugin = makePlugin(vault);
    await plugin.onRemoteYjsUpdate(NOTE);

    expect(vault._textFiles.get(NOTE)).toBe(REMOTE);
    expect(plugin.crdtManager.getContent(NOTE)).toBe(REMOTE);
  });

  it('Edit während des Merge-Fensters: beide Änderungen überleben (nichts verloren)', async () => {
    const { vault, plugin, releaseRemote } = setup();

    // onRemoteYjsUpdate starten; es hängt im gated readBinary der Remote-.yjs.
    const p = plugin.onRemoteYjsUpdate(NOTE);
    await tick();

    // Simulierter User-Edit direkt in die .md, WÄHREND der Merge hängt (das Race).
    vault._textFiles.set(NOTE, LOCAL_EDIT);

    releaseRemote();
    await p;

    // Exakter Endzustand: Remote-Änderung UND lokaler Edit, in Datei und CRDT.
    expect(vault._textFiles.get(NOTE)).toBe(MERGED);
    expect(plugin.crdtManager.getContent(NOTE)).toBe(MERGED);
  });

  it('Edit == merged: keine Doppel-Anwendung, kein überflüssiger Write', async () => {
    const { vault, plugin, releaseRemote } = setup();

    const applySpy = jest.spyOn(plugin.syncHandler, 'applyLocalContent');

    const p = plugin.onRemoteYjsUpdate(NOTE);
    await tick();

    // Der konkurrierende Edit ergibt exakt den merged-Stand.
    vault._textFiles.set(NOTE, REMOTE);

    releaseRemote();
    await p;

    expect(vault._textFiles.get(NOTE)).toBe(REMOTE);
    expect(plugin.crdtManager.getContent(NOTE)).toBe(REMOTE);
    // data === merged → process gibt data zurück, pending bleibt null:
    // KEINE Zweit-Anwendung via applyLocalContent.
    expect(applySpy).not.toHaveBeenCalled();
  });
});
