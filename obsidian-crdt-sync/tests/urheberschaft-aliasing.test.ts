import * as Y from 'yjs';
import { CrdtManager } from '../src/crdt-manager';
import { unionMerge } from '../src/text-merge';

// Der Inkarnationswechsel materialisiert den lokalen Stand als EIGENE Ops — und
// genau das muss er tun.
//
// `switchToGuid` (`src/sync-handler.ts:1375`) verwirft beim verlorenen Tie-Break
// die eigene Historie (`:1398`), baut den Gewinner-Doc aus dessen Sidecars auf
// (`:1406-1415`) und schreibt die Vereinigung aus Gewinner- und lokalem Stand per
// `setContent` zurueck (`:1454`, ueber `unite` → `unionMerge`, `:601-602`).
// Sichtbare Folge: Zeilen, die der Gewinner-Doc bereits traegt, stehen danach
// zweimal da — einmal als sein Item, einmal als frische Op DIESES Geraets.
//
// Diese Verdopplung sieht nach Verschwendung aus. Sie ist der TRAEGER DER
// LOKALEN URHEBERSCHAFT: das zweite Vorkommen ist die einzige Kopie, die dem
// Verlierer-Geraet gehoert.
//
// GEMESSEN (harness-frei in `spike/gate-widerlegung/probe-aliasing.mjs`, mit
// `node` lauffaehig; hier auf CrdtManager-Ebene nachgestellt). Der naheliegende
// Fix — ein zeilenweises Gate, das die vom Gewinner schon getragenen Zeilen
// weglaesst — faellt an K.o.-Kriterium 1:
//
//   winnerText = "b0 b3 b2"          localText = "b0 b1 A1 b2 b3"
//
//   OHNE Gate  Ziel: b0 b3 b1 A1 b2 b3   b3 zweimal: Gewinner-Item + eigene Op
//              Gewinner loescht sein b3  -> "b0 b1 A1 b2 b3"  lokaler Stand LEBT
//   MIT Gate   Ziel: b0 b3 b1 A1 b2      b3 nur noch als Gewinner-Item
//              derselbe Delete           -> "b0 b1 A1 b2"     lokaler Beitrag TOT
//
// Wer die lokale Zeile weglaesst, WEIL der Gewinner dafuer ein Item hat,
// aliasiert den eigenen Beitrag auf ein FREMDES Item. Ab da toetet ihn jeder
// gewoehnliche Delete auf dem Gewinner-Geraet, der mit dem lokalen Inhalt nie
// etwas zu tun hatte. Loeschen ist in Yjs monoton und propagiert auf alle
// Geraete; der Endstand bleibt konvergent — der Verlust ist also STILL, und
// „Divergenz 0" weist ihn nicht aus.
//
// WARUM DIESE DATEI NOETIG IST — die zehn Testdateien, die `switchToGuid`
// erreichen, sehen die Falle aus drei Gruenden nicht:
//   1. Sie wenden nach dem Wechsel nie ein weiteres Gewinner-Update an
//      (`guid-incarnation-merge.test.ts` prueft `merged` direkt nach
//      `loadAndMerge`). Der Schaden entsteht erst beim NAECHSTEN fremden Edit.
//   2. Wo doch weitergerechnet wird, geschieht es mit zwei getrennten
//      `CrdtManager` (`guid-incarnation-merge.test.ts:109-111`) — deren
//      Delete-Sets koennen die Items der Gegenseite per Konstruktion nie treffen.
//   3. Sie arbeiten mit ein bis drei verschiedenen, nicht-leeren Zeilen: keine
//      Leerzeile, keine wiederholte Zeile, kein Fall mit mehr als zwei Geraeten.
// `erstkontakt-duplikat.test.ts:102` PINNT die Verdopplung sogar
// (`toBe(2)`), statt sie zu verbieten — sie ist dort Befund, hier Traeger.
//
// Die Tests unten pinnen die Verdopplung NICHT. Sie halten nur fest, dass der
// lokale Beitrag den Delete UEBERLEBT (`toBeGreaterThanOrEqual`); wer die
// Verdopplung eines Tages sauber loest, ohne die Urheberschaft aufzugeben, darf
// hier gruen bleiben.

const NL = String.fromCharCode(10);
const PFAD = 'n.md';

