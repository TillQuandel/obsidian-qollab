import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import { makeVaultMock, tippeMd, toArrayBuffer as toAB } from './helpers/vault-mock';

// Der Waechter fuer die eine Zusage, die der Inkarnationswechsel schuldig ist:
//
//   NACH EINEM WECHSEL UEBERLEBT DER LOKALE BEITRAG EINEN SPAETEREN FREMDEN EDIT —
//   AUCH DANN, WENN BEIDE VERLIERER-GERAETE DIESELBE INKARNATION GETEILT HABEN.
//
// `switchToGuid` (`src/sync-handler.ts:1375-1455`) verwirft die eigene Historie,
// baut den Gewinner-Doc auf und materialisiert die Vereinigung per `setContent`
// (`:1454`). Dabei entstehen Duplikate: eine Zeile, die der Gewinner-Doc schon
// traegt, wird als frische Op DIESES Geraets ein zweites Mal geschrieben. Das
// sieht nach ueberfluessiger Arbeit aus, und der naheliegende Eingriff ist ein
// zeilenweises Gate, das genau diese Zeilen weglaesst.
//
// DIESES GATE IST GEMESSEN GEFALLEN, an K.o.-Kriterium 1 aus `docs/produktziel.md`
// („Grundtext darf nie zerstoert werden"). Laesst man die lokale Zeile weg, WEIL
// der Gewinner dafuer ein Item hat, haengt der eigene Beitrag danach an einem
// FREMDEN Item. Ab da toetet ihn jeder gewoehnliche Delete auf dem
// Gewinner-Geraet — einer, der mit dem lokalen Inhalt nie etwas zu tun hatte.
// Yjs loescht monoton und propagiert auf alle Geraete; der Endstand bleibt
// konvergent, der Verlust ist also STILL („Divergenz 0" ist kein Erfolgsmass,
// `docs/produktziel.md`, Missverstaendnis-Tabelle). Die Verdopplung ist damit
// nicht der Fehler, sondern der TRAEGER der lokalen Urheberschaft: das zweite
// Vorkommen ist die einzige Kopie, die dem Verlierer-Geraet gehoert.
//
// WARUM DIESE DATEI NEBEN DEN VORHANDENEN STEHT. Die Tests, die `switchToGuid`
// heute erreichen, koennen diese Falle aus drei Gruenden nicht fangen:
//   1. Sie hoeren nach dem Wechsel auf. `guid-incarnation-merge.test.ts:47-52`
//      prueft `merged` unmittelbar nach `loadAndMerge`. Der Schaden entsteht aber
//      erst beim NAECHSTEN fremden Edit — deshalb laeuft hier Schritt (6).
//   2. Sie stellen die Gegenseite aus einem FRISCHEN `CrdtManager` nach
//      (`guid-incarnation-merge.test.ts:109-111`). Damit koennen Delete-Sets die
//      Items der anderen Seite per Konstruktion nie treffen — ein gruener
//      Waechter ueber einer gebrochenen Zusage. Hier baut Geraet B seinen Doc
//      ueber `ensureDoc`/`mergeCompatible` (`src/sync-handler.ts:1361-1364`) aus
//      A's Update auf; die Verlierer-Kette ist real GETEILT (erster Test unten).
//   3. Sie arbeiten mit ein bis drei verschiedenen, nicht-leeren Zeilen. Hier
//      stehen eine Leerzeile und eine Zeile, die BEIDE Ketten tragen — genau die
//      Form, an der das Gate aliasiert.
// Und `erstkontakt-duplikat.test.ts:102` PINNT den Schaden (`toBe(2)`), statt ihn
// zu verbieten; hier wird deshalb nirgends auf eine Vorkommenszahl festgenagelt.
//
// KALIBRIERT: Gegen eine Kopie von `switchToGuid` mit dem zeilenweisen Gate
// (ausserhalb des Repos) faellt die Zusage von „beidseits" 2 auf 0 — auf beiden
// Verlierer-Geraeten, ohne dass der Merge selbst etwas vermissen liesse.
//
// GRENZE DIESER DATEI, ausdruecklich — die Ueberschrift oben gilt NICHT allgemein.
// Sie gilt fuer Zeilen, die die Vereinigung zu ZWEI Vorkommen fuehrt (hier:
// „beidseits", in beiden Ketten an VERSCHIEDENEN Stellen). Steht eine Zeile auf
// beiden Seiten an DERSELBEN Stelle, erkennt `unionMerge` sie als gleich und
// erzeugt kein zweites Item — dann hat das Verlierer-Geraet keine eigene Kopie,
// und ein Delete des Gewinners nimmt sie mit. Das ist KEINE Folge des Gates,
// sondern steht bereits im heutigen Stand; nachgewiesen harness-frei in
// `spike/gate-widerlegung/probe-head-aliasing.mjs`:
//
//   winner "# Notiz / nur auf C / gemeinsam"   local "# Notiz / nur auf A / gemeinsam"
//   -> Vereinigung traegt „gemeinsam" EINMAL -> Gewinner loescht es -> weg
//
// Dieser Test waehlt mit „beidseits" bewusst das Loeschziel, unter dem der
// heutige Stand durchkommt. Er bewacht damit die Wirkung des Gates, NICHT die
// Abwesenheit der Aliasierung ueberhaupt. Wer die allgemeine Zusage will, muss
// zuerst den Fall „gleiche Zeile, gleiche Stelle" loesen — er ist offen.

