// Szenariosuche Welle 2 — Linse „Zustandsübergänge zwischen Versionen"
//
// Prüfgegenstand: die Datierungs-Behauptung, auf der die gesamte Legacy-Logik
// von `decodeSiblings`, `cleanupLegacyFile` und der `legitimatelyEmpty`-Ausnahme
// ruht.
//
//   sync-handler.ts:622-627  „Das clientId-Segment und der QLB1-Header kamen
//                             gemeinsam in v0.4.0 … eine Datei mit gültigem
//                             `<8-hex>.yjs`-Namen ohne Header ist deshalb NIE
//                             eine v0.1-Datei, sondern unfertig oder korrupt."
//   legacy-empty-note.test.ts:47  „Kein v0.1-Erbe: die per-Client-Form kam erst
//                                  mit dem QLB1-Header."
//
// Die Git-Historie sagt etwas anderes (alles mit `git log -1 --date=iso`
// nachgemessen):
//
//   0.1.0    2026-05-18 22:07  stateFilePath = `${notePath}.yjs`
//                              → NEBEN der Note, kein .qollab/, kein Header
//   9095f3c  2026-05-19 15:57  stateFilePath = `${notePath}.${clientId}.yjs`
//                              → per-Client-Segment, immer noch neben der Note
//   e3e0c61  2026-05-19 21:13  stateFilePath = `.qollab/${notePath}.${clientId}.yjs`
//                              → Umzug nach .qollab/, Segment schon da
//   e2dd21c  2026-07-21 23:16  QLB1-Header
//   v0.4.0   2026-07-28 08:02  Release
//
// Daraus folgen zwei Dinge, die der Code nicht kennt:
//
//   (1) `.qollab/<note>.yjs` — die Pfadform, die `legacyFilePath` sucht — hat
//       NIE eine Fassung geschrieben. Das clientId-Segment (15:57) war fünf
//       Stunden VOR dem Umzug nach `.qollab/` (21:13) da. Der echte v0.1-Stand
//       liegt unter `<note>.yjs` NEBEN der Note und wird von `listYjsInDir` nie
//       gelistet.
//   (2) `.qollab/<note>.<8hex>.yjs` OHNE Header ist ein reales Format und war es
//       63 Tage lang (2026-05-19 21:13 bis 2026-07-21 23:16). Der Code stuft
//       genau diese Form als „unfertig oder korrupt" ein.
//
// ERSCHÖPFENDER NACHWEIS statt Stichprobe. Über alle 50 Commits, die je eine
// `sync-handler.ts` angefasst haben (`git log --all -- '*sync-handler.ts'`),
// gibt es genau DREI `stateFilePath`-Rümpfe:
//
//    44×  return `${QOLLAB_DIR}/${notePath}.${this.clientId}.yjs`;
//     4×  return notePath + '.yjs';
//     2×  return `${notePath}.${this.clientId}.yjs`;
//
// `${QOLLAB_DIR}/${notePath}.yjs` kommt NULL Mal vor. Diese Pfadform hat keine
// Fassung von Qollab je geschrieben.
//
// Veröffentlicht wurden davon zwei (GitHub Releases): `0.1.0` (2026-05-18,
// Form 2) und `v0.4.0` (2026-07-28, Form 1 mit Header). Form 3 und Form 1 ohne
// Header liefen nur auf Eigenbauten — die aber sehr wohl auf Geräten (der
// Realtest-Aufbau der Szenariosuche baut ausdrücklich „gegen master").
//
// Die Tests messen, was heute mit beiden Formen passiert.

import * as Y from 'yjs';
import { SyncHandler, filterYjsFiles } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'deadbeef';
const PEER_ID = '00000001';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const PEER_PATH = `.qollab/${NOTE}.${PEER_ID}.yjs`;
const LEGACY_QOLLAB_PATH = `.qollab/${NOTE}.yjs`; // sucht der Code — nie geschrieben
const V01_REAL_PATH = `${NOTE}.yjs`; // schrieb v0.1.0 wirklich

