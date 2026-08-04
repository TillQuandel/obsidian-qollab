import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// FEHLERPOTENZIAL des Korrektur-Verfahrens (Weg B).
//
// Der Fuzz-Treiber kann diese Faelle nicht finden: Er zaehlt Tokens, die im
// Text genau einmal vorkommen sollen. Eine Zeile, die der NUTZER absichtlich
// zweimal schreibt, kommt darin nicht vor — und genau daran kann eine
// Korrektur, die „ueberzaehlige" Zeilen entfernt, scheitern.

const NOTE = 'note.md';
const FREMD_YJS = '.qollab/note.md.bbbb2222.yjs';
const G_FREMD = '00000000000000000000000000000000';

function fremdeSidecarAuf(basis: CrdtManager, guid: string, text: string): ArrayBuffer {
  const m = new CrdtManager();
  m.applyUpdate(NOTE, basis.encodeState(NOTE));
  m.setContent(NOTE, text);
  return toAB(encodeStateFile(guid, m.encodeState(NOTE)));
}

const zaehle = (text: string, nadel: string): number => text.split(nadel).length - 1;

function bau(verfahren: 'ersetzen' | 'undo' | 'korrigieren'): {
  vault: any;
  crdt: CrdtManager;
  sync: SyncHandler;
} {
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
  sync.nachtragVerfahren = verfahren;
  return { vault, crdt, sync };
}

describe('Korrektur-Verfahren — Fehlerpotenzial', () => {
  it('RISIKO: eine Zeile, die der Nutzer NACH dem Nachtrag absichtlich wiederholt', async () => {
    const { vault, crdt, sync } = bau('korrigieren');

    vault._files.set(FREMD_YJS, fremdeSidecarAuf(new CrdtManager(), G_FREMD, 'kopf\n'));
    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');
    const peerSidecar = fremdeSidecarAuf(crdt, G_FREMD, 'kopf\nTODO\n');

    // Der Sync liefert eine Zeile 'TODO'. Sie wird geparkt und nach Fristablauf
    // nachgetragen — steht also im Merkposten.
    vault._textFiles.set(NOTE, 'kopf\nTODO\n');
    sync.parkForeign(NOTE, 'kopf\nTODO\n');
    for (let i = 0; i < 5 && sync.hasParked(NOTE); i++) await sync.tickParked(NOTE, 4);
    expect(zaehle(crdt.getContent(NOTE), 'TODO')).toBe(1);

    // Der Nutzer schreibt eine ZWEITE, eigene TODO-Zeile. Sie ist gewollt.
    await sync.applyLocalContent(NOTE, 'kopf\nTODO\nTODO\n');
    expect(zaehle(crdt.getContent(NOTE), 'TODO')).toBe(2);

    // Jetzt trifft die Fremdhistorie ein und die Korrektur laeuft.
    vault._files.set(FREMD_YJS, peerSidecar);
    await sync.loadAndMerge(NOTE);

    // Die zweite TODO-Zeile ist die des Nutzers und muss stehen bleiben.
    expect(zaehle(crdt.getContent(NOTE), 'TODO')).toBe(2);
  });

  it('der Merkposten liegt im Doc und ueberlebt einen Neustart', async () => {
    const { vault, crdt, sync } = bau('korrigieren');

    vault._files.set(FREMD_YJS, fremdeSidecarAuf(new CrdtManager(), G_FREMD, 'kopf\n'));
    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');
    const peerSidecar = fremdeSidecarAuf(crdt, G_FREMD, 'kopf\nFREMD\n');

    vault._textFiles.set(NOTE, 'kopf\nFREMD\n');
    sync.parkForeign(NOTE, 'kopf\nFREMD\n');
    for (let i = 0; i < 5 && sync.hasParked(NOTE); i++) await sync.tickParked(NOTE, 4);

    // NEUSTART: Der Doc wird aus dem persistierten State neu aufgebaut, alle
    // Speicher-Merkposten sind weg. Genau hier scheitert Weg A (UndoManager).
    const state = crdt.encodeState(NOTE);
    const crdt2 = new CrdtManager();
    crdt2.applyUpdate(NOTE, state);
    const sync2 = new SyncHandler(
      vault,
      crdt2,
      'aaaa1111',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {}
    );
    sync2.nachtragVerfahren = 'korrigieren';

    // Der Merkposten muss den Neustart ueberlebt haben.
    expect(crdt2.gemerkt(NOTE, 'nachtrag')).toBe('1');

    vault._files.set(FREMD_YJS, peerSidecar);
    await sync2.loadAndMerge(NOTE);

    expect(zaehle(crdt2.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('der Merkposten ist ein Flag, kein Volltext — Groesse der Hilfsdatei', async () => {
    // Der Merkposten liegt in der Y.Map und reist in der Hilfsdatei mit. Bei
    // einer grossen Notiz verdoppelt das ihren Beitrag zur Sidecar. Gemessen,
    // damit die Groessenordnung dokumentiert ist statt vermutet.
    const { vault, crdt, sync } = bau('korrigieren');
    const gross = 'kopf\n' + Array.from({ length: 400 }, (_, i) => `zeile-${i}`).join('\n') + '\n';

    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');
    const ohne = crdt.encodeState(NOTE).length;

    vault._textFiles.set(NOTE, gross);
    sync.parkForeign(NOTE, gross);
    for (let i = 0; i < 5 && sync.hasParked(NOTE); i++) await sync.tickParked(NOTE, 4);

    const mit = crdt.encodeState(NOTE).length;
    // eslint-disable-next-line no-console
    console.log(
      `\n===== Hilfsdatei-Groesse =====\n  Notiz ${gross.length} B | State ohne Merkposten ${ohne} B | mit ${mit} B | Aufschlag ${
        mit - ohne
      } B (${((100 * (mit - ohne)) / gross.length).toFixed(0)} % der Notiz)\n`
    );
    expect(mit).toBeGreaterThan(ohne);
  });
});
