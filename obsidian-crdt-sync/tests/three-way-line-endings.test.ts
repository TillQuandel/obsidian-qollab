import { threeWayMerge, unionMerge } from '../src/text-merge';

// Zeilenenden und BOM beim 3-Wege-Merge
//
// `unionMerge` ist gegen CRLF/LF/BOM gehaertet (siehe line-endings-bom.test.ts).
// `threeWayMerge` hat dieselbe Blindheit, mit milderem Schaden: `patch_make`
// diffft zeichenweise, ein `\r` ist dabei ein Zeichen wie jedes andere. Steht
// der lokale Stand auf LF und der fremde auf CRLF, wird die lokale Zeile MIT
// ihrem LF in eine CRLF-Datei eingesetzt — das Ergebnis ist GEMISCHT und wandert
// ueber den Datei-Sync auf beide Geraete.
//
// Warum das mehr als Kosmetik ist: der zeichenweise Diff in crdt-manager.ts
// erzeugt bei einem Zeilenende-Wechsel Operationen ueber die ganze Datei, und
// Werkzeuge, die auf Zeilenenden achten (Git mit core.autocrlf, Linter), sehen
// Aenderungen, die inhaltlich keine sind.
//
// Zusage nach dem Fix (wie bei unionMerge): verglichen wird ohne Ruecksicht auf
// Zeilenende-Schreibweise und fuehrendes BOM, ausgegeben wird durchgaengig in
// den Zeilenenden des LOKALEN Standes; ein lokales BOM bleibt vorne. Die alten
// Zusagen bleiben: die lokale Aenderung landet vollstaendig auf dem fremden
// Stand, kein Text geht verloren.

const BOM = '\uFEFF';

// REIHENFOLGE, geaendert am 2026-08-11 mit dem Wechsel auf den zeilenweisen
// 3-Wege-Merge: Wo `local` und `other` unabhaengig an DERSELBEN Stelle etwas
// einfuegen, steht jetzt der fremde Beitrag vor dem lokalen (vorher umgekehrt).
// Beide ueberleben vollstaendig -- nur die Anordnung hat sich gedreht.
//
// Kein Verlust und keine Regression: Zwei nebenlaeufige Einfuegungen an
// derselben Position haben keine kanonische Reihenfolge; der neue Merge legt
// sie bewusst fest (sortiert), damit ALLE Geraete dasselbe Ergebnis rechnen.
// Der README fuehrt das ohnehin als bekannte Eigenschaft ("Both versions
// survive, but the resulting order can look odd"). Die Zusagen dieser Datei --
// nichts geht verloren, kein gemischtes Zeilenende, ein lokales BOM bleibt
// vorne -- sind unveraendert und werden weiterhin geprueft.

const zaehle = (text: string, teil: string) => text.split(teil).length - 1;
// Ein einzelnes LF ohne vorangehendes CR — der Nachweis fuer „nicht gemischt".
const hatNacktesLf = (text: string) => /(^|[^\r])\n/.test(text);

// Die exakten Erwartungen unten sind KEINE Rueckschau auf den Fix: sie sind mit
// der unveraenderten Implementierung auf den LF-Fassungen derselben Fixtures
// gemessen (patch_make/patch_apply, siehe Messwerte im Commit-Text). Genau das
// ist die Zusage — Zeilenende-Schreibweise und BOM duerfen das Ergebnis nicht
// beeinflussen, nur seine Ausgabeform.

