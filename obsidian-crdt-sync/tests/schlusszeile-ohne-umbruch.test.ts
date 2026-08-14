import * as Y from 'yjs';
import { CrdtManager } from '../src/crdt-manager';

// T-09 — Ohne Schluss-Umbruch verdoppelt `setContent` die letzte Zeile.
//
// BEFUND (Realtest `r14-cdp`, Batterie 2026-08-13; harness-frei reproduziert in
// `spike/duplikat-mb/r14-ursache.mjs`, byte-gleich mit dem Endtext des Laufs):
// `diff_linesToChars_` tokenisiert INKLUSIVE Zeilenende — `"BBB"` und `"BBB\n"`
// sind verschiedene Tokens. Endet der Text nicht auf `\n` (in Obsidian der
// Normalfall), ist seine letzte Zeile beim naechsten `setContent` keine
// unberuehrte Zeile mehr, sondern eine GEAENDERTE:
//
//   DELETE "BBB"        INSERT "BBB\nA2"
//
// Fuer sich ist das textneutral. Der Schaden ist, dass zwei Geraete das
// unabhaengig rechnen: die DELETE-Haelften verschmelzen (gleiches Item), die
// INSERT-Haelften STAPELN sich (verschiedene Items). `BBB` steht danach
// zweimal — einmal als eigene Zeile, einmal an die fremde geklebt:
//
//   "AAA | BBB | B2BBB | A2"      (210 Zeichen, gemessen an zwei Instanzen)
//
// Die Verklebung ist die FOLGE, nicht die Ursache: das erste Item endet ohne
// `\n`, das zweite schliesst direkt an.
//
// ABGRENZUNG zu T-08. Jener Fix gab `threeWayMerge` die Zeilenende-Garantie.
// Er traegt hier NICHT — der Schaden entsteht nicht beim Mergen zweier Texte,
// sondern beim Umrechnen EINES Textes in Ops. Belegt: `r14` blieb nach T-08
// unveraendert rot, mit byte-identischem Assert-Wert (`X-08`).
//
// ABGRENZUNG zur Aktenlage. `docs/produktziel.md` fuehrt dieselbe Mechanik
// unter „Was ab vier Geraeten uebrig bleibt" und nennt N = 2 „strukturell aus".
// Das gilt fuer die dort gemessene Zelle, nicht fuer die Klasse: Hier tritt sie
// bei N = 2 auf. Die Bedingung ist der fehlende Schluss-Umbruch, nicht die
// Geraetezahl.

const NL = String.fromCharCode(10);

const RUMPF = ['# Notiz', '', 'Punkt 1', 'Punkt 2', '', 'Ende', 'AAA', 'BBB'].join(NL);

const zaehle = (text: string, marker: string): number => text.split(marker).length - 1;

// Zwei Replikate mit IDENTISCHEN Item-IDs. Jedes haengt unabhaengig eine eigene
// Zeile an, danach sehen sie einander. Kein Transport, kein Herkunftstor.
function beideHaengenAn(basis: string, m1: string, m2: string): string {
  const quelle = new CrdtManager();
  quelle.setContent('n.md', basis);
  const saat = quelle.encodeState('n.md');

  const a = new CrdtManager();
  const b = new CrdtManager();
  a.applyUpdate('n.md', saat);
  b.applyUpdate('n.md', saat);

  const anhaengen = (m: string) => (basis.endsWith(NL) ? basis + m + NL : basis + NL + m);
  a.setContent('n.md', anhaengen(m1));
  b.setContent('n.md', anhaengen(m2));

  b.applyUpdate('n.md', a.encodeState('n.md'));
  return b.getContent('n.md');
}

