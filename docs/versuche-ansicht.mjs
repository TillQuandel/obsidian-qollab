// versuche-ansicht.mjs — erzeugt docs/versuche.md aus docs/versuche.yaml.
//
// AUFRUF:  node docs/versuche-ansicht.mjs          (schreibt)
//          node docs/versuche-ansicht.mjs --pruefe (nur vergleichen, Exitcode 1 bei Abweichung)
//
// WARUM EIN EIGENER PARSER UND KEIN js-yaml
// js-yaml liegt im Baum, aber vier Ebenen tief als transitive Abhaengigkeit von
// ts-jest (ts-jest > @jest/transform > babel-plugin-istanbul >
// @istanbuljs/load-nyc-config > js-yaml@3.14.2). Ein ts-jest-Update kann sie
// entfernen, und die 3.x-API unterscheidet sich von 4.x. Eine neue deklarierte
// Abhaengigkeit ist in diesem Projekt eine eigene Entscheidung.
//
// Der Parser kann deshalb genau die Teilmenge, die versuche.yaml benutzt:
// Skalare, Listen von Skalaren, eine Liste von Objekten, mehrzeilige
// `>`-Faltbloecke und `#`-Kommentare. Mehr nicht — was er nicht kennt, wirft er,
// statt es stillschweigend zu ueberspringen.
//
// GEGEN PARSER-BLINDHEIT: `tests/versuche-registratur.test.ts` zaehlt die
// Eintraege ein zweites Mal, unabhaengig vom Parser, ueber einen Zeilen-Match
// auf `- id:`. Weichen die Zahlen ab, schlaegt der Test fehl. Ein Parser, der
// Eintraege verschluckt, waere bei einer Registratur der schlimmste Fehler --
// sie behauptete dann Vollstaendigkeit und haette sie nicht.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
export const YAML_PFAD = join(HIER, 'versuche.yaml');
export const MD_PFAD = join(HIER, 'versuche.md');

// ── Parser ──────────────────────────────────────────────────────────────────

function einrueckung(zeile) {
  return zeile.length - zeile.trimStart().length;
}