describe('threeWayMerge — CRLF gegen LF', () => {
  it('setzt die lokale Zeile nicht mit LF in eine CRLF-Datei', () => {
    const base = '# Titel\nText.\n';
    const local = '# Titel\nText.\nLokal.\n';
    const other = '# Titel\r\nText.\r\nFremd.\r\n';
    const merged = threeWayMerge(base, local, other);

    // Gemessener Schaden: '# Titel\r\nText.\r\nLokal.\nFremd.\r\n' — ein nacktes
    // LF mitten in einer sonst durchgaengigen CRLF-Datei.
    expect(zaehle(merged, 'Lokal.')).toBe(1);
    expect(zaehle(merged, 'Fremd.')).toBe(1);
    // Der lokale Stand ist reines LF -> das Ergebnis auch, kein einziges CR.
    expect(merged.includes('\r')).toBe(false);
    expect(merged).toBe('# Titel\nText.\nFremd.\nLokal.\n');
  });

  it('spiegelbildlich: lokal CRLF, fremd LF', () => {
    const base = '# Titel\r\nText.\r\n';
    const local = '# Titel\r\nText.\r\nLokal.\r\n';
    const other = '# Titel\nText.\nFremd.\n';
    const merged = threeWayMerge(base, local, other);

    expect(zaehle(merged, 'Lokal.')).toBe(1);
    expect(zaehle(merged, 'Fremd.')).toBe(1);
    // Der lokale Stand ist durchgaengig CRLF -> das Ergebnis auch.
    expect(hatNacktesLf(merged)).toBe(false);
    expect(merged).toBe('# Titel\r\nText.\r\nFremd.\r\nLokal.\r\n');
  });

  it('reine Zeilenende-Differenz ohne lokale Aenderung schreibt die Datei nicht um', () => {
    // Kein lokaler Edit (base === local), der fremde Stand ist derselbe Text in
    // CRLF. Zu mergen gibt es nichts — der lokale Stand muss byteweise stehen
    // bleiben, statt die ganze Datei auf CRLF zu kippen.
    const local = '# Titel\nText.\nEnde.\n';
    const other = '# Titel\r\nText.\r\nEnde.\r\n';
    expect(threeWayMerge(local, local, other)).toBe(local);
  });

  it('Verlustfreiheit trotz gegenlaeufiger Zeilenenden', () => {
    const base = 'kopf\nfuss\n';
    const local = 'kopf\nnur lokal\nfuss\n';
    const other = 'kopf\r\nnur fremd\r\nfuss\r\n';
    const merged = threeWayMerge(base, local, other);

    expect(merged).toContain('nur lokal');
    expect(merged).toContain('nur fremd');
    expect(merged.includes('\r')).toBe(false);
    expect(merged).toBe('kopf\nnur fremd\nnur lokal\nfuss\n');
  });

  it('gemischter lokaler Stand wird auf ein Zeilenende vereinheitlicht', () => {
    // Bewusster Unterschied zu unionMerge: dort gehen lokale Zeilen byteweise
    // durch, hier arbeitet der Patch ZEICHENweise (auch innerhalb einer Zeile),
    // eine zeilengenaue Rueckabbildung auf die Original-Bytes gibt es nicht.
    // Vorrang hat deshalb die Zusage „kein gemischtes Ergebnis"; ein bereits
    // gemischter lokaler Stand wird dabei auf sein vorherrschendes CRLF gezogen.
    const base = 'a\nb\r\nc\n';
    const local = 'a\nb\r\nc\nLokal\n';
    const other = 'a\nb\r\nc\nFremd\r\n';
    const merged = threeWayMerge(base, local, other);

    expect(merged).toContain('Lokal');
    expect(merged).toContain('Fremd');
    expect(hatNacktesLf(merged)).toBe(false);
    expect(merged).toBe('a\r\nb\r\nc\r\nFremd\r\nLokal\r\n');
  });
});

// Doppeltes CR vor dem Zeilenende ('\r\r\n', Herkunft siehe
// line-endings-bom.test.ts): die Normalisierung `replace(/\r\n/g, '\n')`
// ersetzt nicht ueberlappend und laesst ein '\r\n' stehen. Fuer den 3-Wege-Merge
// ist das schlimmer als fuer die Union — `patch_apply` findet den Kontext des
// lokalen Hunks nicht wieder und verwirft ihn STILL. Die lokale Aenderung ist
// dann weg, ohne Meldung, auf beiden Geraeten.
describe('threeWayMerge — doppeltes CR vor dem Zeilenende', () => {
  it('verschluckt die lokale Aenderung nicht, wenn der fremde Stand doppelte CR hat', () => {
    const base = '# Titel\nA\nB\n';
    const local = '# Titel\nA\nB\nLOKAL\n';
    const other = '# Titel\r\r\nA\r\r\nB\r\r\nFREMD\r\r\n';
    const merged = threeWayMerge(base, local, other);

    expect(zaehle(merged, 'LOKAL')).toBe(1);
    expect(zaehle(merged, 'FREMD')).toBe(1);
    // Der lokale Stand ist reines LF -> das Ergebnis auch.
    expect(merged.includes('\r')).toBe(false);
  });

  it('verschluckt die lokale Aenderung nicht, wenn der lokale Stand doppelte CR hat', () => {
    const base = '# Titel\r\r\nA\r\r\nB\r\r\n';
    const local = '# Titel\r\r\nA\r\r\nB\r\r\nLOKAL\r\r\n';
    const other = '# Titel\nA\nB\nFREMD\n';
    const merged = threeWayMerge(base, local, other);

    expect(zaehle(merged, 'LOKAL')).toBe(1);
    expect(zaehle(merged, 'FREMD')).toBe(1);
    expect(hatNacktesLf(merged)).toBe(false);
  });
});