// Genau das, was eine Fassung aus dem Fenster 2026-05-19 .. 2026-07-21 auf die
// Platte legte: roher Yjs-Update-Blob, KEIN QLB1-Kopf, per-Client-Dateiname.
function zwischenformat(text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(mgr.encodeState(NOTE));
}

function mitHeader(guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(encodeStateFile(guid, mgr.encodeState(NOTE)));
}

const leererState = (): ArrayBuffer => toAB(Y.encodeStateAsUpdate(new Y.Doc()));

describe('(1) die gesuchte Legacy-Pfadform hat nie existiert', () => {
  it('der echte v0.1.0-Stand liegt NEBEN der Note und wird nie gelistet', async () => {
    const vault = makeVaultMock();
    // So sah eine v0.1.0-Installation aus: die .yjs liegt im Vault, nicht in .qollab/.
    vault._files.set(V01_REAL_PATH, zwischenformat('v0.1-Historie\n'));
    vault._textFiles.set(NOTE, 'v0.1-Historie\n');

    // Der Produktions-Listing-Pfad sieht sie nicht — er listet ausschließlich
    // dirname('.qollab/' + notePath).
    expect(await vault.listYjsFiles(NOTE)).toEqual([]);
    // Und selbst wenn der Pfad hineingereicht würde, filtert ihn der Sibling-Filter weg.
    expect(filterYjsFiles([V01_REAL_PATH], NOTE)).toEqual([]);

    const handler = new SyncHandler(vault as any, new CrdtManager(), OWN_ID);
    await handler.applyLocalContent(NOTE, 'v0.1-Historie\n');

    // Die v0.1-Datei bleibt unangetastet im Vault liegen — kein Import, kein Cleanup.
    expect(vault._files.has(V01_REAL_PATH)).toBe(true);
  });

  it('`legacyFilePath` zeigt auf `.qollab/<note>.yjs`', () => {
    const handler = new SyncHandler(makeVaultMock() as any, new CrdtManager(), OWN_ID);
    expect((handler as any).legacyFilePath(NOTE)).toBe(LEGACY_QOLLAB_PATH);
  });
});

