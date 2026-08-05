// Der Integritätsnachweis im LAUFENDEN Betrieb — nicht nur im Format.
//
// `state-file.test.ts` misst, dass der Nachweis die verfälschten Bytes erkennt.
// Hier steht die Frage danach: Was macht der SyncHandler mit dem Befund? Drei
// Zusagen, und alle drei sind Datenschutz-Zusagen im wörtlichen Sinn:
//
//   1. Eine FREMDE Datei mit verfehltem Nachweis wird gemeldet, übersprungen und
//      NIE gelöscht — der Datei-Sync trüge die Löschung sonst zum anderen Gerät,
//      wo dieselbe Datei intakt sein kann.
//   2. Die EIGENE Datei mit verfehltem Nachweis bricht den Lauf ab. Sie als
//      „gibt es nicht" zu behandeln hieße Adopt-Zweig, und der prägt mangels
//      Fremd-Datei eine FRISCHE GUID über eine lebende Historie — die Spaltung,
//      die der Nullfüllungs-Fix gerade geschlossen hat.
//   3. Der Grundtext kippt nicht mehr still. Das ist der eigentliche Zweck: Von
//      391 gemessenen Schnittstellen trafen 367 eine TEILWEISE intakte Nutzlast,
//      die fehlerfrei parst, Ops trägt und trotzdem einen anderen Text liefert.
//      Kein Prädikat auf dem Inhalt kann das sehen — der Inhalt ist ja plausibel.
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { encodeStateFile as encodeStateFileV040 } from './_v040/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'deadbeef';
const FREMD_ID = 'cafe0001';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const FREMD_PATH = `.qollab/${NOTE}.${FREMD_ID}.yjs`;
const LEGACY_PATH = `.qollab/${NOTE}.yjs`;
const GUID = 'aabbccddeeff00112233445566778899';
const FREMD_GUID = '00112233445566778899aabbccddeeff';

const TEXT = 'Kopf\nBestand A\nBestand B\n';

function update(text: string): Uint8Array {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return mgr.encodeState(NOTE);
}

function sidecar(guid: string, text: string): Uint8Array {
  return encodeStateFile(guid, update(text));
}

// Die Nullfüllung, die den Grundtext still verfälscht: Größe bleibt, ab `keep`
// steht NUL. `keep` liegt MITTEN in der Nutzlast (nicht dahinter), damit sie
// teilweise intakt bleibt — genau die 367er-Klasse.
function nullgefuellt(datei: Uint8Array, keep: number): Uint8Array {
  const b = new Uint8Array(datei.length);
  b.set(datei.subarray(0, keep), 0);
  return b;
}

describe('QLB2-Integritaet: fremde Sidecar', () => {
  it('wird gemeldet, uebersprungen und NIE geloescht', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_PATH, toAB(sidecar(GUID, TEXT)));

    const fremd = sidecar(FREMD_GUID, 'Fremde Zeile\n');
    vault._files.set(FREMD_PATH, toAB(nullgefuellt(fremd, fremd.length - 8)));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const merged = await handler.loadAndMerge(NOTE);

    expect(korrupt).toContain(FREMD_PATH);
    // Der bestehende Weg: melden, nicht löschen.
    expect(vault._files.has(FREMD_PATH)).toBe(true);
    // Und der eigene Stand läuft unbeschädigt weiter.
    expect(merged).toBe(TEXT);
    expect(await handler.currentGuid(NOTE)).toBe(GUID);
  });

  it('blockiert die uebrigen Siblings nicht — der intakte Peer wird gemergt', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_PATH, toAB(sidecar(GUID, TEXT)));

    // Zwei Fremd-Dateien derselben Inkarnation: eine kaputt, eine heil.
    const kaputt = sidecar(GUID, TEXT + 'Von Gerät X\n');
    vault._files.set(FREMD_PATH, toAB(nullgefuellt(kaputt, kaputt.length - 8)));
    vault._files.set(
      `.qollab/${NOTE}.beef0002.yjs`,
      toAB(encodeStateFile(GUID, update(TEXT + 'Von Gerät Y\n')))
    );

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const merged = (await handler.loadAndMerge(NOTE))!;

    expect(korrupt).toEqual([FREMD_PATH]);
    expect(merged).toContain('Von Gerät Y');
    expect(merged).not.toContain('Von Gerät X');
  });
});