// Zeilen ohne den Abschluss-Umbruch: `"a\n".split("\n")` haette sonst eine
// Phantom-Leerzeile am Ende, und die Leerzeilen-Zusicherung unten zaehlte sie mit.
const zeilen = (text: string): string[] =>
  (text.endsWith(NL) ? text.slice(0, -1) : text).split(NL);

const zaehle = (text: string, zeile: string): number =>
  zeilen(text).filter((z) => z === zeile).length;

// Der Inkarnationswechsel auf CRDT-Ebene, Schritt fuer Schritt aus
// `sync-handler.ts:1397-1454`: lokalen Stand sichern, eigene Historie verwerfen,
// Gewinner-State einspielen, Vereinigung materialisieren. Was hier fehlt (GUID-
// Buchfuehrung, Pfad-Historie, mehrere Sidecars) beruehrt die Op-Folge nicht —
// gemessen wird genau die eine Zeile, an der der Schaden haengt.
function wechselAufGewinner(
  m: CrdtManager,
  gewinnerState: Uint8Array,
  localText: string
): void {
  m.disposeDoc(PFAD);
  m.applyUpdate(PFAD, gewinnerState);
  const winnerText = m.getContent(PFAD);
  // Das Hash-Gate aus `:1443-1444`: identische Staende brauchen keine eigene Op.
  if (winnerText === localText) return;
  m.setContent(PFAD, unionMerge(winnerText, localText));
}

// Vollstaendiger Austausch: jedes Geraet sieht den Stand jedes anderen. Die
// Staende werden VORHER eingesammelt, damit keiner den frisch gemergten Stand
// eines anderen als „schon gesehen" mitbekommt.
//
// Konvergenz ist hier KEIN Erfolgsmass — der stille Verlust ist konvergent. Sie
// ist nur die Vorbedingung dafuer, dass ein einzelner Endtext ueberhaupt etwas
// ueber alle Geraete aussagt.
function abgleich(...manager: CrdtManager[]): string {
  const staende = manager.map((m) => m.encodeState(PFAD));
  for (const m of manager) for (const s of staende) m.applyUpdate(PFAD, s);
  const erster = manager[0].getContent(PFAD);
  for (const m of manager) expect(m.getContent(PFAD)).toBe(erster);
  return erster;
}

// Ein Geraet mit eigener, spaeter verworfener Inkarnation.
function geraetMit(text: string): CrdtManager {
  const m = new CrdtManager();
  m.setContent(PFAD, text);
  return m;
}

// --- Grundfall ---------------------------------------------------------------
// Die Lage aus `probe-aliasing.mjs`: der Gewinner traegt `b3` an anderer Stelle
// als der lokale Stand. Die Vereinigung setzt es deshalb ZWEIMAL — und nur das
// zweite Vorkommen gehoert dem Verlierer-Geraet.

const W_GRUND = 'b0\nb3\nb2\n';
const L_GRUND = 'b0\nb1\nA1\nb2\nb3\n';

