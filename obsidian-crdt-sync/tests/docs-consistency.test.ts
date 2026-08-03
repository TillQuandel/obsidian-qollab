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
import { filterYjsFiles, SyncHandler, QOLLAB_DIR } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { DEFAULT_SETTINGS } from '../src/settings';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import { FOREIGN_OWN_SIDECAR_NOTICE } from '../src/main';

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

// Szenariosuche Runde 2, Fund 40 — eine verirrte Hilfsdatei kippt fremden Text in
// eine unbeteiligte Notiz. Der Schaden ist in `verirrte-sidecar.test.ts`
// reproduziert und dort als bewusste Grenze gepinnt; der README muss sie nennen,
// solange das Dateiformat den Note-Pfad nicht trägt.
describe('Fund 40: README nennt die Grenze, solange das Format keinen Pfad trägt', () => {
  it('sagt die Zuordnung über den Dateinamen zu — und der Code hält sie so', () => {
    // Code-Anker 1: Die gelesene Datei kennt genau zwei Felder. Kommt je ein
    // Note-Pfad dazu, ist die Grenze neu zu bewerten und dieser Test fällt.
    const datei = encodeStateFile('0'.repeat(32), new Uint8Array([0, 0]));
    expect(Object.keys(decodeStateFile(datei)).sort()).toEqual(['guid', 'update']);
    // Code-Anker 2: Die Zuordnung läuft rein über den Dateinamen — dieselben
    // Bytes gehören unter dem einen Namen zu der einen, unter dem anderen zu der
    // anderen Notiz.
    expect(filterYjsFiles(['.qollab/b.md.5e307e01.yjs'], 'b.md')).toHaveLength(1);
    expect(filterYjsFiles(['.qollab/b.md.5e307e01.yjs'], 'a.md')).toHaveLength(0);

    expect(CLAIMS).toContain('Dateiname ist der einzige Hinweis darauf, zu welcher Notiz sie gehört');
    expect(CLAIMS).toContain('den Ordner `.qollab` nicht von Hand umsortieren');
  });
});

// Der README verwies für die Datei-Explosion auf Issue #9 („Subdocuments +
// SQLite-Single-Store") und versprach damit eine Lösung, die nicht kommt: #9 ist
// als „not planned" geschlossen, beide Hälften sind widerlegt. Die Grenze selbst
// besteht unverändert — sie steckt in der Form des Sidecar-Pfads, und genau dort
// hängt dieser Test. Ändert sich die Ablage (flache Segmente je Gerät, #12),
// fällt er und die Aussage im README ist neu zu fassen.
describe('Datei-Explosion: README verspricht keine Lösung, die es nicht gibt', () => {
  const handler = (clientId: string) =>
    new SyncHandler({} as any, new CrdtManager(), clientId);

  it('nennt das Wachstum als offene Grenze — und der Code hält das Gesetz', () => {
    // Code-Anker: Der Pfad einer Hilfsdatei ist Funktion aus Note-Pfad UND
    // Geräte-ID, im unter `.qollab/` gespiegelten Baum. Daraus folgt unmittelbar
    // „Notes × Geräte" Dateien — das ist die Grenze, die der README benennt.
    const note = 'projekte/2026/notiz.md';
    const a = handler('a1b2c3d4').stateFilePath(note);
    const b = handler('e5f6a7b8').stateFilePath(note);
    expect(a).toBe(`${QOLLAB_DIR}/projekte/2026/notiz.md.a1b2c3d4.yjs`);
    expect(b).not.toBe(a);
    // Beide gehören zu derselben Notiz: zwei Geräte, zwei Dateien, eine Note.
    expect(filterYjsFiles([a, b], note)).toEqual([a, b]);
    // Und eine zweite Note bringt ihre eigenen mit — das Produkt, nicht die Summe.
    expect(filterYjsFiles([a, b], 'projekte/2026/andere.md')).toEqual([]);

    expect(CLAIMS).toContain('Das Wachstum dieser Hilfsdateien ist eine offene Grenze');
    // Der Rat zum Deaktivieren steht ohne Bedingung, an die er geknüpft wäre.
    expect(CLAIMS).toContain('besser deaktivieren, ohne Ablaufdatum');
  });

  it('verweist nicht mehr auf das geschlossene Issue und seine widerlegte Lösung', () => {
    // Der tote Link ist im ganzen Dokument weg, auch in der Richtigstellung —
    // dort wird die Nummer nur noch genannt, nicht mehr verlinkt.
    expect(README).not.toMatch(/issues\/9(?!\d)/);
    // Und keine der beiden widerlegten Hälften wird im Fließtext noch zugesagt.
    expect(CLAIMS).not.toMatch(/Subdocument/i);
    expect(CLAIMS).not.toMatch(/SQLite/i);
  });

  it('nennt die verfolgte Richtung als Arbeit, nicht als Zusage', () => {
    expect(CLAIMS).toContain('issues/12');
    expect(CLAIMS).toContain('ohne Termin und ohne Zusage');
    expect(CLAIMS).toContain('gebaut ist davon nichts');
  });
});

// Szenariosuche Runde 2, Fund 37 — die Meldung über eine fremd geschriebene
// eigene Hilfsdatei nannte eine Ursache, die an ihrer Stelle nicht feststeht,
// und der README bestätigte sie („nur noch möglich, wenn beide dieselbe alte
// `data.json` geerbt haben"). Der Schaden ist in `backup-restore.test.ts`
// reproduziert und dort als an der Erkennungsstelle nicht auflösbar belegt; die
// Korrektur konnte deshalb nur im Wortlaut liegen — und der muss in Meldung und
// README derselbe bleiben.
describe('Fund 37: README hält, was die Meldung wirklich sagt', () => {
  it('die Meldung behauptet keine Ursache, sondern nennt beide', () => {
    expect(FOREIGN_OWN_SIDECAR_NOTICE).not.toMatch(/Kollision/);
    expect(FOREIGN_OWN_SIDECAR_NOTICE).toMatch(/von außen verändert/);
    // Beide Ursachen, in dieser Reihenfolge nicht festgelegt — nur beide da.
    expect(FOREIGN_OWN_SIDECAR_NOTICE).toMatch(/zweites Gerät/);
    expect(FOREIGN_OWN_SIDECAR_NOTICE).toMatch(/Sicherung/);
  });

  it('der README sagt die Meldung nicht mehr als Kollisions-Nachweis zu', () => {
    // Die widerrufene Zusage. Sie stand im Fließtext und wird dort nicht mehr
    // geduldet; im Blockzitat der Richtigstellung darf sie zitiert werden (die
    // CLAIMS-Filterung oben blendet Blockzitate aus).
    expect(CLAIMS).not.toMatch(/meldet diese Kollision einmal/);
    // Und der Absatz benennt, was die Meldung nicht leisten kann, plus beide
    // Ursachen — dieselben zwei, die auch im Meldungstext stehen.
    expect(CLAIMS).toContain('die Meldung kann nicht sagen, welche vorliegt');
    expect(CLAIMS).toContain('dieselbe Geräte-ID');
    expect(CLAIMS).toContain('Sicherung des `.qollab`-Ordners zurückgespielt');
  });
});
