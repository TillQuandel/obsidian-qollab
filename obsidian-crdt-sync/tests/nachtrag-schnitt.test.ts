import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// WEG C — der Herkunfts-Schnitt. Geprueft an genau den drei Lagen, in denen
// `ersetzeNachtrag` aussteigt:
//   1. Obsidian wurde zwischen Nachtrag und Fremdhistorie neu gestartet.
//   2. Der Nutzer hat seit dem Nachtrag getippt.
//   3. Der Nutzer hat dabei dieselbe Zeile absichtlich wiederholt.
//
// Der Schnitt braucht keine der beiden Bedingungen von `ersetzen`: Der beim
// Nachtrag erzeugte clock-Bereich identifiziert dessen Zeichen arithmetisch, und
// der Vermerk liegt im Doc — er reist mit der Hilfsdatei und ueberlebt Neustarts.

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

function bau(
  verfahren: 'ersetzen' | 'schnitt',
  vault = makeVaultMock() as any,
  crdt = new CrdtManager()
): { vault: any; crdt: CrdtManager; sync: SyncHandler } {
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
  sync.nachtragVerfahren = verfahren;
  return { vault, crdt, sync };
}

// Bis einschliesslich Nachtrag. Gibt die noch zurueckgehaltene Fremd-Hilfsdatei.
async function bisNachtrag(
  vault: any,
  crdt: CrdtManager,
  sync: SyncHandler,
  geliefert = 'kopf\nFREMD\n'
): Promise<ArrayBuffer> {
  vault._files.set(FREMD_YJS, fremdeSidecarAuf(new CrdtManager(), G_FREMD, 'kopf\n'));
  vault._textFiles.set(NOTE, 'kopf\n');
  await sync.applyLocalContent(NOTE, 'kopf\n');
  const peer = fremdeSidecarAuf(crdt, G_FREMD, geliefert);
  vault._textFiles.set(NOTE, geliefert);
  sync.parkForeign(NOTE, geliefert);
  for (let i = 0; i < 5 && sync.hasParked(NOTE); i++) await sync.tickParked(NOTE, 4);
  expect(sync.hasParked(NOTE)).toBe(false);
  return peer;
}

describe('Herkunfts-Schnitt', () => {
  it('GRUNDFALL: schneidet den Nachtrag, wenn die Fremdhistorie ihn traegt', async () => {
    const { vault, crdt, sync } = bau('schnitt');
    const peer = await bisNachtrag(vault, crdt, sync);
    vault._files.set(FREMD_YJS, peer);
    await sync.loadAndMerge(NOTE);
    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(1);
    expect(crdt.getContent(NOTE)).toContain('kopf');
  });

  it('LAGE 1 — Neustart: der Vermerk liegt im Doc und ueberlebt ihn', async () => {
    const { vault, crdt, sync } = bau('schnitt');
    const peer = await bisNachtrag(vault, crdt, sync);

    // Obsidian wird geschlossen: neuer Prozess, Doc aus dem State neu gebaut.
    const state = crdt.encodeState(NOTE);
    const crdt2 = new CrdtManager();
    crdt2.applyUpdate(NOTE, state);
    const { sync: sync2 } = bau('schnitt', vault, crdt2);

    vault._files.set(FREMD_YJS, peer);
    await sync2.loadAndMerge(NOTE);

    expect(zaehle(crdt2.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('LAGE 2 — der Nutzer hat seit dem Nachtrag getippt', async () => {
    const { vault, crdt, sync } = bau('schnitt');
    const peer = await bisNachtrag(vault, crdt, sync);

    await sync.applyLocalContent(NOTE, 'kopf\nFREMD\nMEIN\n');
    vault._files.set(FREMD_YJS, peer);
    await sync.loadAndMerge(NOTE);

    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(1);
    expect(zaehle(crdt.getContent(NOTE), 'MEIN')).toBe(1); // kein Verlust
  });

  it('LAGE 3 — der Nutzer wiederholt dieselbe Zeile absichtlich', async () => {
    const { vault, crdt, sync } = bau('schnitt');
    const peer = await bisNachtrag(vault, crdt, sync, 'kopf\nTODO\n');

    // Eine zweite, eigene TODO-Zeile. Sie liegt AUSSERHALB des clock-Bereichs
    // des Nachtrags — der Schnitt darf sie nicht treffen.
    await sync.applyLocalContent(NOTE, 'kopf\nTODO\nTODO\n');
    vault._files.set(FREMD_YJS, peer);
    await sync.loadAndMerge(NOTE);

    expect(zaehle(crdt.getContent(NOTE), 'TODO')).toBe(2);
  });

  it('SICHERUNG: traegt die Fremdhistorie den Text NICHT, wird nicht geschnitten', async () => {
    const { vault, crdt, sync } = bau('schnitt');
    await bisNachtrag(vault, crdt, sync, 'kopf\nFREMD\nNUR-IN-DATEI\n');

    // Die eintreffende Historie kennt nur einen Teil des nachgetragenen Textes.
    vault._files.set(FREMD_YJS, fremdeSidecarAuf(new CrdtManager(), G_FREMD, 'kopf\nFREMD\n'));
    await sync.loadAndMerge(NOTE);

    expect(zaehle(crdt.getContent(NOTE), 'NUR-IN-DATEI')).toBe(1);
  });

  it('GEGENPROBE: derselbe Neustart-Ablauf unter ersetzen verdoppelt', async () => {
    const { vault, crdt, sync } = bau('ersetzen');
    const peer = await bisNachtrag(vault, crdt, sync);

    const state = crdt.encodeState(NOTE);
    const crdt2 = new CrdtManager();
    crdt2.applyUpdate(NOTE, state);
    const { sync: sync2 } = bau('ersetzen', vault, crdt2);

    vault._files.set(FREMD_YJS, peer);
    await sync2.loadAndMerge(NOTE);

    // Bestand: der Merkposten lebte im Speicher und ist fort.
    expect(zaehle(crdt2.getContent(NOTE), 'FREMD')).toBe(2);
  });
});