describe('Inkarnationswechsel: der lokale Beitrag haengt an EIGENEN Items', () => {
  it('ueberlebt einen Delete, den der Gewinner offline auf seiner Zeile faehrt', () => {
    const gewinner = geraetMit(W_GRUND);
    const verlierer = geraetMit('vorherige Inkarnation\n');
    wechselAufGewinner(verlierer, gewinner.encodeState(PFAD), L_GRUND);

    // Der Gewinner hat den Wechsel nie gesehen und loescht seine EIGENE b3-Zeile
    // — ein gewoehnlicher Edit, der mit dem lokalen Stand nichts zu tun hat.
    // Diese Reihenfolge ist die schaerfste: sein Doc traegt `b3` genau einmal,
    // der Delete trifft also unzweideutig sein Item.
    gewinner.setContent(PFAD, 'b0\nb2\n');

    const erg = abgleich(verlierer, gewinner);
    // RED unter einem zeilenweisen Gate: `b3` steht dann nur noch als
    // Gewinner-Item da und faellt mit ihm.
    expect(zaehle(erg, 'b3')).toBeGreaterThanOrEqual(1);
    for (const z of zeilen(L_GRUND)) expect(zeilen(erg)).toContain(z);
  });

  it('ueberlebt denselben Delete, wenn der Gewinner den Wechsel vorher gesehen hat', () => {
    const gewinner = geraetMit(W_GRUND);
    const verlierer = geraetMit('vorherige Inkarnation\n');
    wechselAufGewinner(verlierer, gewinner.encodeState(PFAD), L_GRUND);
    gewinner.applyUpdate(PFAD, verlierer.encodeState(PFAD));

    // Jetzt steht `b3` zweimal in der Note. Der Nutzer am Gewinner-Geraet
    // loescht das OBERE — die Zeile, die aus seiner eigenen Historie stammt.
    const sicht = zeilen(gewinner.getContent(PFAD));
    expect(sicht[1]).toBe('b3');
    sicht.splice(1, 1);
    gewinner.setContent(PFAD, sicht.join(NL) + NL);

    const erg = abgleich(verlierer, gewinner);
    expect(zaehle(erg, 'b3')).toBeGreaterThanOrEqual(1);
    for (const z of zeilen(L_GRUND)) expect(zeilen(erg)).toContain(z);
  });

  // --- Geteilte Verlierer-Inkarnation ---------------------------------------
  // Der Normalzustand eines konvergierten Paars: beide Geraete tragen DIESELBE
  // Verlierer-Inkarnation, aufgebaut aus DEMSELBEN Update — also mit identischen
  // Item-IDs. Genau diese Lage stellt `mergeCompatible` (`:1361-1364`) her, und
  // genau sie verfehlen die bestehenden Tests, weil sie je zwei frische
  // `CrdtManager` bauen (`guid-incarnation-merge.test.ts:109-111`): deren
  // Delete-Sets koennen die Items der Gegenseite nie treffen.
  it('geteilte Verlierer-Inkarnation: beide Geraete behalten ihren Beitrag', () => {
    const quelle = geraetMit(L_GRUND);
    const saat = quelle.encodeState(PFAD);

    const eins = new CrdtManager();
    eins.applyUpdate(PFAD, saat);
    const zwei = new CrdtManager();
    zwei.applyUpdate(PFAD, saat);
    // Vorbedingung: identische Items, nicht nur identischer Text.
    expect(eins.getContent(PFAD)).toBe(L_GRUND);
    expect(zwei.getContent(PFAD)).toBe(L_GRUND);

    const gewinner = geraetMit(W_GRUND);
    const gewinnerState = gewinner.encodeState(PFAD);
    wechselAufGewinner(eins, gewinnerState, L_GRUND);
    wechselAufGewinner(zwei, gewinnerState, L_GRUND);

    // Erst laufen alle drei zusammen, dann loescht der Gewinner seine b3-Zeile.
    const vor = abgleich(eins, zwei, gewinner);
    const sicht = zeilen(vor);
    expect(sicht[1]).toBe('b3');
    sicht.splice(1, 1);
    gewinner.setContent(PFAD, sicht.join(NL) + NL);

    const erg = abgleich(eins, zwei, gewinner);
    expect(zaehle(erg, 'b3')).toBeGreaterThanOrEqual(1);
    // Die rein lokalen Zeilen ebenso: sie haengen an denselben Ops.
    for (const z of ['b0', 'b1', 'A1', 'b2']) expect(zaehle(erg, z)).toBeGreaterThanOrEqual(1);
  });
});

// --- Wiederholte Zeilen ------------------------------------------------------
// Leerzeile, `---`, zweimal derselbe Text: in Markdown der Normalfall, und der
// Ausschlussgrund frueherer Gate-Kandidaten („frisst legitime Wiederholungen").
// Ein Gate, das nach Zeileninhalt entscheidet, kann eine Wiederholung nicht von
// einer Verdopplung unterscheiden — es streicht sie schon beim Materialisieren,
// noch bevor irgendein Delete faellt.

const W_WIED = ['# N', '', 'w1', '---'].join(NL) + NL;
const L_WIED = ['# N', '', 'l1', '', 'l2', '---', '', '---'].join(NL) + NL;

