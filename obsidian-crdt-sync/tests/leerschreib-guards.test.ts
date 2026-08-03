// Testlücke aus der Mutationsmessung (Runde 3): Die BEIDEN im README namentlich
// zugesagten Guards gegen das Leeren einer Notiz hatten keinen Test — beide
// Mutationen ließen die volle Suite grün.
//
// README, Abschnitt „Gerätelokale Tombstones (bewusste Grenze)":
//   „Durch zwei Schutz-Guards kann ein zurückkehrender leerer State die Note nicht
//    mehr leeren: Qollab startet keinen Merge ohne existierende `.md` (Guard 1),
//    und ein historienloser Frisch-Doc ohne Ops überschreibt keine vorhandene
//    `.md` (Guard 2)."
//
// Guard 1 (`main.ts`, `if (!noteFile) return true;`) hat zwei Wirkungen, die der
// Phantom-Guard in `loadAndMerge` NICHT abdeckt:
//   a) Ohne eigenen Stand blockiert zwar auch der Phantom-Guard — er antwortet
//      aber mit `null`, und `onRemoteYjsUpdate` macht daraus `false`. Die verwaiste
//      Sidecar triggerte damit bei JEDEM Poll erneut (Dauerlast, nie erledigt).
//   b) MIT eigenem Stand auf der Platte greift der Phantom-Guard gar nicht mehr
//      (er verlangt „kein eigener State"). Dann liefe für eine Notiz, die es hier
//      nicht mehr gibt, ein voller Merge samt `saveState` — inklusive
//      Inkarnationswechsel und neu geschriebener eigener Hilfsdatei.
//
// Guard 2 (`main.ts`, `if (merged === '' && !hasOps) return true;`) ist die
// EINZIGE Sperre auf seinem Pfad. Erreichbar über eine Kombination, die aus lauter
// dokumentierten Einzelteilen besteht:
//   - ein ops-freier eigener State (v0.x rief `saveState` auch für eine nie
//     befüllte Notiz; das Ergebnis ist der leere Yjs-State `[0x00,0x00]` mit
//     intaktem QLB1-Kopf),
//   - eine `.md`, die inzwischen Text trägt, den der Startup-Sweep übersprungen hat
//     (mtime-Sekundenrundung über Gerätegrenzen, bekannte Grenze #3),
//   - eine fremde Hilfsdatei mit GRÖSSERER GUID, die den Tie-Break also verliert
//     und nicht mitgemergt wird.
// Ergebnis: `merged === ''` bei `hasOps() === false`. Ohne Guard 2 gilt im
// Write-Back `data === preMerge`, und `vault.process` schreibt eine LEERE Datei
// über eine volle Notiz.

import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer, VaultMock } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'deadbeef';
const PEER_ID = '00000001';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const PEER_PATH = `.qollab/${NOTE}.${PEER_ID}.yjs`;

// Klein gegen groß: die eigene GUID gewinnt jeden Tie-Break gegen die fremde.
const GUID_KLEIN = '00'.repeat(16);
const GUID_GROSS = 'ff'.repeat(16);

const TEXT = 'Zeile 1\nZeile 2\n';

async function boot(vault: VaultMock) {
  const storage = makeLocalStorage();
  storage.saveLocalStorage('qollab-client-id', OWN_ID);
  const vaultWithEvents = Object.assign(vault, { on: () => ({}), offref: () => {} });
  const plugin: any = new (CrdtSyncPlugin as any)(
    {
      vault: vaultWithEvents,
      workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
      loadLocalStorage: storage.loadLocalStorage,
      saveLocalStorage: storage.saveLocalStorage,
    },
    {}
  );
  plugin._data = { enabled: true, statusNotice: false, tombstones: {} };
  await plugin.onload();
  return plugin;
}

// Fremde Hilfsdatei, die von `basis` abstammt (gemeinsame Item-IDs) oder — ohne
// Basis — eine eigenständige Kette bildet.
function peerSidecar(guid: string, text: string, basis?: Uint8Array): ArrayBuffer {
  const peer = new CrdtManager();
  if (basis) peer.applyUpdate(NOTE, basis);
  peer.setContent(NOTE, text);
  return toArrayBuffer(encodeStateFile(guid, peer.encodeState(NOTE)));
}