describe('QLB2-Integritaet: eigene Sidecar', () => {
  it('bricht ab, statt eine frische Inkarnation ueber die lebende zu praegen', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    const voll = sidecar(GUID, TEXT);
    vault._files.set(OWN_PATH, toAB(nullgefuellt(voll, voll.length - 8)));
    const laengeVorher = vault._files.get(OWN_PATH)!.byteLength;

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const ergebnis = await handler.applyLocalContent(NOTE, TEXT);

    expect(ergebnis).toBeUndefined();
    expect(korrupt).toContain(OWN_PATH);
    // Nichts zurückgeschrieben: der Sync kann die Datei noch vervollständigen.
    expect(vault._writeCount.get(OWN_PATH)).toBeUndefined();
    expect(vault._files.get(OWN_PATH)!.byteLength).toBe(laengeVorher);
    // Und die `.md` bleibt unangetastet.
    expect(vault._textFiles.get(NOTE)).toBe(TEXT);
  });

  it('der Grundtext kippt nicht — auch nicht bei teilweise intakter Nutzlast', async () => {
    // Der 367er-Fall, an einer Stelle festgenagelt: die Nutzlast parst, traegt
    // Ops und liefert einen ANDEREN Text. Ohne Nachweis landete genau der im Doc.
    const voll = sidecar(GUID, TEXT);
    const schnitt = voll.length - 5;
    const kaputt = nullgefuellt(voll, schnitt);

    // Vorbedingung der Messung: die Nutzlast ist wirklich noch anwendbar und
    // wirklich schon falsch. Sonst prueft der Test etwas anderes als er behauptet.
    const probe = new CrdtManager();
    probe.applyUpdate(NOTE, kaputt.subarray(24));
    expect(probe.getContent(NOTE)).not.toBe(TEXT);
    expect(probe.getContent(NOTE).length).toBeGreaterThan(0);

    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_PATH, toAB(kaputt));

    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID);
    await handler.applyLocalContent(NOTE, TEXT);

    // Der verfaelschte Stand ist nirgends angekommen.
    expect(vault._textFiles.get(NOTE)).toBe(TEXT);
    expect(vault._writeCount.get(OWN_PATH)).toBeUndefined();
  });
});

// Die drei Lesepfade am LAUFENDEN Handler, nicht nur an `decodeStateFile`. Fiele
// einer weg, waere das Update selbst der Datenverlust.
describe('QLB2-Integritaet: die Altbestaende bleiben lesbar', () => {
  it('QLB1: die eigene v0.4.0-Datei wird uebernommen und als QLB2 neu geschrieben', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_PATH, toAB(encodeStateFileV040(GUID, update(TEXT))));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const merged = await handler.applyLocalContent(NOTE, TEXT + 'Neue Zeile\n');

    expect(korrupt).toEqual([]);
    expect(merged).toBe(TEXT + 'Neue Zeile\n');
    // Die Inkarnation aus dem alten Kopf ueberlebt — keine frische GUID.
    expect(await handler.currentGuid(NOTE)).toBe(GUID);
    // Und die Datei liegt danach im aktuellen Format.
    const neu = new Uint8Array(vault._files.get(OWN_PATH)!);
    expect(String.fromCharCode(...Array.from(neu.subarray(0, 4)))).toBe('QLB2');
  });

  it('QLB1: eine fremde v0.4.0-Datei wird ganz normal gemergt', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_PATH, toAB(sidecar(GUID, TEXT)));
    vault._files.set(FREMD_PATH, toAB(encodeStateFileV040(GUID, update(TEXT + 'Vom Alt-Peer\n'))));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const merged = (await handler.loadAndMerge(NOTE))!;

    expect(korrupt).toEqual([]);
    expect(merged).toContain('Vom Alt-Peer');
  });

  it('headerlose v0.1-Legacy wird weiter importiert', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, TEXT);
    // Nur die Legacy-Datei, kein GUID-Stand — der Erst-Import-Fall.
    vault._files.set(LEGACY_PATH, toAB(update(TEXT + 'Aus v0.1\n')));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const merged = (await handler.loadAndMerge(NOTE))!;

    expect(korrupt).toEqual([]);
    expect(merged).toContain('Aus v0.1');
  });

  it('der legitim leere State laeuft weiter durch', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, '');
    vault._files.set(OWN_PATH, toAB(encodeStateFile(GUID, new Uint8Array([0, 0]))));

    const korrupt: string[] = [];
    const handler = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    await handler.loadAndMerge(NOTE);

    expect(korrupt).toEqual([]);
    expect(await handler.currentGuid(NOTE)).toBe(GUID);
  });
});
