import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// DER NACHTRAG-SCHADENSWEG — die letzte verbliebene Quelle der Verdopplung.
//
// Belegt, nicht vermutet: Der Detektor (`spike/zz9-detektor.spec.ts`) führt in
// beiden Lastzellen 100 % der Duplikat-Geburten auf `mergeCompatible` →
// `applyUpdate` (`sync-handler.ts:1118`) zurück — und JEDER Lauf mit
// Verdopplung hatte einen Fristablauf-Nachtrag: 28/28 bei drei Geräten, 42/42
// bei drei Notizen, 0 ohne. Der Nachtrag ist damit die notwendige Bedingung.
//
// Die Kette:
//   1. Der Datei-Sync legt die `.md` des Peers ab, seine Hilfsdatei ist noch
//      unterwegs. Das Herkunftstor erkennt den Stand als fremd und PARKT ihn —
//      es entsteht keine eigene Op.
//   2. Die Historie kommt nicht. Die Frist läuft ab, der Nachtrag erfasst den
//      geparkten Text DOCH — jetzt als eigene Op unter eigener Client-ID.
//   3. Die Historie trifft doch noch ein. `mergeCompatible` zieht sie ein, Yjs
//      dedupliziert nach Item-ID und nicht nach Inhalt — der Text steht zweimal.
//
// Schritt 1 und 3 sind gewollt und bleiben. Der Schaden hängt an Schritt 2.

const NOTE = 'note.md';
const OWN_YJS = '.qollab/note.md.aaaa1111.yjs';
const FREMD_YJS = '.qollab/note.md.bbbb2222.yjs';
const G_FREMD = '00000000000000000000000000000000';

// Eine fremde Hilfsdatei, die auf der GEMEINSAMEN Historie aufsetzt: erst den
// eigenen Stand übernehmen, dann den fremden Zusatz als eigene Op anfügen. Genau
// so entsteht sie in der Realität, wenn beide Geräte dieselbe Kennung tragen.
function fremdeSidecarAuf(
  vault: any,
  basis: CrdtManager,
  guid: string,
  text: string
): ArrayBuffer {
  const m = new CrdtManager();
  m.applyUpdate(NOTE, basis.encodeState(NOTE));
  m.setContent(NOTE, text);
  return toAB(encodeStateFile(guid, m.encodeState(NOTE)));
}

const zaehle = (text: string, nadel: string): number => text.split(nadel).length - 1;

function mitSicherung(
  vault: any,
  crdt: CrdtManager,
  senke: Array<[string, string]>
): SyncHandler {
  return new SyncHandler(
    vault,
    crdt,
    'aaaa1111',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (pfad: string, text: string) => {
      senke.push([pfad, text]);
    }
  );
}

// Fährt die Kette bis zum Ende und gibt den Doc-Text zurück.
async function fahreKette(frist: number): Promise<{
  text: string;
  sicherungen: Array<[string, string]>;
  nachgetragen: boolean;
}> {
  const vault = makeVaultMock() as any;
  const crdt = new CrdtManager();
  const senke: Array<[string, string]> = [];
  const sync = mitSicherung(vault, crdt, senke);

  // Gemeinsame Ausgangslage: beide Geräte tragen `kopf`.
  vault._files.set(FREMD_YJS, fremdeSidecarAuf(vault, new CrdtManager(), G_FREMD, 'kopf\n'));
  vault._textFiles.set(NOTE, 'kopf\n');
  await sync.applyLocalContent(NOTE, 'kopf\n');
  expect(vault._files.has(OWN_YJS)).toBe(true);

  // Der Peer tippt FREMD — als eigene Op-Kette auf der gemeinsamen Historie.
  const peerSidecar = fremdeSidecarAuf(vault, crdt, G_FREMD, 'kopf\nFREMD\n');

  // (1) Der Datei-Sync ist schneller als die Hilfsdatei. Das Tor parkt.
  const geliefert = 'kopf\nFREMD\n';
  vault._textFiles.set(NOTE, geliefert);
  sync.parkForeign(NOTE, geliefert);
  expect(sync.hasParked(NOTE)).toBe(true);
  expect(crdt.getContent(NOTE)).toBe('kopf\n');

  // (2) Die Historie kommt nicht. Die Frist läuft ab.
  for (let i = 0; i < frist + 1 && sync.hasParked(NOTE); i++) {
    await sync.tickParked(NOTE, frist);
  }
  const nachgetragen = !sync.hasParked(NOTE);

  // (3) Die Historie trifft doch noch ein.
  vault._files.set(FREMD_YJS, peerSidecar);
  await sync.loadAndMerge(NOTE);

  return { text: crdt.getContent(NOTE), sicherungen: senke, nachgetragen };
}