describe('(2) Zwischenformat: per-Client-Name ohne QLB1-Header', () => {
  it('ENTLASTUNG: der EIGENE Zwischenformat-Stand wird korrekt migriert', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, zwischenformat('Alte Historie\n'));
    vault._textFiles.set(NOTE, 'Alte Historie\n');

    const handler = new SyncHandler(vault as any, new CrdtManager(), OWN_ID);
    const merged = await handler.applyLocalContent(NOTE, 'Alte Historie\nNeue Zeile\n');

    expect(merged).toBe('Alte Historie\nNeue Zeile\n');
    // Datei ist ins aktuelle Format überführt (Header vorhanden).
    const bytes = new Uint8Array(vault._files.get(OWN_PATH)!);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x51, 0x4c, 0x42, 0x32]);
  });

  it('SCHADEN A: der FREMDE Zwischenformat-Stand wird still verschluckt', async () => {
    const vault = makeVaultMock();
    // Peer läuft noch auf einer Fassung aus dem 63-Tage-Fenster.
    vault._files.set(PEER_PATH, zwischenformat('Nur auf dem Peer getippt\n'));
    // Wir haben schon einen GUID-tragenden eigenen Stand.
    vault._files.set(OWN_PATH, mitHeader('a'.repeat(32), 'Lokal\n'));
    vault._textFiles.set(NOTE, 'Lokal\n');

    const corrupt: string[] = [];
    const handler = new SyncHandler(vault as any, new CrdtManager(), OWN_ID, undefined, (p) =>
      corrupt.push(p)
    );
    const merged = await handler.loadAndMerge(NOTE);

    // Der Peer-Text kommt nie an.
    expect(merged).not.toContain('Nur auf dem Peer getippt');
    // Kein Kanal meldet das — weder korrupt noch sonst etwas.
    expect(corrupt).toEqual([]);
    // Und die Datei bleibt liegen: kein Aufräumpfad, dauerhaft.
    expect(vault._files.has(PEER_PATH)).toBe(true);
  });

  it('GEGENPROBE: dieselben Bytes in v0.1-Pfadform werden ebenfalls verworfen — aber ABGERÄUMT', async () => {
    const vault = makeVaultMock();
    vault._files.set(LEGACY_QOLLAB_PATH, zwischenformat('Nur auf dem Peer getippt\n'));
    vault._files.set(OWN_PATH, mitHeader('a'.repeat(32), 'Lokal\n'));
    vault._textFiles.set(NOTE, 'Lokal\n');

    const handler = new SyncHandler(vault as any, new CrdtManager(), OWN_ID);
    const merged = await handler.loadAndMerge(NOTE);

    // R1 verwirft den Inhalt auch hier — die Annahme dahinter ist „v0.1-Erbe,
    // längst importiert". Der Unterschied liegt im Aufräumen: die Legacy-Form
    // verschwindet, die per-Client-Form bleibt für immer liegen.
    expect(merged).not.toContain('Nur auf dem Peer getippt');
    expect(vault._files.has(LEGACY_QOLLAB_PATH)).toBe(false);
  });

  it('SCHADEN A2: der Zwischenformat-Peer ist LEBEND — jede weitere Änderung fällt aus', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, mitHeader('a'.repeat(32), 'Gemeinsam\n'));
    vault._textFiles.set(NOTE, 'Gemeinsam\n');

    const gesehen: string[] = [];
    for (let runde = 1; runde <= 3; runde++) {
      // Der Peer tippt weiter und schreibt seinen Stand — headerlos, per-Client.
      vault._files.set(PEER_PATH, zwischenformat(`Gemeinsam\nPeer-Zeile ${runde}\n`));
      const handler = new SyncHandler(vault as any, new CrdtManager(), OWN_ID);
      gesehen.push((await handler.loadAndMerge(NOTE)) ?? '');
    }

    // R1 behandelt einen LEBENDEN Peer wie ein eingefrorenes v0.1-Erbe:
    // keine seiner Runden kommt je an.
    for (const text of gesehen) expect(text).not.toContain('Peer-Zeile');
  });

  it('SCHADEN B: leerer Zwischenformat-Stand = Falschmeldung in JEDER Sitzung', async () => {
    const messungen: string[][] = [];
    // Zwei Sitzungen hintereinander auf demselben Dateibestand.
    const vault = makeVaultMock();
    vault._files.set(PEER_PATH, leererState()); // nie befüllte Note beim Peer
    vault._files.set('.qollab/note.md.00000002.yjs', mitHeader('b'.repeat(32), 'Text\n'));
    vault._textFiles.set(NOTE, 'Text\n');

    for (let sitzung = 0; sitzung < 2; sitzung++) {
      const corrupt: string[] = [];
      const handler = new SyncHandler(vault as any, new CrdtManager(), OWN_ID, undefined, (p) =>
        corrupt.push(p)
      );
      await handler.loadAndMerge(NOTE);
      messungen.push(corrupt);
    }

    expect(messungen[0]).toContain(PEER_PATH);
    expect(messungen[1]).toContain(PEER_PATH); // unbegrenzt wiederholend
    expect(vault._files.has(PEER_PATH)).toBe(true); // nie abgeräumt
  });

  it('GEGENPROBE: derselbe leere State in v0.1-Pfadform meldet nichts', async () => {
    const vault = makeVaultMock();
    vault._files.set(LEGACY_QOLLAB_PATH, leererState());
    vault._files.set('.qollab/note.md.00000002.yjs', mitHeader('b'.repeat(32), 'Text\n'));
    vault._textFiles.set(NOTE, 'Text\n');

    const corrupt: string[] = [];
    const handler = new SyncHandler(vault as any, new CrdtManager(), OWN_ID, undefined, (p) =>
      corrupt.push(p)
    );
    await handler.loadAndMerge(NOTE);

    expect(corrupt).toEqual([]);
  });
});
