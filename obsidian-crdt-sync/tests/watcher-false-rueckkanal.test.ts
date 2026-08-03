// Testlücke aus der Mutationsmessung (Runde 3, 25 von 69 Mutationen blieben grün):
// Der `false`-RÜCKKANAL des Watchers war nirgends geprüft.
//
// `runChanged` (sidecar-watcher.ts) fasst zwei Abbruchformen zusammen: einen Wurf
// und ein `onChanged`, das `false` ZURÜCKGIBT. Nur die erste hatte einen Test
// (`sidecar-read-abort.test.ts`, F-2a) — und genau die kommt produktiv nie vor:
// `onRemoteYjsUpdate` wirft in keinem Abbruchpfad, es gibt `false` zurück
// (`unloaded`, `!settings.enabled`, `sweepRunning`, `merged === null`,
// `hasAbortedRead`, Abbruch im pending-Zweig). Die Mutation „`runChanged` gibt
// immer `true`" ließ deshalb die ganze Suite grün.
//
// Was ohne den Rückkanal passiert: `lastSeen` rückt trotz Ablehnung vor. Derselbe
// Sidecar-Stand löst nie wieder aus — die Notiz synct erst wieder, wenn der Peer
// erneut schreibt (mtime/size ändern sich) oder Obsidian neu startet. Jede
// Ablehnung verbraucht also ihren Trigger endgültig.
//
// Bewacht werden hier drei Zeilen: die Auswertung `!== false` in `runChanged`,
// das `if (await this.runChanged(...))` vor `lastSeen.set` in `poll` und das
// vorzeitige `return` in `scanNote`.

import CrdtSyncPlugin from '../src/main';
import { SidecarWatcher } from '../src/sidecar-watcher';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer, VaultMock } from './helpers/vault-mock';

const SELF = '00000000';
const NOTE = 'note.md';
const FOREIGN = '.qollab/note.md.a1b2c3d4.yjs';

const ab = () => new ArrayBuffer(1);

