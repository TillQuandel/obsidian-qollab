// Die abgeschnittene FREMD-Sidecar in `mergeCompatible` — Entwarnung, mit Zahlen
//
// AUSGANGSLAGE. `Y.applyUpdate` wirft nicht atomar: Fehlt einer Sidecar nur das
// letzte Byte, steht der komplette Fremd-Text danach trotzdem im Doc — und es
// wirft. „Hat geworfen" heisst also nicht „hat nichts angewandt".
// `mergeCompatible` faengt genau diesen Wurf pro Datei, meldet ihn ueber
// `onCorruptFile` und merged die uebrigen Geschwister weiter. Es arbeitet damit
// womoeglich auf einem halb befuellten Doc, schreibt den Stand anschliessend per
// `saveState` fest und traegt ihn ueber den Write-Back in die `.md`.
//
// Die Frage war, ob daraus dauerhafter Schaden entsteht. Gemessen: nein. Der
// Grund ist die Reihenfolge, in der Yjs ein Update liest (`readUpdateV2`):
//
//   1. Der GESAMTE Struct-Abschnitt wird gelesen, bevor irgendein Struct
//      integriert wird. Ein Schnitt in diesen Abschnitt laesst den Lesevorgang
//      mit `RangeError` scheitern — bevor irgendetwas im Doc landet. Der Doc ist
//      danach unveraendert.
//   2. Erst danach folgt das Delete-Set, und es wird waehrend des Lesens
//      angewandt. Ein Schnitt HIER trifft einen Doc, der die Einfuegungen des
//      Peers bereits vollstaendig hat, und laesst einen Teil seiner LOESCHUNGEN
//      aus.
//
// Daraus folgt die tragende Invariante: ein Teilstand hat immer ZUVIEL Text, nie
// zu wenig. Eine halb angewandte Einfuegung kann es nicht geben. Und weil
// Loeschungen in Yjs monoton sind und in jedem spaeteren Voll-State erneut
// mitgeliefert werden, holt die naechste vollstaendige Datei genau die fehlenden
// Loeschungen nach — auf denselben Item-IDs, die noch im Doc stehen.
// `mergeCompatible` ruft kein `setContent`; der Teilstand wird also nie als
// frische eigene Op neu materialisiert, und nur das waere unheilbar.
//
// MESSREIHE (Basis 25 Zeichen im Ziel-Doc, fehlende Byte am Dateiende):
//
//   Peer fuegt an (Update 92 Byte)          Peer loescht 5 Zeilen (Update 123 Byte)
//   fehlt  Wurf         Doc-Text            fehlt  Wurf    Ops   Doc-Text
//   ----------------------------------      ---------------------------------------
//     0    -            59 (vollstaendig)     0    -       10    15 (vollstaendig)
//     1    Error        59 (vollstaendig)     1    Error    9    18 (1 Loeschung fehlt)
//     2    RangeError   25 (unveraendert)     3    Error    7    21 (2 Loeschungen fehlen)
//     3    RangeError   25 (unveraendert)     5    Error    5    24 (3 Loeschungen fehlen)
//     5    RangeError   25 (unveraendert)    10    Error    1    30 (unveraendert)
//    10    RangeError   25 (unveraendert)    20    Error    1    30 (unveraendert)
//
// Das Teilstand-Fenster ist der Delete-Set-Schwanz und entsprechend schmal: 1 von
// 93 Schnittlaengen bei reiner Einfuegung, 17 von 257 bei Loeschung+Einfuegung,
// 23 von 322 beim Totalersatz. Alle uebrigen Schnitte lassen den Doc unberuehrt.
//
// ENTSCHEIDENDE ZAHL: ueber ALLE 712 Schnittlaengen der vier gemessenen
// Update-Formen heilt die nachgelieferte vollstaendige Datei in 712 Faellen auf
// den exakten Peer-Stand — 0 Verletzungen. Durch die echte `loadAndMerge`-Kette
// gemessen (253 Schnittlaengen): 0 Abweichungen vom Sollstand, 0 Divergenzen
// zwischen den Geraeten. Deshalb kein Fix, sondern dieser Test.
//
// Was der Test bewacht: Sollte Yjs jemals dazu uebergehen, Structs waehrend des
// Lesens zu integrieren (halbe Einfuegung!), oder sollte ein Aufrufer hinter den
// Fang von `mergeCompatible` ein `setContent` setzen, faellt die Invariante — und
// dann ist der Teilstand sehr wohl unheilbar.
//
// NACHTRAG QLB2. Alles oben gilt weiter auf der Yjs-Ebene (erstes `describe`).
// Durch `loadAndMerge` erreicht eine abgeschnittene QLB2-Datei den Doc aber gar
// nicht mehr: Der Integritaetsnachweis sitzt VOR dem Inhalt und verwirft sie. Das
// Teilstand-Fenster gibt es dort also nicht mehr — nicht weil `mergeCompatible`
// sich geaendert haette, sondern weil der Fall vorher endet. Fuer die
// nachweislosen Altformate (QLB1, headerlose v0.1) bleibt der Weg unveraendert;
// das zweite `describe` misst beide Seiten gegeneinander.