// Wieviele TOTE Items traegt die Kette? Genau das ist die Frage: Wer eine Zeile
// nicht anfasst, hinterlaesst auf ihr keinen Tombstone.
//
// ACHTUNG, hier lag eine Blindstelle. Die erste Fassung filterte die toten
// Items nach ihrem TEXT (`text.includes('BBB')`) und war damit immer leer:
// `new Y.Doc()` laeuft mit `gc: true`, und der GC ersetzt den Inhalt eines
// geloeschten Items durch `ContentDeleted` — das Item bleibt in der Kette, sein
// Text ist weg. Der Test war gruen, bevor der Fix existierte. Gezaehlt wird
// deshalb die ANZAHL, nicht der Inhalt.
function toteItems(c: CrdtManager, pfad: string): number {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, c.encodeState(pfad));
  let item = (doc.getText('content') as any)._start;
  let tot = 0;
  while (item) {
    if (item.deleted) tot++;
    item = item.right;
  }
  return tot;
}

describe('T-09: Schlusszeile ohne Zeilenumbruch', () => {
  it('haengen beide Seiten an, steht die letzte Zeile trotzdem nur einmal', () => {
    const text = beideHaengenAn(RUMPF, 'A2', 'B2');

    // Der Kern: `BBB` ist die letzte Zeile des gemeinsamen Ausgangsstands und
    // wurde von niemandem angefasst. Sie darf nicht verdoppelt werden.
    expect(zaehle(text, 'BBB')).toBe(1);

    // Und sie darf nicht an einer fremden Zeile kleben.
    expect(text).not.toMatch(/B2BBB|A2BBB/);

    // Beide Beitraege ueberleben — der Fix darf nichts weglassen.
    expect(zaehle(text, 'A2')).toBe(1);
    expect(zaehle(text, 'B2')).toBe(1);
  });

  it('die unberuehrte Schlusszeile behaelt ihr Item, statt geloescht und neu geschrieben zu werden', () => {
    const c = new CrdtManager();
    c.setContent('n.md', RUMPF);
    const vorher = toteItems(c, 'n.md');
    c.setContent('n.md', RUMPF + NL + 'A2');

    // Das ist die EIGENSCHAFT hinter dem Fix, nicht bloss seine Wirkung: Wer
    // `BBB` nicht anfasst, erzeugt darauf auch keinen Tombstone. Ohne den Fix
    // wird `BBB` geloescht und als Teil von `BBB\nA2` neu geschrieben — die
    // Kette traegt danach ein totes Item mehr.
    expect(toteItems(c, 'n.md')).toBe(vorher);
  });

  it('endet der Ausgangsstand auf einem Umbruch, war es schon vorher sauber', () => {
    // Die Gegenprobe. Sie war im Bestand bereits gruen — steht hier, damit ein
    // spaeterer Umbau nicht die eine Haelfte repariert und die andere bricht.
    const text = beideHaengenAn(RUMPF + NL, 'A2', 'B2');
    expect(zaehle(text, 'BBB')).toBe(1);
    expect(zaehle(text, 'A2')).toBe(1);
    expect(zaehle(text, 'B2')).toBe(1);
  });

  it('wird die Schlusszeile WIRKLICH geaendert, geschieht das weiterhin', () => {
    // Gegenprobe gegen einen zu gierigen Fix: `BBB` -> `BBX` ist eine echte
    // Aenderung und muss ankommen. Ein Fix, der die Schlusszeile pauschal als
    // unveraendert behandelt, wuerde hier den Edit verschlucken.
    const c = new CrdtManager();
    c.setContent('n.md', RUMPF);
    c.setContent('n.md', RUMPF.slice(0, -1) + 'X');
    expect(c.getContent('n.md')).toBe(RUMPF.slice(0, -1) + 'X');
  });

  it('derselbe Text erzeugt keine Operation', () => {
    // Die Identitaet, an der T-08s erste Fassung gefallen ist: ein Fix, der am
    // Dateiende etwas anfasst, ohne dass sich etwas geaendert hat, schreibt
    // Datei und CRDT-Op fuer eine Aenderung, die niemand gemacht hat.
    const c = new CrdtManager();
    c.setContent('n.md', RUMPF);
    const vorher = c.encodeState('n.md');
    c.setContent('n.md', RUMPF);
    expect(Array.from(c.encodeState('n.md'))).toEqual(Array.from(vorher));
  });

  it('eine Aenderung MITTEN in einer Zeile bleibt zeilentreu (T-05)', () => {
    // Der Diskriminator, an dem der naheliegende Fix-Weg gefallen ist:
    // `diff_cleanupMerge` behebt T-09 ebenfalls, zieht dabei aber gemeinsame
    // Affixe UEBERALL heraus. Die Ops sind danach zeichenweise statt
    // zeilentreu, und zwei Replikate, die dieselbe Zeile aendern, erzeugen
    // `"Punkt 2: Beschlossenossen"` — eine zerrissene Zeile, also genau die
    // Schadensklasse, die T-05 beseitigt hat.
    //
    // Dass die Zeile dabei DOPPELT stehen bleibt, ist kein Fehler: Zwei
    // unabhaengig erzeugte, inhaltsgleiche Einfuegungen fuehrt kein Text-CRDT
    // zusammen (`K-09`, sieben Bibliotheken an den Primaerquellen geprueft).
    // Die Zusage lautet Gruppe 1 — der Text bleibt strukturell heil.
    const VOR = ['b-0', 'Punkt 2: Beschluss', 'b-2'].join(NL) + NL;
    const NACH = ['b-0', 'Punkt 2: Beschlossen', 'b-2'].join(NL) + NL;

    const quelle = new CrdtManager();
    quelle.setContent('d.md', VOR);
    const saat = quelle.encodeState('d.md');
    const repl = [0, 1].map(() => {
      const c = new CrdtManager();
      c.applyUpdate('d.md', saat);
      return c;
    });
    for (const c of repl) c.setContent('d.md', NACH);
    repl[0].applyUpdate('d.md', repl[1].encodeState('d.md'));

    const erlaubt = new Set([...VOR.split(NL), ...NACH.split(NL)]);
    const zerrissen = repl[0]
      .getContent('d.md')
      .split(NL)
      .filter((z) => !erlaubt.has(z));
    expect(zerrissen).toEqual([]);
  });

  it('trifft den am Produkt gemessenen Endtext byte-genau', () => {
    // Der Abgleich mit dem Realtest `r14cdp-20260813-213723`. Er macht aus dem
    // Nachbau eine Reproduktion: Ohne ihn koennte der Test eine plausible Lage
    // pruefen statt der gemessenen.
    const ID = 'r14cdp-20260813-213723';
    const echterRumpf = [
      '# Meetingprotokoll',
      '',
      'Punkt 1: Ausgangslage',
      'Punkt 2: Beschluss',
      '',
      'Ende der Vorlage',
      `AAA-${ID}`,
      `BBB-${ID}`,
    ].join(NL);
    const kaputt = [...echterRumpf.split(NL), `B2-${ID}BBB-${ID}`, `A2-${ID}`].join(NL);
    expect(kaputt).toHaveLength(210);

    const text = beideHaengenAn(echterRumpf, `A2-${ID}`, `B2-${ID}`);
    expect(text).not.toBe(kaputt);

    // NICHT gegen die REIHENFOLGE von A2 und B2 pruefen. Welcher der beiden
    // nebenlaeufigen Inserts vorne landet, entscheidet Yjs am clientID-Tie-Break,
    // und die clientIDs sind zufaellig — die erste Fassung dieses Tests nagelte
    // sie fest und war damit ein Muenzwurf. Geprueft wird, was reproduzierbar
    // ist: Laenge und Vorkommen.
    expect(text).toHaveLength(184);
    expect(zaehle(text, `BBB-${ID}`)).toBe(1);
    expect(zaehle(text, `A2-${ID}`)).toBe(1);
    expect(zaehle(text, `B2-${ID}`)).toBe(1);
    expect(text.split(NL)).toHaveLength(10);
  });
});
