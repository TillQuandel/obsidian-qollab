// Task 17 / F-7 — Drei falsche Zusagen in der Dokumentation, als Netz gepinnt
//
// Die README ist das einzige Artefakt, das die Nicht-Technikerin liest; eine
// falsche Zusage dort ist ein Fund wie jeder andere. Alle drei sind über die
// Jahre entstanden, weil nichts sie gegen den Code hält. Genau das tut dieser
// Test: er prüft die Aussagen gegen Konstanten und Funktionen aus `src/`, nicht
// gegen eine zweite Textkopie.

import { readFileSync } from 'fs';
import { join } from 'path';
import { SCAN_INTERVAL_MS } from '../src/sidecar-watcher';
import { filterYjsFiles } from '../src/sync-handler';
import { DEFAULT_SETTINGS } from '../src/settings';

const README = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8');

// Blockzitate tragen die „Richtigstellung"-Absätze, die frühere Zusagen wörtlich
// zitieren, um sie zu widerrufen. Ein Zitat in einem Widerruf ist keine Zusage —
// geprüft wird deshalb nur der Fließtext.
const CLAIMS = README.split('\n')
  .filter((line) => !line.trimStart().startsWith('>'))
  .join('\n');

describe('F-7: README hält, was der Code tut', () => {
  it('nennt das Poll-Intervall statt „sofort"', () => {
    // `sidecar-watcher.ts` pollt alle 30 s; sofort ist nur der Trigger beim
    // Öffnen einer Note. Wer „sofort" liest, hält das Plugin für defekt und
    // editiert von Hand — und landet damit im Merge-Fenster.
    expect(SCAN_INTERVAL_MS).toBe(30_000);
    expect(CLAIMS).not.toMatch(/erkennt Qollab das sofort/);
    expect(CLAIMS).toMatch(/halbe[nr]? Minute|30 Sekunden/);
  });

  it('nennt als Beispiel-Hilfsdatei eine Form, die der Sidecar-Filter akzeptiert', () => {
    // Bis Task 17 stand dort `note.md.yjs` — die v0.1-Form ohne clientId-Segment.
    // Wer danach sucht, findet nichts.
    // Nur konkrete Beispielnamen: Platzhalter (`<clientId>`), Globs (`*.yjs`) und
    // die blanke Endung sind keine Pfadangaben.
    const examples = [...CLAIMS.matchAll(/`([^`]*\.yjs)`/g)]
      .map((m) => m[1])
      .filter((e) => e.includes('.md.') && !e.includes('*') && !e.includes('<'));
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const file = example.startsWith('.qollab/') ? example : `.qollab/${example}`;
      const notePath = file.slice('.qollab/'.length).replace(/\.[0-9a-f]{8}\.yjs$/, '');
      expect(filterYjsFiles([file], notePath)).toEqual([file]);
      // Und: keine Legacy-Form ohne clientId-Segment mehr als Beispiel.
      expect(file).toMatch(/\.[0-9a-f]{8}\.yjs$/);
    }
  });

  it('empfiehlt `.obsidian/` nicht mehr pauschal zum Mitsynchronisieren', () => {
    expect(CLAIMS).not.toMatch(/`\.obsidian\/` eingeschlossen/);
    // Stattdessen eine Ausschlussliste — die Dateien, für die im Zielvault reale
    // Konfliktkopien bzw. Secrets belegt sind.
    for (const excluded of ['workspace', 'vault-stats', 'graph.json', 'data.json']) {
      expect(CLAIMS).toContain(excluded);
    }
  });
});

// Szenariosuche Runde 2, Funde 38/39 — beides sind Zusagen, die die Architektur
// nicht hält. Der Schaden ist in `profile-loss.test.ts` reproduziert und dort als
// nicht behebbar belegt; die Korrektur konnte deshalb nur im README liegen.
describe('Funde 38/39: README hält, was das Geräteprofil hergibt', () => {
  it('nennt den Aus-Schalter als gerätelokal und nach Profilverlust zurückgesetzt', () => {
    // Der Schalter lebt ausschließlich im Geräteprofil (main.ts,
    // DEVICE_SETTINGS_KEY), und sein Default ist `true`. Jedes Gerät ohne dieses
    // Profil — Erststart wie Profilverlust — kommt damit scharf hoch. Weil der
    // README das Abschalten für große Vaults ausdrücklich empfiehlt, ist das
    // Verschweigen dieses Rücksetzers eine falsche Zusage.
    expect(DEFAULT_SETTINGS.enabled).toBe(true);
    expect(CLAIMS).toContain('besser deaktivieren');
    expect(CLAIMS).toContain('Der Schalter gilt pro Gerät');
    expect(CLAIMS).toContain('startet dort wieder mit „Sync aktiviert"');
  });

  it('sagt den Zombie-Schutz nicht mehr vorbehaltlos zu', () => {
    // `enabled` und `tombstones` sind genau die beiden Felder, die `saveSettings`
    // aus `data.json` heraushält (Task 17/F-3) — sie leben nur im Geräteprofil.
    // Damit hängt der Zombie-Schutz an zwei Bedingungen: Qollab war beim Löschen
    // an, und das Profil lebt noch. Ein „behoben." ohne Vorbehalt ist falsch.
    expect(DEFAULT_SETTINGS).toHaveProperty('tombstones', {});
    expect(CLAIMS).not.toMatch(/\*\*Zombie-Resurrection — behoben\.\*\*/);
    expect(CLAIMS).toContain('Zombie-Resurrection — behoben, mit zwei Ausnahmen.');
    // Und beide Ausnahmen müssen im Fließtext benannt sein.
    expect(CLAIMS).toContain('im Moment des Löschens **ausgeschaltet**');
    expect(CLAIMS).toContain('Geht das **Geräteprofil verloren**');
  });
});