import * as Y from 'yjs';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import { encodeStateFile as encodeStateFileV040 } from './_v040/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'note.md';
const GUID = 'aabbccddeeff00112233445566778899';
const OWN_ID = 'aaaaaaaa';
const PEER_ID = 'bbbbbbbb';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const PEER_PATH = `.qollab/${NOTE}.${PEER_ID}.yjs`;

const BASIS = 'Kopf\nBestand A\nBestand B\n';
const EXTRA = 'Fremder Absatz vom zweiten Geraet\n';

// MESSFALLE: Ein `subarray`-View laesst den Decoder ueber das View-Ende hinaus in
// den Elternpuffer lesen — die Trunkierung saehe dann harmlos aus und die Messung
// waere still falsch. Nur eine echte Kopie exakter Laenge reproduziert den Fehler.
function schnitt(bytes: Uint8Array, fehlend: number): Uint8Array {
  const out = new Uint8Array(bytes.length - fehlend);
  out.set(bytes.subarray(0, bytes.length - fehlend));
  return out;
}

// GEMEINSAME Historie: ein Basis-State, aus dem beide Geraete hervorgehen. Ohne
// ihn haetten die Ketten keinen gemeinsamen Vorfahren, und jede Messung zeigte
// die Dopplung unverwandter Ketten statt der Wirkung der Trunkierung.
function basisState(): Uint8Array {
  const m = new CrdtManager();
  m.setContent(NOTE, BASIS);
  return m.encodeState(NOTE);
}

// Das zweite Geraet uebernimmt die Basis und bringt sie auf `ziel`.
function peerState(basis: Uint8Array, ziel: string): Uint8Array {
  const p = new CrdtManager();
  p.applyUpdate(NOTE, basis);
  p.setContent(NOTE, ziel);
  return p.encodeState(NOTE);
}

// Ist `kurz` eine Teilfolge von `lang`? Genau die Frage „fehlt uns etwas, das der
// Peer uns geben wollte?" — Zeichen duerfen ueberzaehlig dazwischenstehen
// (ausgelassene Loeschung), aber keines darf fehlen.
function istTeilfolge(kurz: string, lang: string): boolean {
  let i = 0;
  for (const c of lang) if (i < kurz.length && c === kurz[i]) i++;
  return i === kurz.length;
}

const zaehle = (text: string, nadel: string): number => text.split(nadel).length - 1;