function skalar(roh) {
  const t = roh.trim();
  if (t === '') return '';
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Liest einen `>`-Faltblock: alle Folgezeilen, die tiefer eingerueckt sind,
 * werden zu einem Absatz zusammengezogen (Leerzeile = Absatzgrenze).
 */
function faltblock(zeilen, ab, mindestTiefe) {
  const teile = [];
  let i = ab;
  for (; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (z.trim() === '') { teile.push(''); continue; }
    if (einrueckung(z) < mindestTiefe) break;
    teile.push(z.trim());
  }
  // Nachlaufende Leerzeilen gehoeren nicht zum Block.
  while (teile.length && teile[teile.length - 1] === '') teile.pop();
  const text = teile.join(' ').replace(/\s+/g, ' ').trim();
  return { text, naechste: i };
}

export function parse(quelle) {
  const zeilen = quelle.split(/\r?\n/);
  const kopf = {};
  const versuche = [];
  let aktuell = null;
  let inVersuchen = false;
  let listenZiel = null;

  for (let i = 0; i < zeilen.length; i++) {
    const zeile = zeilen[i];
    const roh = zeile.trim();
    if (roh === '' || roh.startsWith('#')) continue;

    const tiefe = einrueckung(zeile);

    // Beginn eines Versuchs-Eintrags
    if (roh.startsWith('- id:')) {
      if (!inVersuchen) throw new Error(`Zeile ${i + 1}: '- id:' ausserhalb von 'versuche:'`);
      aktuell = { id: skalar(roh.slice('- id:'.length)) };
      versuche.push(aktuell);
      listenZiel = null;
      continue;
    }

    // Element einer Skalar-Liste im Kopf
    if (roh.startsWith('- ')) {
      if (listenZiel) {
        const wert = roh.slice(2).trim();
        if (wert.startsWith('"') || wert.startsWith("'")) {
          // Mehrzeiliger, in Anfuehrungszeichen stehender Eintrag
          const anf = wert[0];
          if (wert.length > 1 && wert.endsWith(anf)) {
            listenZiel.push(wert.slice(1, -1));
          } else {
            let text = wert.slice(1);
            let j = i + 1;
            for (; j < zeilen.length; j++) {
              const w = zeilen[j].trim();
              if (w.endsWith(anf)) { text += ' ' + w.slice(0, -1); break; }
              text += ' ' + w;
            }
            i = j;
            listenZiel.push(text.replace(/\s+/g, ' ').trim());
          }
        } else {
          listenZiel.push(skalar(wert));
        }
        continue;
      }
      throw new Error(`Zeile ${i + 1}: Listeneintrag ohne bekanntes Ziel: ${roh}`);
    }

    const doppelpunkt = roh.indexOf(':');
    if (doppelpunkt === -1) throw new Error(`Zeile ${i + 1}: kein Schluessel erkennbar: ${roh}`);
    const schluessel = roh.slice(0, doppelpunkt).trim();
    const rest = roh.slice(doppelpunkt + 1).trim();

    // Wechsel in den Versuchs-Abschnitt
    if (schluessel === 'versuche' && tiefe === 0) {
      inVersuchen = true;
      listenZiel = null;
      continue;
    }

    if (rest === '>' || rest === '|') {
      const { text, naechste } = faltblock(zeilen, i + 1, tiefe + 1);
      if (!aktuell) throw new Error(`Zeile ${i + 1}: Faltblock ausserhalb eines Eintrags`);
      aktuell[schluessel] = text;
      i = naechste - 1;
      continue;
    }

    // Mehrzeiliger Wert in Anfuehrungszeichen: `beleg: "erste Zeile` und die
    // schliessende Anfuehrung erst weiter unten. Gueltiges YAML, und beim ersten
    // laengeren Beleg sofort benutzt — ohne diesen Zweig wirft der Parser dort,
    // wo der Schreibende alles richtig gemacht hat.
    const anf = rest[0];
    if ((anf === '"' || anf === "'") && !(rest.length > 1 && rest.endsWith(anf))) {
      let text = rest.slice(1);
      let j = i + 1;
      let geschlossen = false;
      for (; j < zeilen.length; j++) {
        const w = zeilen[j].trim();
        if (w.endsWith(anf)) { text += ' ' + w.slice(0, -1); geschlossen = true; break; }
        text += ' ' + w;
      }
      if (!geschlossen) throw new Error(`Zeile ${i + 1}: Anfuehrungszeichen nie geschlossen`);
      const wert = text.replace(/\s+/g, ' ').trim();
      if (aktuell && inVersuchen) aktuell[schluessel] = wert;
      else kopf[schluessel] = wert;
      i = j;
      continue;
    }

    if (rest === '') {
      // Schluessel ohne Wert leitet eine Liste ein (nur im Kopf verwendet).
      if (aktuell && inVersuchen) throw new Error(`Zeile ${i + 1}: leerer Wert in einem Eintrag: ${schluessel}`);
      kopf[schluessel] = [];
      listenZiel = kopf[schluessel];
      continue;
    }

    if (aktuell && inVersuchen && tiefe > 0) {
      aktuell[schluessel] = skalar(rest);
    } else {
      kopf[schluessel] = skalar(rest);
      listenZiel = null;
    }
  }

  return { kopf, versuche };
}

// ── Ansicht ─────────────────────────────────────────────────────────────────

const VERDIKT_TEXT = {
  gebrochen: 'gebrochen',
  leergelaufen: 'leergelaufen',
  eingebaut: 'eingebaut',
  offen: 'offen',
  'kein-urteil': 'kein Urteil',
  ueberholt: 'überholt',
};

const EBENE_TITEL = {
  kennung: 'Inkarnations-Kennung und Erstkontakt',
  materialisierung: 'Materialisierung und Verdopplung',
  merge: 'Merge-Verfahren und Textverlust',
  architektur: 'Architektur und Dateiformat',
  apparat: 'Messapparat',
};

const BELEG_TEXT = {
  nachlaufbar: 'nachlaufbar',
  'instrument-weg': '**Instrument weg**',
  'kein-bericht': '**kein Bericht**',
};

function md(x) {
  return String(x ?? '').replace(/\|/g, '\\|');
}

export function ansicht({ kopf, versuche }) {
  const z = [];
  z.push('# Qollab — Registratur der Versuche');
  z.push('');
  z.push('> [!warning] Erzeugte Datei — nicht von Hand editieren.');
  z.push('> Quelle ist `docs/versuche.yaml`. Neu erzeugen mit `node docs/versuche-ansicht.mjs`.');
  z.push('> `tests/versuche-registratur.test.ts` prüft, dass beide übereinstimmen.');
  z.push('');
  z.push(`**Stand:** ${kopf.stand} · **${versuche.length} Versuche**`);
  z.push('');

  // Überblick nach Verdikt — Übersicht vor Tiefe.
  const nachVerdikt = new Map();
  for (const v of versuche) nachVerdikt.set(v.verdikt, (nachVerdikt.get(v.verdikt) ?? 0) + 1);
  z.push('| Verdikt | Anzahl | Bedeutung |');
  z.push('| --- | --- | --- |');
  const bedeutung = {
    gebrochen: 'aktiv schlechter oder verletzt ein Kriterium',
    leergelaufen: 'Vorbedingung trat nie ein — Rückfall aufs Bestandsverhalten, kein Schaden',
    eingebaut: 'im Produktivcode auf `master`',
    offen: 'gemessen, aber nicht eingebaut',
    'kein-urteil': 'Prüfung nicht zustande gekommen',
    ueberholt: 'durch eine bessere Lösung ersetzt',
  };
  for (const [k, n] of [...nachVerdikt.entries()].sort((a, b) => b[1] - a[1])) {
    z.push(`| ${VERDIKT_TEXT[k] ?? k} | ${n} | ${bedeutung[k] ?? ''} |`);
  }
  z.push('');

  const schwach = versuche.filter((v) => v.beleg_lage !== 'nachlaufbar');
  if (schwach.length) {
    z.push(`**${schwach.length} Einträge sind nicht nachrechenbar** — ihre Instrumente oder Berichte existieren nicht mehr: ` +
      schwach.map((v) => `\`${v.id}\``).join(', ') + '. Vor Zitation außerhalb des Projekts prüfen.');
    z.push('');
  }

  for (const [ebene, titel] of Object.entries(EBENE_TITEL)) {
    const gruppe = versuche.filter((v) => v.ebene === ebene);
    if (!gruppe.length) continue;
    z.push(`## ${titel}`);
    z.push('');
    z.push('| ID | Versuch | Verdikt | Kennzahl | Beleglage |');
    z.push('| --- | --- | --- | --- | --- |');
    for (const v of gruppe) {
      z.push(`| \`${v.id}\` | ${md(v.name)} | ${VERDIKT_TEXT[v.verdikt] ?? v.verdikt} | ${md(v.kennzahl)} | ${BELEG_TEXT[v.beleg_lage] ?? v.beleg_lage} |`);
    }
    z.push('');
    for (const v of gruppe) {
      z.push(`### ${v.id} — ${v.name}`);
      z.push('');
      if (v.hypothese && v.hypothese !== '—') z.push(`**Hypothese:** ${v.hypothese}`);
      else z.push('**Hypothese:** — (gewachsener Bestand bzw. unerkannter Mangel, kein Kandidat)');
      z.push('');
      z.push(`**Verdikt:** ${VERDIKT_TEXT[v.verdikt] ?? v.verdikt} · **${v.datum}**`);
      z.push('');
      z.push(`**Kennzahl:** ${v.kennzahl}  `);
      z.push(`**Zellbasis:** ${v.zellbasis}`);
      z.push('');
      z.push(v.begruendung);
      z.push('');
      z.push(`*Beleg: ${v.beleg} — ${BELEG_TEXT[v.beleg_lage] ?? v.beleg_lage}*`);
      z.push('');
    }
  }

  z.push('## Reichweite dieser Registratur');
  z.push('');
  z.push('Ausgewertet:');
  z.push('');
  for (const q of kopf.quellen_ausgewertet ?? []) z.push(`- \`${q}\``);
  z.push('');
  z.push('**Nicht** ausgewertet — ein Versuch, der hier fehlt, ist nicht damit auch ungeprüft:');
  z.push('');
  for (const q of kopf.quellen_offen ?? []) z.push(`- ${q}`);
  z.push('');

  return z.join('\n');
}

// ── Hauptlauf ───────────────────────────────────────────────────────────────

const istHauptmodul = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (istHauptmodul) {
  const daten = parse(readFileSync(YAML_PFAD, 'utf8'));
  const text = ansicht(daten);
  if (process.argv.includes('--pruefe')) {
    let ist = '';
    try { ist = readFileSync(MD_PFAD, 'utf8'); } catch { /* fehlt */ }
    if (ist.replace(/\r\n/g, '\n') !== text) {
      console.error('versuche.md weicht von versuche.yaml ab. Neu erzeugen: node docs/versuche-ansicht.mjs');
      process.exit(1);
    }
    console.log(`versuche.md ist aktuell (${daten.versuche.length} Versuche).`);
  } else {
    writeFileSync(MD_PFAD, text, 'utf8');
    console.log(`versuche.md geschrieben — ${daten.versuche.length} Versuche.`);
  }
}