describe('threeWayMerge — BOM', () => {
  it('haelt ein lokales BOM vorne, auch wenn der fremde Stand keines hat', () => {
    // Realer Weg: der Peer hat die Datei ueber ein Werkzeug ohne BOM geschrieben.
    // Das BOM steht in base UND local, taucht im Patch also gar nicht auf und
    // faellt ohne Zutun aus dem Ergebnis — die Datei beginnt danach ohne
    // Kodierungs-Kennzeichnung.
    const base = BOM + 'a\nb\n';
    const local = BOM + 'a\nb\nLokal\n';
    const other = 'a\nb\nFremd\n';
    const merged = threeWayMerge(base, local, other);

    expect(merged.indexOf(BOM)).toBe(0);
    expect(zaehle(merged, BOM)).toBe(1);
    expect(merged).toBe(BOM + 'a\nb\nFremd\nLokal\n');
  });

  it('erbt kein fremdes BOM, wenn der lokale Stand keines hat', () => {
    const base = 'a\nb\n';
    const local = 'a\nb\nLokal\n';
    const other = BOM + 'a\nb\nFremd\n';
    const merged = threeWayMerge(base, local, other);

    expect(merged.indexOf(BOM)).toBe(-1);
    expect(merged).toBe('a\nb\nFremd\nLokal\n');
  });

  it('schiebt ein BOM nie in die Dateimitte', () => {
    // Ein U+FEFF unmittelbar vor einem `#` macht aus der Ueberschrift nach
    // CommonMark einen Absatz.
    const base = '# Titel\n';
    const local = BOM + '# Titel\nLokal\n';
    const other = '# Titel\nFremd\n';
    const merged = threeWayMerge(base, local, other);

    expect(merged.indexOf(BOM)).toBe(0);
    expect(merged.slice(1).indexOf(BOM)).toBe(-1);
    expect(merged).toBe(BOM + '# Titel\nFremd\nLokal\n');
  });
});

describe('threeWayMerge — jenseits der Token-Grenze', () => {
  // diff_linesToChars_ fasst ab 40000 verschiedenen Zeilen den Rest zu EINEM
  // Token zusammen; unionMerge braucht dafuer einen Rueckfallzweig, weil es
  // Diff-Indizes zeilenweise zurueckbildet. threeWayMerge tut das nicht — der
  // Zeilen-Modus ist hier nur eine interne Beschleunigung von diff_main, das
  // Ergebnis bleibt ein Zeichen-Diff. Dieser Test haelt fest, dass die Grenze
  // hier keinen Sonderweg braucht.
  it('bleibt verlustfrei und liefert das lokale Zeilenende', () => {
    const basis = Array.from({ length: 41000 }, (_, i) => `Zeile ${i}`);
    const base = basis.join('\r\n') + '\r\n';
    const local = base + 'nur lokal\r\n';
    const other = basis.join('\n') + '\nnur fremd\n';
    const merged = threeWayMerge(base, local, other);

    const teile = merged.split('\r\n');
    expect(teile).toContain('Zeile 0');
    expect(teile).toContain('Zeile 40999');
    expect(teile).toContain('nur lokal');
    expect(teile).toContain('nur fremd');
    expect(hatNacktesLf(merged)).toBe(false);
  }, 60000);
});

describe('threeWayMerge — Kontrollen (muessen gruen bleiben)', () => {
  it('reines LF verhaelt sich wie bisher', () => {
    expect(threeWayMerge('a\n', 'a\nLokal\n', 'a\nFremd\n')).toBe('a\nFremd\nLokal\n');
    expect(threeWayMerge('', '', '')).toBe('');
    expect(threeWayMerge('a\n', 'a\n', 'b\n')).toBe('b\n');
  });

  it('ohne Fremd-Aenderung gewinnt der lokale Stand vollstaendig', () => {
    const base = 'a\nb\n';
    expect(threeWayMerge(base, 'a\nb\nLokal\n', base)).toBe('a\nb\nLokal\n');
  });

  it('beidseitig vorhandene Einfuegung steht genau einmal', () => {
    // Dieselbe Zusage wie erstkontakt-duplikat.test.ts (Task 18 / Q3). Bis zum
    // Wechsel auf den zeilenweisen 3-Wege-Merge stand hier `toBe(2)` — die
    // dokumentierte Schwaeche von `patch_apply`, das nicht dedupliziert. Sie ist
    // mit dem Verfahren entfallen, nicht mit einer zusaetzlichen Pruefung.
    expect(zaehle(threeWayMerge('a\n', 'a\nFREMD\n', 'a\nFREMD\n'), 'FREMD')).toBe(1);
  });
});