describe('abgeschnittene Sibling-Datei: Yjs-Ebene', () => {
  // Die vier Update-Formen, die im Sync real vorkommen. Das dritte Feld sagt, ob
  // dieses Update ueberhaupt ein Teilstand-Fenster hat: Es entsteht nur im
  // Delete-Set-Schwanz, und der ist bei wenigen, zusammenhaengenden Loeschungen
  // so kurz, dass jeder Schnitt schon den Struct-Abschnitt trifft (dann bleibt
  // der Doc unberuehrt). Die Faelle mit Fenster tragen die Beweislast.
  const faelle: Array<[string, string, boolean]> = [
    ['nur Einfuegung', BASIS + EXTRA, true],
    ['nur Loeschung', 'Kopf\n', false],
    ['Loeschung und Einfuegung', 'Kopf\nBestand B\n' + EXTRA, true],
    ['Totalersatz', 'Voellig anderer Text\nZweite Zeile\n', true],
  ];

  it.each(faelle)(
    '%s: jede Schnittlaenge laesst den Doc entweder unberuehrt oder nur mit ZUVIEL Text zurueck',
    (_name, ziel, mitFenster) => {
      const basis = basisState();
      const voll = peerState(basis, ziel);
      let teilstaende = 0;

      for (let fehlend = 1; fehlend < voll.length; fehlend++) {
        const doc = new Y.Doc();
        Y.applyUpdate(doc, basis);
        const vorher = doc.getText('content').toString();
        try {
          Y.applyUpdate(doc, schnitt(voll, fehlend));
        } catch {
          // Erwartet — genau darum geht es. Der Fang steht in mergeCompatible.
        }
        const zwischen = doc.getText('content').toString();

        if (zwischen !== vorher) {
          teilstaende++;
          // Kernaussage: nichts vom Peer fehlt. Der Teilstand traegt den
          // Peer-Zielstand vollstaendig und obendrein die Zeichen, deren
          // Loeschung noch nicht angekommen ist.
          expect(istTeilfolge(ziel, zwischen)).toBe(true);
          expect(zwischen.length).toBeGreaterThanOrEqual(ziel.length);
        }

        // Und die nachgelieferte vollstaendige Datei heilt exakt — fuer JEDE
        // Schnittlaenge, mit und ohne vorherigen Teilstand.
        Y.applyUpdate(doc, voll);
        expect(doc.getText('content').toString()).toBe(ziel);
        doc.destroy();
      }

      // Gegenprobe gegen einen vakuum-gruenen Test: wo ein Fenster existiert,
      // MUSS es tatsaechlich betreten worden sein — sonst pruefte die Schleife
      // oben nur unberuehrte Docs und die Aussage waere leer.
      if (mitFenster) expect(teilstaende).toBeGreaterThan(0);
    }
  );
});