describe('poll: ein `false` aus onChanged verbraucht den Trigger nicht', () => {
  it('derselbe unveränderte Sidecar-Stand löst erneut aus, bis onChanged zustimmt', async () => {
    const vault = makeVaultMock();
    vault._files.set(FOREIGN, ab());

    let antwort: boolean = false;
    const onChanged = jest.fn(async () => antwort);
    const w = new SidecarWatcher(vault.adapter, SELF, onChanged);

    // Drei Polls auf einer Datei, die sich nie ändert. Die ersten beiden lehnen ab.
    await w.poll();
    await w.poll();
    expect(onChanged).toHaveBeenCalledTimes(2); // Mutation („immer true"): 1

    // Erst die Zustimmung verbucht den Trigger.
    antwort = true;
    await w.poll();
    await w.poll();
    expect(onChanged).toHaveBeenCalledTimes(3);
  });

  it('buchführung je Datei: die abgelehnte wiederholt sich, die angenommene nicht', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/ja.md.a1b2c3d4.yjs', ab());
    vault._files.set('.qollab/nein.md.a1b2c3d4.yjs', ab());

    const onChanged = jest.fn(async (notePath: string) => notePath === 'ja.md');
    const w = new SidecarWatcher(vault.adapter, SELF, onChanged);

    await w.poll();
    onChanged.mockClear();
    await w.poll();

    expect(onChanged).toHaveBeenCalledWith('nein.md');
    expect(onChanged).not.toHaveBeenCalledWith('ja.md');
  });

  it('`undefined` (der Normalfall eines void-onChanged) gilt weiter als erledigt', async () => {
    // Gegenprobe zur Zeile `!== false`: nur ein echtes `false` lehnt ab. Würde
    // stattdessen auf Wahrheitswert geprüft (`if (await onChanged(...))`), stünde
    // hier Dauerfeuer auf jeder Sidecar.
    const vault = makeVaultMock();
    vault._files.set(FOREIGN, ab());
    const onChanged = jest.fn(async () => undefined);
    const w = new SidecarWatcher(vault.adapter, SELF, onChanged);

    await w.poll();
    await w.poll();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe('scanNote: ein `false` aus onChanged verbraucht den Trigger nicht', () => {
  it('der file-open-Scan löst erneut aus, bis onChanged zustimmt', async () => {
    const vault = makeVaultMock();
    vault._files.set(FOREIGN, ab());

    let antwort: boolean = false;
    const onChanged = jest.fn(async () => antwort);
    const w = new SidecarWatcher(vault.adapter, SELF, onChanged);

    await w.scanNote(NOTE);
    await w.scanNote(NOTE);
    expect(onChanged).toHaveBeenCalledTimes(2); // Mutation („immer true"): 1

    antwort = true;
    await w.scanNote(NOTE);
    await w.scanNote(NOTE);
    expect(onChanged).toHaveBeenCalledTimes(3);
  });

  it('bei mehreren Sidecars derselben Note bleibt KEINE als gesehen zurück', async () => {
    // `scanNote` sammelt erst alle (Pfad, mtime/size) ein und schreibt sie in einem
    // Rutsch fort. Der Abbruch muss den ganzen Block überspringen — sonst gilt eine
    // zweite fremde Sidecar als gesehen, obwohl ihr Stand nie gemergt wurde.
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', ab());
    vault._files.set('.qollab/note.md.deadbeef.yjs', ab());

    let antwort: boolean = false;
    const w = new SidecarWatcher(vault.adapter, SELF, async () => antwort);
    await w.scanNote(NOTE);

    // Die erste Datei verschwindet; nur die zweite bleibt übrig. Wäre sie beim
    // abgelehnten Scan als gesehen verbucht worden, triggerte sie nie wieder.
    vault._files.delete('.qollab/note.md.a1b2c3d4.yjs');
    antwort = true;
    const zweiter = jest.fn(async () => true);
    (w as any).onChanged = zweiter;
    await w.scanNote(NOTE);
    expect(zweiter).toHaveBeenCalledWith(NOTE);
  });
});

// ---------------------------------------------------------------------------
// Der produktive Fall: kein Wurf, sondern ein regulärer `false`-Rückgabewert aus
// `onRemoteYjsUpdate`. Der Aus-Schalter ist der am leichtesten reproduzierbare
// dieser Pfade (`main.ts`: `if (!this.settings.enabled) return false;`) und
// zugleich der mit der längsten Wirkung — zwischen Ausschalten und Wiedereinschalten
// liegen Tage, in denen der Peer genau einmal schreibt.
// ---------------------------------------------------------------------------
describe('Integration: eine Ablehnung aus onRemoteYjsUpdate geht dem Merge nicht verloren', () => {
  const OWN_ID = 'deadbeef';
  const PEER_ID = '00000001';
  const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
  const PEER_PATH = `.qollab/${NOTE}.${PEER_ID}.yjs`;
  const GUID = 'aa'.repeat(16);
  const BASE = 'Zeile 1\nZeile 2\n';
  const MIT_FREMD = 'Zeile 1\nZeile 2\nFREMD\n';

  async function boot(vault: VaultMock) {
    const storage = makeLocalStorage();
    storage.saveLocalStorage('qollab-client-id', OWN_ID);
    const vaultWithEvents = Object.assign(vault, {
      on: () => ({}),
      offref: () => {},
    });
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

  it('nach dem Wiedereinschalten zieht derselbe unveränderte Peer-Stand nach', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);

    // Eigener Stand auf der Platte, Peer-Sidecar mit derselben GUID (kompatibel).
    const eigen = new CrdtManager();
    eigen.setContent(NOTE, BASE);
    vault._files.set(OWN_PATH, toArrayBuffer(encodeStateFile(GUID, eigen.encodeState(NOTE))));
    const peer = new CrdtManager();
    peer.applyUpdate(NOTE, eigen.encodeState(NOTE));
    peer.setContent(NOTE, MIT_FREMD);
    vault._files.set(PEER_PATH, toArrayBuffer(encodeStateFile(GUID, peer.encodeState(NOTE))));

    const plugin = await boot(vault);

    // Sync ist aus. Der Poll sieht die Peer-Sidecar zum ersten Mal und lehnt ab.
    plugin.settings.enabled = false;
    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get(NOTE)).toBe(BASE);

    // Der Peer schreibt nichts mehr — die Datei bleibt Byte für Byte dieselbe.
    // Nur der Schalter geht wieder an.
    plugin.settings.enabled = true;
    await plugin.sidecarWatcher.poll();

    // Mutation („runChanged gibt immer true"): weiterhin BASE — der Trigger war
    // während der Aus-Phase verbraucht, der Fremd-Edit erreicht die Notiz nie.
    expect(vault._textFiles.get(NOTE)).toBe(MIT_FREMD);
  });
});