const NOTE = 'note.md';
const A_YJS = '.qollab/note.md.aaaa1111.yjs';
const B_YJS = '.qollab/note.md.bbbb2222.yjs';
const C_YJS = '.qollab/note.md.cccc3333.yjs';
const G_GEWINNT = '00000000000000000000000000000000'; // gewinnt den Tie-Break
const G_VERLIERT = 'ffffffffffffffffffffffffffffffff'; // verliert ihn

// „beidseits" steht in BEIDEN Ketten, aber an verschiedenen Stellen: auf dem
// Gewinner oben, auf den Verlierern unten. Das ist die Form, die die Vereinigung
// zu zwei Vorkommen fuehrt — und damit die einzige, in der das Gate ueberhaupt
// etwas wegzulassen haette. „gemeinsam" steht auf beiden Seiten an derselben
// Stelle, „nur auf A 1/2" nur bei den Verlierern.
const GEWINNER_TEXT = '# Notiz\n\nbeidseits\ngemeinsam\n';
const LOKAL_TEXT = '# Notiz\n\nnur auf A 1\nnur auf A 2\ngemeinsam\nbeidseits\n';

// Hilfsdatei mit GUID-Kopf und dem State eines Docs mit `text`.
function schreibeSidecar(vault: any, path: string, guid: string, text: string): void {
  const m = new CrdtManager();
  m.setContent(NOTE, text);
  vault._files.set(path, toAB(encodeStateFile(guid, m.encodeState(NOTE))));
}

const zaehleZeile = (text: string, zeile: string): number =>
  text.split('\n').filter((z) => z === zeile).length;

interface Geraet {
  vault: any;
  crdt: CrdtManager;
  handler: SyncHandler;
  pfad: string;
}

// Ein Geraet = eigener Vault-Ordner, eigener CrdtManager (eigene Yjs-clientID),
// eigener Handler. Was die Geraete verbindet, ist ausschliesslich der Datei-Sync
// unten — nie ein geteiltes Objekt im Speicher.
function geraet(clientId: string, pfad: string): Geraet {
  const vault = makeVaultMock() as any;
  const crdt = new CrdtManager();
  return { vault, crdt, handler: new SyncHandler(vault, crdt, clientId), pfad };
}

// Der 30-s-Poll eines Geraets, inklusive Write-Back — dasselbe Paar, das
// `main.ts:1436` (`loadAndMerge`), `:1471-1479` (`.md` schreiben) und `:1488`
// (`noteLocalDiffBase`) bilden. Ohne den Write-Back stuende die `.md` nach dem
// Wechsel auf dem Vor-Merge-Stand und der naechste lokale Diff liefe gegen eine
// falsche Basis; die Lage waere dann nicht die, die im Feld entsteht.
async function poll(g: Geraet): Promise<void> {
  const merged = await g.handler.loadAndMerge(NOTE);
  if (merged === null) return;
  await tippeMd(g.vault, NOTE, merged);
  g.handler.noteLocalDiffBase(NOTE, merged);
}

