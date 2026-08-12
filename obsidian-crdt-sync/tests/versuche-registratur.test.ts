import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';

// Registratur der Versuche — Pflichtfelder, Vollstaendigkeit, Aktualitaet.
//
// WOZU DIESER TEST
// `docs/versuche.yaml` beantwortet die Frage "haben wir X schon probiert?".
// Sie ist nur so viel wert wie ihre Disziplin: Ein Eintrag ohne Zellbasis ist
// eine nackte Zahl, und eine frueher zitierte Zahl ("162/400") war genau das —
// eine unbelegte Ableitung. Ein Eintrag ohne Beleglage verschweigt, dass vier
// Zahlengruppen dieses Projekts nicht mehr nachrechenbar sind.
//
// DIE ZWEITE ZAEHLUNG IST DER EIGENTLICHE PUNKT
// Dieser Test parst die YAML NICHT mit dem Parser aus `versuche-ansicht.mjs`,
// sondern unabhaengig ueber Zeilen-Matches. Waere es derselbe Parser, pruefte er
// seine eigene Kopie — der Fehler, den `tools/test-author-runs.mjs` im Projekt
// schon einmal gemacht hat. Verschluckt der Parser einen Eintrag, weichen die
// Zahlen ab und dieser Test faellt.

const WURZEL = join(__dirname, '..', '..');
const YAML_PFAD = join(WURZEL, 'docs', 'versuche.yaml');
const YAML = readFileSync(YAML_PFAD, 'utf8');

const VERDIKTE = ['gebrochen', 'leergelaufen', 'eingebaut', 'offen', 'kein-urteil', 'ueberholt'];
const EBENEN = ['kennung', 'materialisierung', 'merge', 'semantik', 'architektur', 'apparat'];
const BELEGLAGEN = ['nachlaufbar', 'instrument-weg', 'kein-bericht'];
// `id` steht bewusst NICHT in dieser Liste: Es lebt in der Listen-Marker-Zeile
// (`- id: K-01`), die `feld()` per Konstruktion nicht liest — dort steht `- id:`
// und nicht `id:`. In der ersten Fassung stand es hier, und der Test war
// dauerhaft rot. Aufgefallen ist das erst durch die Mutationsprobe; ein
// Pflichtfeld-Waechter, der sein eigenes Schluesselfeld nicht lesen kann, ist
// genau die Blindheit, vor der dieses Projekt warnt. `id` wird stattdessen
// direkt geprueft (siehe 'vergibt jede ID genau einmal' und den Test darunter).
const PFLICHT = ['name', 'ebene', 'verdikt', 'kennzahl', 'zellbasis', 'datum', 'begruendung', 'beleg', 'beleg_lage'];

/** Unabhaengige Extraktion: schneidet die Datei an den `- id:`-Zeilen. */
function eintraegeRoh(): { id: string; block: string }[] {
  const zeilen = YAML.split(/\r?\n/);
  const start: number[] = [];
  zeilen.forEach((z, i) => { if (/^\s*- id:/.test(z)) start.push(i); });
  return start.map((s, k) => {
    const ende = k + 1 < start.length ? start[k + 1] : zeilen.length;
    const block = zeilen.slice(s, ende).join('\n');
    return { id: (zeilen[s].split(':')[1] ?? '').trim(), block };
  });
}

