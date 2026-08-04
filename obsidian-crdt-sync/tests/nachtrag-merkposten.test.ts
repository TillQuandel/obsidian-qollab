import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// DER MERKPOSTEN — drei Wege, auf denen er verlorengeht, bevor er gebraucht wird.
//
// `ersetzeNachtrag` kann die Nachtrags-Kette nur verwerfen, solange es weiss, DASS
// nachgetragen wurde. Diese Information lebt in `nachgetragen`. Geht sie verloren,
// bleibt die Verdopplung stehen — und zwar endgueltig, denn ein zweiter Nachtrag
// findet nicht statt.
//
// Alle drei Wege sind am Code belegt (Audit 2026-08-04) und keiner davon ist im
// Fuzz-Treiber sichtbar: Der kennt weder Umbenennen noch Neustart, und er misst den
// Endzustand, nicht den Weg dorthin.

const NOTE = 'note.md';
const FREMD_YJS = '.qollab/note.md.bbbb2222.yjs';
const G_FREMD = '00000000000000000000000000000000';

function fremdeSidecarAuf(basis: CrdtManager, guid: string, text: string): ArrayBuffer {
  const m = new CrdtManager();
  m.applyUpdate(NOTE, basis.encodeState(NOTE));
  m.setContent(NOTE, text);
  return toAB(encodeStateFile(guid, m.encodeState(NOTE)));
}

const zaehle = (t: string, n: string): number => t.split(n).length - 1;

function bau(): { vault: any; crdt: CrdtManager; sync: SyncHandler } {
  const vault = makeVaultMock() as any;
  const crdt = new CrdtManager();
  const sync = new SyncHandler(
    vault,
    crdt,
    'aaaa1111',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => {}
  );
  return { vault, crdt, sync };
}

async function bisNachtrag(
  vault: any,
  crdt: CrdtManager,
  sync: SyncHandler,
  text = 'kopf\nFREMD\n'
): Promise<void> {
  vault._files.set(FREMD_YJS, fremdeSidecarAuf(new CrdtManager(), G_FREMD, 'kopf\n'));
  vault._textFiles.set(NOTE, 'kopf\n');
  await sync.applyLocalContent(NOTE, 'kopf\n');
  vault._textFiles.set(NOTE, text);
  sync.parkForeign(NOTE, text);
  for (let i = 0; i < 5 && sync.hasParked(NOTE); i++) await sync.tickParked(NOTE, 4);
  expect(sync.hasParked(NOTE)).toBe(false);
}

describe('Merkposten — die Wege, auf denen er verlorengeht', () => {
  // WEG 1 — der eigene Merge entwertet ihn.
  //
  // `ersetzeNachtrag` prueft, ob der Doc-Text noch dem Stand nach dem Nachtrag
  // entspricht. Trifft zuerst eine UNVOLLSTAENDIGE Fremdhistorie ein, wird nicht
  // ersetzt, die Anwende-Schleife laeuft trotzdem und aendert den Doc. Ab da ist
  // der gemerkte Stand veraltet — und die spaeter eintreffende VOLLSTAENDIGE
  // Historie findet nichts mehr vor, obwohl der Nutzer nie getippt hat.
  it('ein unvollstaendiger Merge darf den Merkposten nicht entwerten', async () => {
    const { vault, crdt, sync } = bau();
    await bisNachtrag(vault, crdt, sync);
    const voll = fremdeSidecarAuf(crdt, G_FREMD, 'kopf\nFREMD\n');

    // Erst trifft eine Historie ein, die den nachgetragenen Text NICHT traegt.
    vault._files.set(FREMD_YJS, fremdeSidecarAuf(new CrdtManager(), G_FREMD, 'kopf\nANDERS\n'));
    await sync.loadAndMerge(NOTE);

    // Dann die vollstaendige. Sie deckt den Nachtrag ab — jetzt muss ersetzt werden.
    vault._files.set(FREMD_YJS, voll);
    await sync.loadAndMerge(NOTE);

    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(1);
  });

  // WEG 2 — Umbenennen. Alle anderen Zustandskarten ziehen mit, diese nicht.
  it('nach dem Umbenennen der Notiz gilt der Merkposten weiter', async () => {
    const { vault, crdt, sync } = bau();
    await bisNachtrag(vault, crdt, sync);
    const voll = fremdeSidecarAuf(crdt, G_FREMD, 'kopf\nFREMD\n');

    const NEU = 'umbenannt.md';
    vault._textFiles.set(NEU, vault._textFiles.get(NOTE));
    vault._textFiles.delete(NOTE);
    sync.renameNote(NOTE, NEU);

    vault._files.set(`.qollab/${NEU}.bbbb2222.yjs`, voll);
    await sync.loadAndMerge(NEU);

    expect(zaehle(crdt.getContent(NEU), 'FREMD')).toBe(1);
  });

  // WEG 3 — Loeschen. Der Merkposten muss verschwinden, sonst haelt er einen
  // Textstand fest, den es nicht mehr gibt (Speicher, und beim Wiederanlegen
  // derselben Notiz eine falsche Zusage).
  it('nach dem Loeschen der Notiz ist der Merkposten geraeumt', async () => {
    const { vault, crdt, sync } = bau();
    await bisNachtrag(vault, crdt, sync);
    sync.disposeNote(NOTE);
    expect(sync.hatNachtrag(NOTE)).toBe(false);
  });
});