// Der Datei-Sync stellt die Hilfsdatei EINES Geraets bei einem anderen zu.
const liefere = (von: Geraet, nach: Geraet): void => {
  nach.vault._files.set(von.pfad, von.vault._files.get(von.pfad)!.slice(0));
};

// Die Ausgangslage: A und B teilen die Verlierer-Inkarnation, C traegt die
// Gewinnerin. Der Weg dorthin ist der reale — kein Handaufbau der Docs.
async function baueLage(): Promise<{ A: Geraet; B: Geraet; C: Geraet }> {
  const A = geraet('aaaa1111', A_YJS);
  const B = geraet('bbbb2222', B_YJS);
  const C = geraet('cccc3333', C_YJS);

  // (1) A praegt die spaetere Verlierer-Inkarnation.
  schreibeSidecar(A.vault, A_YJS, G_VERLIERT, LOKAL_TEXT);
  A.vault._textFiles.set(NOTE, LOKAL_TEXT);
  await poll(A);

  // (2) Der Datei-Sync traegt A's Hilfsdatei und A's `.md` zu B. B hat keinen
  //     eigenen Stand, adoptiert also A's Inkarnation und wendet A's Update an.
  //     AB HIER TRAEGT B'S DOC A'S ITEM-IDs — das ist der Normalzustand jedes
  //     konvergierten Paars, und die Lage, die die vorhandenen Tests mit zwei
  //     getrennten `CrdtManager`-Instanzen gerade NICHT herstellen.
  liefere(A, B);
  B.vault._textFiles.set(NOTE, LOKAL_TEXT);
  await poll(B);

  // (3) C hat unabhaengig die Gewinner-Inkarnation gepraegt (kleinere GUID).
  schreibeSidecar(C.vault, C_YJS, G_GEWINNT, GEWINNER_TEXT);
  C.vault._textFiles.set(NOTE, GEWINNER_TEXT);
  await poll(C);

  return { A, B, C };
}