describe('Inkarnationswechsel: wiederholte Zeilen', () => {
  it('materialisiert jede Wiederholung des lokalen Standes', () => {
    const gewinner = geraetMit(W_WIED);
    const verlierer = geraetMit('vorherige Inkarnation\n');
    wechselAufGewinner(verlierer, gewinner.encodeState(PFAD), L_WIED);

    const nach = verlierer.getContent(PFAD);
    // Der lokale Stand hat zwei `---` und drei Leerzeilen. Keine davon darf
    // unterwegs verschwinden, nur weil der Gewinner-Doc dieselbe Zeile kennt.
    expect(zaehle(nach, '---')).toBeGreaterThanOrEqual(zaehle(L_WIED, '---'));
    expect(zaehle(nach, '')).toBeGreaterThanOrEqual(zaehle(L_WIED, ''));
    for (const z of ['l1', 'l2', '# N']) expect(zaehle(nach, z)).toBeGreaterThanOrEqual(1);
  });

  it('haelt eine Wiederholung, wenn der Gewinner seine gleichlautende Zeile loescht', () => {
    const gewinner = geraetMit(W_WIED);
    const verlierer = geraetMit('vorherige Inkarnation\n');
    wechselAufGewinner(verlierer, gewinner.encodeState(PFAD), L_WIED);
    gewinner.applyUpdate(PFAD, verlierer.encodeState(PFAD));

    // Der Gewinner loescht das `---`, das aus SEINER Historie stammt — das
    // erste in der zusammengelegten Note.
    const sicht = zeilen(gewinner.getContent(PFAD));
    const i = sicht.indexOf('---');
    expect(i).toBeGreaterThanOrEqual(0);
    sicht.splice(i, 1);
    gewinner.setContent(PFAD, sicht.join(NL) + NL);

    const erg = abgleich(verlierer, gewinner);
    // RED unter einem zeilenweisen Gate: dort ist nach dem Wechsel nur EIN `---`
    // uebrig, es gehoert dem Gewinner, und dieser Delete raeumt es mit weg.
    expect(zaehle(erg, '---')).toBeGreaterThanOrEqual(1);
    expect(zaehle(erg, '')).toBeGreaterThanOrEqual(1);
    for (const z of ['l1', 'l2']) expect(zaehle(erg, z)).toBeGreaterThanOrEqual(1);
  });
});

// --- Gegenprobe zum Instrument ----------------------------------------------
// Die Tests oben pruefen Zeilen-ZAEHLUNGEN. Diese Gegenprobe belegt, dass die
// Zaehlung ueberhaupt an Yjs-Items haengt und nicht bloss an Text: derselbe
// Delete auf einem Doc, in dem der lokale Beitrag KEIN eigenes Item hat (der
// Verlierer hat gar nichts beigetragen), nimmt die Zeile erwartungsgemaess mit.
// Waere die Zusicherung blind, meldete sie auch hier gruen.

describe('Gegenprobe: ohne eigene Op gibt es nichts zu erhalten', () => {
  it('ein Delete des Gewinners nimmt die Zeile mit, wenn nur er sie traegt', () => {
    const gewinner = geraetMit(W_GRUND);
    const verlierer = geraetMit('vorherige Inkarnation\n');
    // Der lokale Stand ist hier eine Teilmenge ohne eigenes `b3`.
    wechselAufGewinner(verlierer, gewinner.encodeState(PFAD), 'b0\nb2\n');
    expect(zaehle(verlierer.getContent(PFAD), 'b3')).toBe(1);

    gewinner.setContent(PFAD, 'b0\nb2\n');
    const erg = abgleich(verlierer, gewinner);
    expect(zaehle(erg, 'b3')).toBe(0);
  });
});

// Nur damit die Yjs-Abhaengigkeit auch als solche im Bild ist: die Staende, die
// oben ausgetauscht werden, sind gewoehnliche Yjs-Updates. Ein dritter,
// unbeteiligter Doc kommt auf denselben Text — der Verlust waere also nicht auf
// den CrdtManager beschraenkt.
describe('Inkarnationswechsel: derselbe Befund an rohem Yjs', () => {
  it('ein unbeteiligter Doc sieht denselben Endstand', () => {
    const gewinner = geraetMit(W_GRUND);
    const verlierer = geraetMit('vorherige Inkarnation\n');
    wechselAufGewinner(verlierer, gewinner.encodeState(PFAD), L_GRUND);
    gewinner.setContent(PFAD, 'b0\nb2\n');

    const dritter = new Y.Doc();
    Y.applyUpdate(dritter, verlierer.encodeState(PFAD));
    Y.applyUpdate(dritter, gewinner.encodeState(PFAD));
    const roh = dritter.getText('content').toString();

    expect(zaehle(roh, 'b3')).toBeGreaterThanOrEqual(1);
    expect(roh).toBe(abgleich(verlierer, gewinner));
  });
});