describe('abgeschnittene Sibling-Datei: durch loadAndMerge', () => {
  const ZIEL = 'Kopf\nBestand B\n' + EXTRA; // loescht UND fuegt an

  // EINMAL gebaut: jeder `new Y.Doc()` bekommt eine zufaellige Client-ID, und mit
  // ihr schwankt die Laenge des encodierten States. Wer die Datei pro Durchlauf
  // neu baut, laeuft mit einer Schnittlaenge gegen eine anders lange Datei.
  const basis = basisState();
  const voll = peerState(basis, ZIEL);
  const datei = encodeStateFile(GUID, voll);

  // Ein Durchlauf: abgeschnittene Peer-Datei mergen, Write-Back wie in main.ts,
  // danach liefert der Sync dieselbe Datei vollstaendig nach.
  async function durchlauf(fehlend: number) {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, BASIS);
    vault._files.set(OWN_PATH, toAB(encodeStateFile(GUID, basis)));
    vault._files.set(PEER_PATH, toAB(fehlend === 0 ? datei : schnitt(datei, fehlend)));

    const korrupt: string[] = [];
    const h = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const teilstand = await h.loadAndMerge(NOTE);
    if (teilstand !== null) {
      vault._textFiles.set(NOTE, teilstand); // Write-Back (main.ts, vault.process)
      h.noteLocalDiffBase(NOTE, teilstand);
    }

    vault._files.set(PEER_PATH, toAB(datei));
    const endstand = await h.loadAndMerge(NOTE);

    // Was sieht der Peer, wenn er UNSERE Sidecar zurueckbekommt?
    const peer = new CrdtManager();
    peer.applyUpdate(NOTE, voll);
    peer.applyUpdate(NOTE, decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!)).update);

    return { vault, h, korrupt, teilstand, endstand, beimPeer: peer.getContent(NOTE) };
  }

  it('jede Schnittlaenge endet exakt auf dem Peer-Stand, ohne Divergenz', async () => {
    for (let fehlend = 1; fehlend < datei.length; fehlend++) {
      const { endstand, beimPeer } = await durchlauf(fehlend);
      expect(endstand).toBe(ZIEL);
      expect(beimPeer).toBe(ZIEL);
    }
  });

  // GEAENDERT MIT QLB2. Vorher hiess dieser Test „der Teilstand ist sichtbar und
  // gemeldet — aber vergaenglich"; er hielt fest, dass der halbe Fremd-Stand samt
  // Ruecklaeufern in die `.md` des Nutzers geschrieben wurde und spaeter heilte.
  //
  // Mit dem Integritaetsnachweis passiert das nicht mehr: Der Nachweis sitzt VOR
  // dem Inhalt, also wird die abgeschnittene Datei verworfen, bevor `applyUpdate`
  // sie ueberhaupt sieht. Das ist kein Kollateralschaden, sondern der Kern des
  // Formats — die 367 gemessenen Faelle der Nullfuellung sind auf Inhaltsebene von
  // einer Trunkierung NICHT unterscheidbar (beide: parst, traegt Ops, liefert
  // einen anderen Text). Wer den Teilstand einer trunkierten Datei annehmen will,
  // muss auch den verfaelschten Stand einer genullten annehmen.
  //
  // PREIS, benannt: Kommt die vollstaendige Datei nie, bekommen wir aus einer
  // trunkierten QLB2-Datei jetzt gar nichts statt eines Teilstands. Verloren geht
  // dabei nichts — die Datei bleibt liegen, wird gemeldet, und ihr Original liegt
  // beim Peer. Fuer die nachweislosen Altformate (QLB1, headerlose v0.1) gilt
  // unveraendert der alte Weg ueber den `applyUpdate`-Fang in `mergeCompatible`.
  it('der abgeschnittene Fremd-Stand kommt gar nicht mehr an — gemeldet, nicht halb gemergt', async () => {
    // 5 fehlende Byte lagen im Delete-Set-Schwanz: genau das Fenster, in dem
    // frueher ein Teilstand entstand.
    const { vault, h, korrupt, teilstand } = await durchlauf(5);

    // Der beschaedigte Pfad ist gemeldet — der Nutzer erfaehrt davon.
    expect(korrupt).toContain(PEER_PATH);
    // Und NIE geloescht: der Sync kann sie noch vervollstaendigen.
    expect(vault._files.has(PEER_PATH)).toBe(true);
    // Der eigene Stand ist unberuehrt — kein Ruecklaeufer in der `.md`.
    expect(teilstand).toBe(BASIS);
    expect(vault._textFiles.get(NOTE)).toBe(BASIS);

    // Der Nutzer tippt weiter …
    const getippt = BASIS + 'Lokal getippt\n';
    vault._textFiles.set(NOTE, getippt);
    await h.applyLocalContent(NOTE, getippt);

    // … und ERST DANACH kommt die vollstaendige Datei. Beides ueberlebt, nichts
    // steht doppelt, die Loeschung des Peers ist angekommen. Das ist die Zusage,
    // auf die es ankommt, und sie haelt.
    const endstand = await h.loadAndMerge(NOTE)!;
    expect(zaehle(endstand!, 'Fremder Absatz')).toBe(1);
    expect(zaehle(endstand!, 'Lokal getippt')).toBe(1);
    expect(zaehle(endstand!, 'Bestand A')).toBe(0);
    expect(endstand!.startsWith('Kopf\nBestand B\n')).toBe(true);

    // Die REIHENFOLGE der beiden Zeilen ist nicht mehr dieselbe wie frueher, und
    // das ist kein Zufall: Der lokale Edit sitzt jetzt auf dem BASIS-Stand statt
    // auf dem Teilstand, der den fremden Absatz schon enthielt. Beide Zeilen sind
    // damit echt nebenlaeufig — und dass die Reihenfolge dabei ueberraschen kann,
    // ist eine benannte Grenze, kein Verlust. Nicht gepinnt, weil sie an der
    // Merge-Reihenfolge haengt und nicht an einer Zusage.
    expect(new Set(endstand!.trim().split('\n')).size).toBe(4);
  });

  // Gegenprobe zur Aussage oben: an einer QLB1-Datei entsteht der Teilstand
  // weiterhin. Damit ist belegt, dass ihn der NACHWEIS schliesst und nicht etwa
  // eine Aenderung an `mergeCompatible` — und dass der Altbestand unveraendert
  // durch dieselbe Kette laeuft.
  it('an einer QLB1-Altdatei entsteht der Teilstand unveraendert', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, BASIS);
    vault._files.set(OWN_PATH, toAB(encodeStateFile(GUID, basis)));
    vault._files.set(PEER_PATH, toAB(schnitt(encodeStateFileV040(GUID, voll), 5)));

    const korrupt: string[] = [];
    const h = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );

    const teilstand = await h.loadAndMerge(NOTE);

    expect(korrupt).toContain(PEER_PATH);
    // Alles vom Peer ist da, plus Zeichen, deren Loeschung noch aussteht.
    expect(istTeilfolge(ZIEL, teilstand!)).toBe(true);
    expect(teilstand).not.toBe(ZIEL);
  });

  // Seit QLB2 misst dieser Fall den Teilstand nicht mehr (der Nachweis verwirft
  // die Datei vorher, siehe oben) — er haelt jetzt fest, dass unsere eigene
  // Sidecar in diesem Fall SAUBER bleibt: Was ein drittes Geraet von uns bekommt,
  // ist der unveraenderte Basis-Stand, keine halbe Fremd-Kette.
  it('kommt die vollstaendige Datei nie, bleibt der Teilstand heilbar statt verfestigt', async () => {
    const basis = basisState();
    const voll = peerState(basis, ZIEL);
    const datei = encodeStateFile(GUID, voll);

    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, BASIS);
    vault._files.set(OWN_PATH, toAB(encodeStateFile(GUID, basis)));
    vault._files.set(PEER_PATH, toAB(schnitt(datei, 5)));

    const h = new SyncHandler(vault, new CrdtManager(), OWN_ID);
    const teilstand = await h.loadAndMerge(NOTE);
    vault._textFiles.set(NOTE, teilstand!);

    // Ein drittes Geraet kennt nur die Basis und bekommt UNSERE Sidecar: es
    // uebernimmt den Teilstand mitsamt der ausstehenden Loeschungen …
    const drittes = new CrdtManager();
    drittes.applyUpdate(NOTE, basis);
    drittes.applyUpdate(NOTE, decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!)).update);
    expect(drittes.getContent(NOTE)).toBe(teilstand);

    // … und wird geheilt, sobald es die Datei des Peers aus irgendeiner Quelle
    // vollstaendig sieht. Der Teilstand ist also keine eigene Kette, sondern nur
    // eine noch nicht zugestellte Loeschung.
    drittes.applyUpdate(NOTE, voll);
    expect(drittes.getContent(NOTE)).toBe(ZIEL);
  });
});