describe('Geteilte Verlierer-Inkarnation', () => {
  // Vorbedingung dieser Datei, als eigener Test, damit ihr Wegbrechen auffaellt
  // statt den Waechter unten still zu entwerten: Wenn A und B nicht wirklich
  // dieselbe Op-Kette tragen, prueft der zweite Test eine andere Lage als die,
  // die er zu pruefen behauptet.
  it('A und B tragen nach dem Adoptieren dieselbe Op-Kette, nicht zwei gleiche Texte', async () => {
    const { A, B } = await baueLage();

    expect(await A.handler.currentGuid(NOTE)).toBe(G_VERLIERT);
    expect(await B.handler.currentGuid(NOTE)).toBe(G_VERLIERT);

    // Der Nachweis liegt im Merge, nicht im Text: Yjs dedupliziert nach Item-ID,
    // nicht nach Inhalt. Waeren es zwei unabhaengig materialisierte Ketten
    // desselben Textes, stuende hier jede Zeile doppelt (genau der Befund aus
    // `erstkontakt-duplikat.test.ts`). Dass nichts doppelt steht, BELEGT die
    // gemeinsame Herkunft der Items.
    const beide = new CrdtManager();
    beide.applyUpdate(NOTE, decodeStateFile(new Uint8Array(A.vault._files.get(A_YJS)!)).update);
    beide.applyUpdate(NOTE, decodeStateFile(new Uint8Array(B.vault._files.get(B_YJS)!)).update);
    expect(beide.getContent(NOTE)).toBe(LOKAL_TEXT);
  });

  it('nach dem Wechsel ueberlebt der lokale Beitrag einen spaeteren Gewinner-Edit', async () => {
    const { A, B, C } = await baueLage();

    // (4) Die Gewinner-Hilfsdatei erreicht beide Verlierer. Beide laufen ueber
    //     `src/sync-handler.ts:1942-1944` in `switchToGuid`.
    liefere(C, A);
    liefere(C, B);
    await poll(A);
    await poll(B);
    expect(await A.handler.currentGuid(NOTE)).toBe(G_GEWINNT);
    expect(await B.handler.currentGuid(NOTE)).toBe(G_GEWINNT);

    // Der Wechsel selbst laesst nichts vermissen — und genau deshalb faellt ein
    // Gate hier nicht auf. Der Schaden wird erst in (7) sichtbar.
    for (const zeile of ['# Notiz', 'nur auf A 1', 'nur auf A 2', 'gemeinsam', 'beidseits']) {
      expect(A.crdt.getContent(NOTE)).toContain(zeile);
      expect(B.crdt.getContent(NOTE)).toContain(zeile);
    }

    // (5) Vollvermaschte Zustellung, bis alle drei denselben Stand haben. A und B
    //     schicken sich dabei GEGENSEITIG ihre Nach-Wechsel-Hilfsdatei zu — der
    //     Weg, auf dem ein Update mit einem Delete-Set ueber die geteilte
    //     Verlierer-Kette beim jeweils anderen genau die Items abraeumen wuerde,
    //     die im Gewinner-Doc leben.
    liefere(A, B);
    liefere(B, A);
    liefere(A, C);
    liefere(B, C);
    await poll(A);
    await poll(B);
    await poll(C);
    expect(A.crdt.getContent(NOTE)).toBe(C.crdt.getContent(NOTE));
    expect(B.crdt.getContent(NOTE)).toBe(C.crdt.getContent(NOTE));

    // (6) DER SPAETERE FREMDE EDIT. Auf C loescht der Nutzer EIN Vorkommen von
    //     „beidseits" — ein voellig gewoehnlicher Tastendruck auf dem Geraet, das
    //     den Tie-Break gewonnen hat. Welches Vorkommen die `.md` verliert,
    //     entscheidet der Text, nicht der Test: `indexOf` nimmt das erste, und
    //     das ist unter jeder Fassung von `switchToGuid` C's eigenes.
    const vorEdit = zaehleZeile(C.crdt.getContent(NOTE), 'beidseits');
    const zeilen = C.crdt.getContent(NOTE).split('\n');
    zeilen.splice(zeilen.indexOf('beidseits'), 1);
    const nachEdit = zeilen.join('\n');
    await tippeMd(C.vault, NOTE, nachEdit);
    await C.handler.applyLocalContent(NOTE, nachEdit);

    // Der Edit hat gewirkt — sonst waere die Zusage unten blind gruen.
    expect(zaehleZeile(C.crdt.getContent(NOTE), 'beidseits')).toBe(vorEdit - 1);

    // (7) Die Loeschung erreicht die beiden Verlierer.
    liefere(C, A);
    liefere(C, B);
    await poll(A);
    await poll(B);

    // DIE ZUSAGE. C hat GENAU EIN Vorkommen geloescht; A und B haben nie eines
    // geloescht. Also muss auf beiden eines stehen bleiben. Bewusst keine feste
    // Zahl: wie viele Kopien die Vereinigung erzeugt, darf sich aendern — dass
    // der eigene Beitrag eine EIGENE, nicht fremdbestimmte Kopie hat, nicht.
    expect(zaehleZeile(A.crdt.getContent(NOTE), 'beidseits')).toBeGreaterThanOrEqual(1);
    expect(zaehleZeile(B.crdt.getContent(NOTE), 'beidseits')).toBeGreaterThanOrEqual(1);

    // K.o.-Kriterium 1 fuer den Rest des Grundtexts, auf allen drei Geraeten.
    // Diese Zeilen sind der Messpunkt fuer die zweite Schadensrichtung: ein
    // Entwurf, der den lokalen Beitrag als Yjs-Update statt als Text uebertraegt,
    // schickt mit ihm ein Delete-Set ueber die GETEILTE Verlierer-Kette. Gegen
    // eine solche Fassung ist hier NICHT kalibriert — kalibriert ist das
    // zeilenweise Gate, das die Zusage oben bricht.
    for (const g of [A, B, C]) {
      for (const zeile of ['# Notiz', 'nur auf A 1', 'nur auf A 2', 'gemeinsam']) {
        expect(zaehleZeile(g.crdt.getContent(NOTE), zeile)).toBeGreaterThanOrEqual(1);
      }
    }

    // Und der Stand ist auf allen dreien derselbe: die Zusage wird nicht mit
    // Divergenz erkauft.
    expect(A.crdt.getContent(NOTE)).toBe(C.crdt.getContent(NOTE));
    expect(B.crdt.getContent(NOTE)).toBe(C.crdt.getContent(NOTE));
  });
});