// ── OHNE abschliessendes Zeilenende ─────────────────────────────────────────
//
// Die Faelle oben enden ausnahmslos auf einem Zeilenumbruch — alle 26 Fixtures
// dieser Datei, nachgezaehlt. Genau der Fall, den `unionMerge`s eigener Kommentar
// „in Obsidian der Normalfall" nennt, war damit fuer `threeWayMerge` nicht
// abgedeckt, und dort sass ein Fehler.
//
// WAS PASSIERTE: `zeilenListe` schneidet eine Schlusszeile ohne `\n` ohne
// Trennzeichen ab, `dreiWegeZeilen` fuegt mit `join('')` zusammen — die naechste
// Zeile klebte an der Schlusszeile fest. `unionMerge` faengt das seit Review C-1
// mit `padLast` ab; beim Wechsel auf den zeilenweisen 3-Wege-Merge (2026-08-11)
// wurde dieselbe Behandlung nicht mitgezogen.
//
// AM PRODUKT GEMESSEN, nicht konstruiert: Die Realtests `r13-cdp-lokal` und
// `r14-cdp-lokal` (2026-08-13, zwei echte Obsidian-Instanzen) endeten mit
// `A2-<RunId>BBB-<RunId>` in einer Zeile — in `r13` in BEIDEN Vaults byte-gleich,
// also konvergent und damit still. Die Messpunkte unmittelbar davor waren sauber.
describe('threeWayMerge — Staende ohne abschliessendes Zeilenende', () => {
  it('klebt die naechste Zeile nicht an die Schlusszeile', () => {
    // Der gemessene Schaden vor dem Fix: 'a\nb\nXb\nY' — das `b` der Basis klebt
    // an der lokalen Ergaenzung `X` und wird dadurch ein zweites Mal gezaehlt.
    const merged = threeWayMerge('a\nb', 'a\nb\nX', 'a\nb\nY');
    expect(merged).toBe('a\nb\nX\nY');
    expect(zaehle(merged, 'b')).toBe(1);
  });

  it('erfindet kein Zeilenende, wenn keine Seite eines hatte', () => {
    // Gegenrichtung zum Test darueber: Der Fix haengt intern ein `\n` an; es darf
    // im Ergebnis nicht stehenbleiben, sonst schriebe jeder Merge die Datei um.
    expect(threeWayMerge('a\nb', 'a\nb\nX', 'a\nb\nY').endsWith('\n')).toBe(false);
    expect(threeWayMerge('a', 'a\nX', 'a')).toBe('a\nX');
  });

  it('laesst den lokalen Stand unveraendert, wenn die Gegenseite nichts geaendert hat', () => {
    // REGRESSION, gefunden bei der adversarialen Pruefung des Fixes (2026-08-13).
    // Die erste Fassung entfernte das angehaengte Zeilenende nur, wenn WEDER local
    // NOCH other eines hatte — und las `other` damit als Beitrag, auch wenn
    // `other === base`, die Gegenseite also gar nichts geaendert hat.
    //
    // Der Ausloeser ist der Alltagsfall: Die Datei endet auf einem Zeilenumbruch,
    // die Nutzerin setzt den Cursor ans Ende und tippt eine Zeile — Obsidian
    // schreibt dort keinen Umbruch. Ohne Remote-Aenderung ist `base === other`,
    // und der Merge haengte einen Umbruch an, den niemand getippt hat. Folge in
    // `sync-handler.ts:1847`: `merged !== content`, also Write-Back und eine
    // CRDT-Op fuer eine Aenderung, die es nicht gab — selbstverstaerkend, weil
    // die Datei danach auf `\n` endet.
    //
    // Die Zusage ist deshalb die Identitaet: hat die Gegenseite nichts geaendert,
    // ist das Ergebnis der lokale Stand, byteweise.
    expect(threeWayMerge('a\nb\n', 'a\nb\nLokal', 'a\nb\n')).toBe('a\nb\nLokal');
    expect(threeWayMerge('a\r\nb\r\n', 'a\r\nb\r\nLokal', 'a\r\nb\r\n')).toBe('a\r\nb\r\nLokal');
    expect(threeWayMerge('a\nb', 'a\nb\nX', 'a\nb')).toBe('a\nb\nX');
  });

  it('frisst keine abschliessende Leerzeile', () => {
    // ZWEITE REGRESSION, gefunden bei der adversarialen Pruefung (2026-08-13).
    // `mitNl` ist nicht umkehrbar: 'x' und 'x\n' bilden beide auf 'x\n' ab. Ein
    // pauschales `slice(0, -1)` nimmt deshalb nicht nur das angehaengte Zeichen
    // zurueck — endet das Ergebnis auf '\n\n', ist die letzte Zeile LEER, und das
    // zweite '\n' ist Inhalt, den niemand angehaengt hat.
    //
    // Der Schaden war doppelt: die Leerzeile verschwand, UND das Ergebnis endete
    // danach immer noch auf '\n', verfehlte also die eigene Zusage. Ein Text mit
    // leerer Schlusszeile kann `zielNl === false` gar nicht erfuellen.
    //
    // Eigene Messung (spike/duplikat-mb/leerzeile.mjs, Seed 20260813): 481 von
    // 19.959 gemergten Tripeln (2,4 %) betroffen — konvergent auf beiden Seiten
    // und damit still.
    expect(threeWayMerge('# Notiz\n', '# Notiz\nZeile', '# Notiz\nZeile\n\n')).toBe('# Notiz\nZeile\n\n');
    // Kantenfall: ein Text, der nur aus einem Zeilenumbruch besteht.
    expect(threeWayMerge('\n', '\n', '\n')).toBe('\n');
  });

  it('uebernimmt das Entfernen des Schluss-Zeilenendes als lokale Aenderung', () => {
    // Dieselbe Wurzel wie der Test darueber, andere Richtung: Entfernt local den
    // Schluss-Umbruch und aendert other nichts, ist das ein echter lokaler Edit
    // und darf nicht stillschweigend zurueckgenommen werden.
    expect(threeWayMerge('a\nb\n', 'a\nb', 'a\nb\n')).toBe('a\nb');
    // Spiegelbildlich: hat die Gegenseite ihn entfernt und local nichts geaendert,
    // gewinnt die Gegenseite.
    expect(threeWayMerge('a\nb\n', 'a\nb\n', 'a\nb')).toBe('a\nb');
  });

  it('behaelt das Zeilenende, wenn eine Seite eines hat', () => {
    // Nur wenn BEIDE Beitraege ohne Umbruch enden, wird er wieder entfernt. Sonst
    // wuerde der Merge ein vorhandenes Zeilenende verschlucken.
    expect(threeWayMerge('a\nb\n', 'a\nb\nX\n', 'a\nb\nY\n')).toBe('a\nb\nX\nY\n');
    expect(threeWayMerge('a\nb', 'a\nb\nX\n', 'a\nb\nY').endsWith('\n')).toBe(true);
    expect(threeWayMerge('a\nb', 'a\nb\nX', 'a\nb\nY\n').endsWith('\n')).toBe(true);
  });

  it('traegt die Lage aus dem Realtest r13 unbeschaedigt', () => {
    // Zeichengleich mit dem gemessenen Lauf (Messpunkte 132 / 165 / 158 Zeichen).
    const BASIS = '# Meetingprotokoll\n\nPunkt 1: Ausgangslage\nPunkt 2: Beschluss\n\nEnde der Vorlage\n';
    const aufbau = `${BASIS}AAA\nBBB`;
    const lokal = `${aufbau}\nOFFLINE-B`;
    const fremd = `${aufbau}\nA2`;
    const merged = threeWayMerge(aufbau, lokal, fremd);

    // Vor dem Fix stand hier 'A2BBB' in einer Zeile und BBB zaehlte zweimal.
    expect(merged).not.toContain('A2BBB');
    expect(zaehle(merged, 'BBB')).toBe(1);
    // Positives Gegensignal: beide Beitraege ueberleben vollstaendig — der Test
    // wuerde sonst auch dann gruen, wenn der Merge einfach Text weglaesst.
    expect(zaehle(merged, 'OFFLINE-B')).toBe(1);
    expect(zaehle(merged, 'A2')).toBe(1);
    expect(zaehle(merged, 'AAA')).toBe(1);
  });

  it('verhaelt sich wie unionMerge, wo beide dieselbe Lage sehen', () => {
    // `unionMerge` hatte die Behandlung schon; der Fix zieht `threeWayMerge`
    // nach. In der Lage ohne gemeinsamen Beitrag muessen beide dasselbe liefern
    // — vor dem Fix taten sie es nicht (217 gegen 191 Zeichen am Realtest).
    const lokal = 'a\nb\nX';
    const fremd = 'a\nb\nY';
    expect(threeWayMerge('a\nb', lokal, fremd).split('\n').sort()).toEqual(
      unionMerge(fremd, lokal).split('\n').sort()
    );
  });
});