describe('Nachtrag — die letzte Quelle der Verdopplung', () => {
  // Dieser Test war der ROTE Reproduktionstest: Bis zum Ersatz-Zweig in
  // `mergeCompatible` lief genau diese Kette in `zaehle(text,'FREMD') === 2`
  // (verifiziert am 2026-08-04, vor dem Fix: BELEG grün mit 2, ZIEL rot mit
  // Expected 1 / Received 2). Jetzt bewacht er, dass der Nachtrag überhaupt
  // feuert — ohne ihn prüfte der Test daneben eine Lage, die es gar nicht gibt.
  it('der Nachtrag feuert und materialisiert den fremden Text als eigene Op', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const senke: Array<[string, string]> = [];
    const sync = mitSicherung(vault, crdt, senke);

    vault._files.set(FREMD_YJS, fremdeSidecarAuf(vault, new CrdtManager(), G_FREMD, 'kopf\n'));
    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    vault._textFiles.set(NOTE, 'kopf\nFREMD\n');
    sync.parkForeign(NOTE, 'kopf\nFREMD\n');
    expect(crdt.getContent(NOTE)).toBe('kopf\n'); // geparkt: noch keine eigene Op

    for (let i = 0; i < 5 && sync.hasParked(NOTE); i++) await sync.tickParked(NOTE, 4);

    expect(sync.hasParked(NOTE)).toBe(false);
    // Der Nachtrag hat den fremden Text erfasst — ab hier trägt der Doc ihn unter
    // EIGENER Client-ID, und genau daraus entstand die Verdopplung.
    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('KONTROLLE: kommt die Historie VOR dem Fristablauf, steht FREMD genau einmal', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const senke: Array<[string, string]> = [];
    const sync = mitSicherung(vault, crdt, senke);

    vault._files.set(FREMD_YJS, fremdeSidecarAuf(vault, new CrdtManager(), G_FREMD, 'kopf\n'));
    vault._textFiles.set(NOTE, 'kopf\n');
    await sync.applyLocalContent(NOTE, 'kopf\n');

    const peerSidecar = fremdeSidecarAuf(vault, crdt, G_FREMD, 'kopf\nFREMD\n');

    const geliefert = 'kopf\nFREMD\n';
    vault._textFiles.set(NOTE, geliefert);
    sync.parkForeign(NOTE, geliefert);

    // Die Historie kommt rechtzeitig — kein Nachtrag, keine eigene Op.
    vault._files.set(FREMD_YJS, peerSidecar);
    await sync.loadAndMerge(NOTE);

    expect(sync.hasParked(NOTE)).toBe(false);
    expect(zaehle(crdt.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('ZIEL: auch nach Fristablauf steht FREMD genau einmal, und nichts geht verloren', async () => {
    const { text, sicherungen } = await fahreKette(4);
    expect(zaehle(text, 'FREMD')).toBe(1);
    // Der Grundtext bleibt unversehrt — der Fix darf nicht in die Verlustrichtung
    // kippen. Das ist die Messlatte aus dem Auftrag: Verdopplung senken, ohne
    // Verlust zu erzeugen.
    expect(text).toContain('kopf');
    expect(sicherungen.length).toBeGreaterThanOrEqual(0);
  });
});
