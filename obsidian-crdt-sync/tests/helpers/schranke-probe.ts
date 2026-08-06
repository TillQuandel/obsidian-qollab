// AKTIVITAETSPROBE fuer die Sweep-Schranke — kein Test, sondern ein Messgeraet.
//
// Sie beantwortet zwei Fragen, die „548/548 gruen mit `basis-signatur`" NICHT
// beantwortet:
//
//   1. ZAEHLEN   — feuert `fremdErklaert()` in der bestehenden Suite ueberhaupt?
//                  Feuert es nie, ist die Regressionsschranke fuer diesen
//                  Kandidaten blind und jede gruene Zahl ueber ihn wertlos.
//   2. SABOTAGE  — wird ein Test rot, wenn das Praedikat immer `null` liefert?
//                  Das ist die Mutationsprobe der Basiswahl: bleibt alles gruen,
//                  greift kein Test den Kandidaten.
//
// Genau diese Fehlerklasse hat das Projekt mehrfach teuer bezahlt — vier
// Messinstrumente waren bereits blind, und ein zentraler Assert fiel darauf
// herein, dass ein Werkzeug still auf ein beliebiges Fenster auswich.
//
// Die Probe laeuft NICHT im Regelbetrieb: sie ist keine `*.test.ts` und wird nur
// per CLI zugeschaltet.
//
//   # 1. zaehlen (Standard)
//   npx jest --setupFilesAfterEnv <pfad>/tests/helpers/schranke-probe.ts
//
//   # 2. sabotieren
//   QOLLAB_SCHRANKE_PROBE=sabotage npx jest --setupFilesAfterEnv <pfad>/…/schranke-probe.ts
//
// Im Zaehl-Modus aendert sie kein Produktivverhalten: der Wrapper reicht
// Argumente und Rueckgabe unveraendert durch. Geschrieben wird eine Zeile JSON je
// Test, in dem das Praedikat mindestens einmal AUFGERUFEN wurde
// (`QOLLAB_SCHRANKE_LOG`, Standard `C:/tmp/schranke-probe.log`).

import * as fs from 'fs';
import { SyncHandler } from '../../src/sync-handler';

const MODUS = process.env.QOLLAB_SCHRANKE_PROBE ?? 'zaehlen';
const LOG = process.env.QOLLAB_SCHRANKE_LOG ?? 'C:/tmp/schranke-probe.log';

// `fremdErklaert` ist TS-`private` — das ist eine Compile-Zeit-Zusage, zur Laufzeit
// liegt die Methode ganz normal auf dem Prototyp.
const proto = SyncHandler.prototype as unknown as Record<string, unknown>;
const original = proto.fremdErklaert as (...args: unknown[]) => string | null;

// AUFRUFE: wie oft war `imSweep && !adopted && schranke !== 'aus'` ueberhaupt wahr.
// TREFFER: wie oft lieferte das Praedikat einen Text — nur die zaehlen als „gegriffen".
let aufrufe = 0;
let treffer = 0;

proto.fremdErklaert = function (this: unknown, ...args: unknown[]): string | null {
  aufrufe++;
  // MUTATION: kein Befund, nie. Damit faellt die Basis-Korrektur ersatzlos aus und
  // jeder Schalterstand verhaelt sich wie 'aus'.
  if (MODUS === 'sabotage') return null;
  const r = original.apply(this, args);
  if (r !== null) treffer++;
  return r;
};

beforeEach(() => {
  aufrufe = 0;
  treffer = 0;
});

afterEach(() => {
  if (MODUS === 'sabotage' || aufrufe === 0) return;
  const st = expect.getState();
  fs.appendFileSync(
    LOG,
    JSON.stringify({
      datei: st.testPath,
      test: st.currentTestName,
      aufrufe,
      treffer,
    }) + '\n'
  );
});