describe('Guard 1: ohne .md wird nicht gemergt', () => {
  it('verwaiste Fremd-Sidecar ohne .md gilt als erledigt (sonst triggert sie bei jedem Poll)', async () => {
    const vault = makeVaultMock();
    // Die Sidecar des Peers ist da, seine .md noch unterwegs — die im README
    // beschriebene Ankunftsreihenfolge.
    vault._files.set(PEER_PATH, peerSidecar(GUID_GROSS, TEXT));
    const plugin = await boot(vault);

    // Mutation (Guard 1 entfernt): `false` — der Phantom-Guard in loadAndMerge
    // meldet `null`, und der Trigger bleibt für immer unverbraucht.
    expect(await plugin.onRemoteYjsUpdate(NOTE)).toBe(true);
    // Und es entsteht keine eigene Hilfsdatei mit frischer GUID für eine Notiz,
    // die es hier gar nicht gibt.
    expect(vault._files.has(OWN_PATH)).toBe(false);
  });

  it('extern gelöschte .md mit liegen gebliebener eigener Sidecar: kein Merge, kein Write', async () => {
    // Hier greift der Phantom-Guard NICHT (eigener State existiert). Guard 1 ist
    // die einzige Sperre: ohne ihn zieht `loadAndMerge` den Fremd-Stand in den Doc
    // und `saveState` schreibt die eigene Hilfsdatei neu — für eine Notiz, die auf
    // diesem Gerät nicht mehr existiert.
    const vault = makeVaultMock();
    const eigen = new CrdtManager();
    eigen.setContent(NOTE, TEXT);
    const eigenState = eigen.encodeState(NOTE);
    vault._files.set(OWN_PATH, toArrayBuffer(encodeStateFile(GUID_KLEIN, eigenState)));
    // Gleiche GUID → kompatibel → würde ohne Guard 1 gemergt und persistiert.
    vault._files.set(PEER_PATH, peerSidecar(GUID_KLEIN, `${TEXT}FREMD\n`, eigenState));
    // Die .md fehlt (extern gelöscht bei geschlossener App / abgewählter Ordner).

    const plugin = await boot(vault);
    const vorher = vault._writeCount.get(OWN_PATH) ?? 0;

    expect(await plugin.onRemoteYjsUpdate(NOTE)).toBe(true);

    // Mutation (Guard 1 entfernt): 1 — die eigene Hilfsdatei wird neu geschrieben.
    expect((vault._writeCount.get(OWN_PATH) ?? 0) - vorher).toBe(0);
  });
});

describe('Guard 2: ein historienloser leerer Merge-Stand überschreibt keine volle .md', () => {
  async function setup() {
    const vault = makeVaultMock();
    // Ops-freier eigener State: intakter QLB1-Kopf mit GUID, Nutzlast ist der
    // leere Yjs-State. Genau das schreibt `saveState` für eine nie befüllte Notiz.
    const leer = new CrdtManager();
    vault._files.set(OWN_PATH, toArrayBuffer(encodeStateFile(GUID_KLEIN, leer.encodeState(NOTE))));
    // Die .md trägt inzwischen Text — vom Sweep übersprungen (mtime-Rundung).
    vault._textFiles.set(NOTE, TEXT);
    // Peer mit größerer GUID: verliert den Tie-Break, wird nicht mitgemergt.
    vault._files.set(PEER_PATH, peerSidecar(GUID_GROSS, 'Peer-Text\n'));

    const plugin = await boot(vault);
    return { vault, plugin };
  }

  it('Vorbedingung: der Merge-Stand ist leer und der Doc historienlos', async () => {
    const { vault, plugin } = await setup();
    expect(await plugin.syncHandler.loadAndMerge(NOTE)).toBe('');
    expect(plugin.crdtManager.hasOps(NOTE)).toBe(false);
    expect(vault._textFiles.get(NOTE)).toBe(TEXT);
  });

  it('die volle Notiz überlebt den Trigger unverändert', async () => {
    const { vault, plugin } = await setup();

    const erledigt = await plugin.onRemoteYjsUpdate(NOTE);

    // Mutation (Guard 2 entfernt): '' — `data === preMerge` greift und
    // `vault.process` schreibt die leere Datei über die volle Notiz.
    expect(vault._textFiles.get(NOTE)).toBe(TEXT);
    expect(erledigt).toBe(true);
  });

  it('Gegenprobe: eine ECHTE Leerung (Delete-Ops vorhanden) darf weiterhin durchgehen', async () => {
    // Abgrenzung, die Guard 2 ausdrücklich zusagt: Wer allen Text löscht,
    // hinterlässt Delete-Ops → `hasOps()` ist true → der Guard greift NICHT.
    // Ohne diese Engführung wäre eine legitime Leerung nicht mehr synchronisierbar.
    const vault = makeVaultMock();
    const peer = new CrdtManager();
    peer.setContent(NOTE, TEXT);
    const basis = peer.encodeState(NOTE);
    peer.setContent(NOTE, ''); // der Peer löscht alles → Delete-Ops
    vault._files.set(PEER_PATH, toArrayBuffer(encodeStateFile(GUID_KLEIN, peer.encodeState(NOTE))));
    const eigen = new CrdtManager();
    eigen.applyUpdate(NOTE, basis);
    vault._files.set(OWN_PATH, toArrayBuffer(encodeStateFile(GUID_KLEIN, eigen.encodeState(NOTE))));
    vault._textFiles.set(NOTE, TEXT);

    const plugin = await boot(vault);
    expect(await plugin.onRemoteYjsUpdate(NOTE)).toBe(true);
    expect(vault._textFiles.get(NOTE)).toBe('');
    expect(plugin.crdtManager.hasOps(NOTE)).toBe(true);
  });
});