describe('abgeschnittene EIGENE Sidecar bei lebendem Doc', () => {
  // Gegenrichtung: nicht die fremde, die eigene Datei ist abgeschnitten. Der
  // Kaltstart-Fall bricht seit Task 17 ab (`truncated-own-state.test.ts`); hier
  // geht es um den Fall, den `mergeCompatible` wirklich sieht — der Doc liegt
  // bereits im Speicher, `ensureDoc` kehrt im `hasDoc`-Zweig zurueck, und die
  // eigene Datei laeuft als Sibling durch denselben Fang.
  it('schadet nicht und die Datei wird beim naechsten saveState repariert', async () => {
    const basis = basisState();
    const ziel = 'Kopf\nBestand B\n' + EXTRA;
    const voll = peerState(basis, ziel);

    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, BASIS);
    vault._files.set(OWN_PATH, toAB(encodeStateFile(GUID, basis)));

    const korrupt: string[] = [];
    const h = new SyncHandler(vault, new CrdtManager(), OWN_ID, undefined, (p: string) =>
      korrupt.push(p)
    );
    await h.applyLocalContent(NOTE, BASIS); // Doc in den Speicher holen

    // Jetzt wird die eigene Datei auf der Platte abgeschnitten (Stromausfall im
    // Write des Sync-Dienstes), waehrend der Doc lebt — und der Peer meldet sich.
    const eigenVoll = new Uint8Array(vault._files.get(OWN_PATH)!);
    vault._files.set(OWN_PATH, toAB(schnitt(eigenVoll, 5)));
    vault._files.set(PEER_PATH, toAB(encodeStateFile(GUID, voll)));

    const endstand = await h.loadAndMerge(NOTE);

    expect(korrupt).toContain(OWN_PATH);
    expect(endstand).toBe(ziel);
    // Der Doc trug den Stand weiter, `saveState` hat die halbe Datei ersetzt.
    expect(vault._files.get(OWN_PATH)!.byteLength).toBeGreaterThan(eigenVoll.length - 5);
  });
});