/** Liest einen Skalar-Schluessel aus einem Eintragsblock (ohne den Parser). */
function feld(block: string, name: string): string | null {
  const m = block.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'm'));
  if (!m) return null;
  const wert = m[1].trim();
  if (wert === '>' || wert === '|') {
    // Faltblock: mindestens eine Folgezeile mit Inhalt muss existieren.
    const nach = block.slice(block.indexOf(m[0]) + m[0].length);
    const ersteZeile = nach.split(/\r?\n/).find((z) => z.trim() !== '');
    return ersteZeile ? ersteZeile.trim() : '';
  }
  return wert.replace(/^["']|["']$/g, '');
}

const EINTRAEGE = eintraegeRoh();

describe('Registratur der Versuche — Disziplin je Eintrag', () => {
  it('enthaelt ueberhaupt Eintraege', () => {
    expect(EINTRAEGE.length).toBeGreaterThan(30);
  });

  it('vergibt jede ID genau einmal', () => {
    const ids = EINTRAEGE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fuehrt bei jedem Eintrag eine nicht-leere ID im Schema <Buchstabe>-<Zahl>', () => {
    const schief = EINTRAEGE.filter((e) => !/^[A-Z]-\d{2}$/.test(e.id)).map((e) => e.id || '(leer)');
    expect(schief).toEqual([]);
  });

  it.each(PFLICHT)('fuehrt bei jedem Eintrag das Feld %s', (name) => {
    const ohne = EINTRAEGE.filter((e) => {
      const w = feld(e.block, name);
      return w === null || w === '';
    }).map((e) => e.id);
    expect(ohne).toEqual([]);
  });

  it('benutzt nur bekannte Verdikte', () => {
    const fremd = EINTRAEGE
      .map((e) => ({ id: e.id, v: feld(e.block, 'verdikt') }))
      .filter((x) => !VERDIKTE.includes(x.v as string));
    expect(fremd).toEqual([]);
  });

  it('benutzt nur bekannte Ebenen', () => {
    const fremd = EINTRAEGE
      .map((e) => ({ id: e.id, v: feld(e.block, 'ebene') }))
      .filter((x) => !EBENEN.includes(x.v as string));
    expect(fremd).toEqual([]);
  });

  it('benutzt nur bekannte Beleglagen', () => {
    const fremd = EINTRAEGE
      .map((e) => ({ id: e.id, v: feld(e.block, 'beleg_lage') }))
      .filter((x) => !BELEGLAGEN.includes(x.v as string));
    expect(fremd).toEqual([]);
  });

  it('datiert im Format JJJJ-MM-TT oder sagt ausdruecklich "unbekannt"', () => {
    // `unbekannt` ist zugelassen, weil die task-*-Berichte kein Datum tragen.
    // Ein erfundenes Datum waere schlimmer als eine sichtbare Luecke — dieselbe
    // Logik wie bei `beleg_lage`. Wer es benutzt, sagt im Beleg, warum.
    const schief = EINTRAEGE
      .map((e) => ({ id: e.id, d: feld(e.block, 'datum') }))
      .filter((x) => !/^\d{4}-\d{2}-\d{2}$|^unbekannt$/.test(String(x.d)));
    expect(schief).toEqual([]);
  });
});

describe('Registratur der Versuche — Aussagekraft', () => {
  // Eine Registratur, die nur "gefallen" kennt, ist eine Sperrliste. Die
  // Unterscheidung gebrochen/leergelaufen traegt eine eigene Lehre: Ein
  // Kandidat, der leerlaeuft, ist etwas anderes als einer, der bricht.
  it('unterscheidet gebrochen von leergelaufen', () => {
    const verdikte = EINTRAEGE.map((e) => feld(e.block, 'verdikt'));
    expect(verdikte).toContain('gebrochen');
    expect(verdikte).toContain('leergelaufen');
  });

  it('haelt fest, welche Eintraege nicht mehr nachrechenbar sind', () => {
    const schwach = EINTRAEGE.filter((e) => feld(e.block, 'beleg_lage') !== 'nachlaufbar');
    // Vier Zahlengruppen des Projekts sind belegt nicht mehr nachlaufbar.
    // Faellt diese Zahl auf 0, ist der Vorbehalt verlorengegangen, nicht behoben.
    expect(schwach.length).toBeGreaterThan(0);
  });

  it('fuehrt die Kandidaten der Sperrliste', () => {
    // Diese sechs stehen im Folgeprompt als "nicht erneut vorschlagen". Wer sie
    // hier nicht findet, probiert sie wieder durch — genau der Fall, der dem
    // Projekt Kandidat A zweimal gekostet hat.
    const muss = [
      'Gate an switchToGuid',      // M-01
      'Yjs-Update uebertragen',    // M-02
      'Saat-Kennung',              // K-06
      'Texthash',                  // K-03
      'Bibliothekswechsel',        // K-09
      'Zustands-Log',              // K-14
    ];
    const namen = EINTRAEGE.map((e) => String(feld(e.block, 'name'))).join(' | ');
    const fehlend = muss.filter((m) => {
      const teile = m.split(' ');
      return !teile.every((t) => namen.includes(t));
    });
    expect(fehlend).toEqual([]);
  });

  it('nennt die eigene Reichweite — ausgewertete und offene Quellen', () => {
    expect(YAML).toMatch(/quellen_ausgewertet:/);
    expect(YAML).toMatch(/quellen_offen:/);
  });
});

describe('Registratur der Versuche — die Ansicht ist aktuell', () => {
  it('versuche.md deckt sich mit versuche.yaml', () => {
    // Der Generator vergleicht selbst und liefert Exitcode 1 bei Abweichung.
    // execFileSync wirft dann — die Fehlermeldung nennt den Befehl zum Beheben.
    expect(() => {
      execFileSync(process.execPath, [join(WURZEL, 'docs', 'versuche-ansicht.mjs'), '--pruefe'], {
        cwd: WURZEL,
        stdio: 'pipe',
      });
    }).not.toThrow();
  });

  it('die Zaehlung des Generators deckt sich mit der unabhaengigen Zaehlung', () => {
    // DIE GEGENPROBE GEGEN PARSER-BLINDHEIT. Verschluckt der Parser in
    // versuche-ansicht.mjs einen Eintrag, weicht seine Zahl von der hier
    // ermittelten ab und dieser Test faellt.
    const md = readFileSync(join(WURZEL, 'docs', 'versuche.md'), 'utf8');
    const m = md.match(/\*\*(\d+) Versuche\*\*/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(EINTRAEGE.length);
  });
});
