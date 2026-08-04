// Verallgemeinerter Lauf: N Geraete, M umkaempfte Notizen, optional Geraete, die
// die ganze Zustellphase weg sind.
//
// DAS WICHTIGSTE AM ENTWURF: Bei `geraete=2`, `notizen=1`, `uhrModus='eine'` und
// ohne `offline` ist dieser Treiber SCHRITT FUER SCHRITT derselbe wie `lauf.ts`
// — gleiche Reihenfolge der Aufrufe, gleiche Kennungsfolge, gleiche Tokens,
// gleiche Ereignisliste ([up A, up B, md->A, side->A, md->B, side->B]). Das ist
// keine Behauptung, sondern in `zz7-achsen.spec.ts` als Kalibrierung geprueft:
// dort laufen `lauf` und `laufN` ueber dieselbe volle Aufzaehlung und muessen
// dieselben Zahlen liefern. Weicht etwas ab, ist der Treiber kaputt und keine
// Zahl daraus zaehlt.
//
// `lauf.ts` selbst bleibt unberuehrt — die Kalibrierung waere sonst zirkulaer.

import { Geraet, type Praegepolitik, type Quelle } from './geraet';
import { Wolke } from './wolke';
import { occ } from './invarianten';
import { setzeGuidFolge, guidQuelleAn } from './guid-quelle';
import type { Szenario, Editfall, Fabrik } from './lauf';

// Wortgleich zu `lauf.ts`. Bewusst kopiert statt exportiert: `lauf.ts` wird nicht
// angefasst, damit die Kalibrierung gegen einen unveraenderten Bestand laeuft.
const BASIS = 'kopf\nzeile-1\nzeile-2\nzeile-3\nfuss\n';
const KLEIN = '00000000000000000000000000000000';
const GROSS = 'ffffffffffffffffffffffffffffffff';
const MITTE = '8888888888888888888888888888888888'.slice(0, 32);

const IDS = ['aaaa1111', 'bbbb2222', 'cccc3333', 'dddd4444'];
const TAG = ['A', 'B', 'C', 'D'];
const TOKEN = ['AAA', 'BBB', 'CCC', 'DDD'];
// Einfuegepositionen. 1 und 3 sind die aus `lauf.ts`; 2 gehoert dem externen
// Schreiber, das dritte Geraet bekommt 4.
const POS = [1, 3, 4, 0];
const EXTERN_POS = 2;

export interface KonfigN {
  szenario: Szenario;
  editfall: Editfall;
  reihenfolge: number[];
  aWinnt: boolean;
  konfliktModus: 'kopie' | 'ohne';
  sperreBis: number;
  externEdit?: boolean;
  geraete?: number; // N, Standard 2
  notizen?: number; // M, Standard 1
  // ACHSE C: Indizes von Geraeten, die waehrend der GANZEN Zustellphase weder
  // hoch- noch herunterladen. Ihre Uhr laeuft weiter (ein Rechner ohne Netz
  // steht nicht still). Nach der Zustellphase sind sie zurueck und bekommen in
  // der Ruhephase alles auf einmal.
  offline?: number[];
  // 'eine' — die Frist-Uhr tickt nur fuer die erste umkaempfte Note (Bestand des
  //          Messwerkzeugs, noetig fuer die Kalibrierung).
  // 'alle' — die Uhr laeuft ueber ALLE geparkten Pfade, wie `tickParkedNotes`
  //          in main.ts:1547-1555.
  uhrModus?: 'eine' | 'alle';
  runden?: number; // Ruhephase, Standard 8
}

export interface ErgebnisN {
  divergenz: boolean;
  verlust: string[];
  stillVerloren: string[];
  doppel: string[];
  sauber: boolean;
  entkoppelt: boolean;
  parkungen: number;
  nachtraege: number; // wie im Bestand: Aufloesung UND Fristablauf
  aufloesungen: number; // davon: Historie kam, keine eigene Op entstanden
  fristNachtraege: number; // davon: Frist abgelaufen, Stand doch erfasst
}

export type FabrikN = (g: Geraet[], schritt: () => number) => Praegepolitik[];

// Die vorhandenen Varianten aus `politiken.ts` sind fuer zwei Geraete
// geschrieben. Sie hier neu zu tippen hiesse, zwei Quellen zu pflegen — also
// wird die Original-Fabrik paarweise angewandt: (g0,g1), (g0,g2), … Damit
// trifft jede Nebenwirkung (`parkFrist` setzen) jedes Geraet.
// GILT NUR fuer zustandslose, idempotente Fabriken — `heute` und `parken`.
// `orakel` (kennt den Peer) darf so NICHT gehoben werden.
export const alsN =
  (f: Fabrik): FabrikN =>
  (g, schritt) => {
    const pol: Praegepolitik[] = new Array(g.length);
    const erst = f(g[0], g[1], schritt);
    pol[0] = erst.a;
    pol[1] = erst.b;
    for (let i = 2; i < g.length; i++) pol[i] = f(g[0], g[i], schritt).b;
    return pol;
  };

function guidFolge(aWinnt: boolean, gross: boolean): string[] {
  const basis = aWinnt ? [MITTE, KLEIN, MITTE, GROSS, GROSS] : [MITTE, GROSS, MITTE, KLEIN, KLEIN];
  if (!gross) return basis; // exakt die Folge aus lauf.ts
  // Nachschub fuer die zusaetzlichen Praegungen (mehr Geraete / mehr Notizen).
  // Abwechselnd klein und gross, damit der Tie-Break nicht systematisch immer
  // in dieselbe Richtung faellt. Danach greift der Zaehler-Fallback aus
  // `guid-quelle.ts` — auch der ist deterministisch.
  const paare = ['11', 'ee', '22', 'dd', '33', 'cc', '44', 'bb', '55', 'aa', '66', '99'];
  const nach = aWinnt ? paare : paare.map((_, i) => paare[i ^ 1]);
  return [...basis, ...nach.map((v) => v.repeat(16))];
}

export async function laufN(k: KonfigN, fabrik: FabrikN): Promise<ErgebnisN> {
  const N = k.geraete ?? 2;
  const M = k.notizen ?? 1;
  const uhr = k.uhrModus ?? 'eine';
  const runden = k.runden ?? 8;

  guidQuelleAn();
  setzeGuidFolge(guidFolge(k.aWinnt, N > 2 || M > 1));

  const geraete = IDS.slice(0, N).map((id) => new Geraet(id));
  const a = geraete[0];
  const rest = geraete.slice(1);
  const w = new Wolke(geraete);
  w.konfliktModus = k.konfliktModus;
  let schritt = 0;
  const pol = fabrik(geraete, () => schritt);
  geraete.forEach((g, i) => g.setPolitik(pol[i]));

  // --- Ausgangslage -------------------------------------------------------
  const KTX = 'kontext.md';
  const NOTIZEN = Array.from({ length: M }, (_, i) => (M === 1 ? 'note.md' : `note-${i + 1}.md`));
  w.saeen(geraete, KTX, 'ktx\n');
  for (const n of NOTIZEN) w.saeen(geraete, n, BASIS);

  await a.tippe(KTX, 'ktx\nA-vorher\n');
  await a.modify(KTX);
  w.ladeMdHoch(a, KTX);
  w.ladeSidecarsHoch(a);
  for (const g of rest) w.ladeMdHerunter(g, KTX);

  const gesperrt = new Set<number>(
    k.szenario === 'rollout' ? rest.map((_, i) => i + 1) : []
  );
  if (k.szenario !== 'rollout') {
    for (const [i, g] of rest.entries()) {
      w.ladeSidecarsHerunter(g);
      await g.poll(KTX);
      await g.tippe(KTX, `${g.md(KTX)}${TAG[i + 1]}-vorher\n`);
      await g.modify(KTX);
      w.ladeSidecarsHoch(g);
      w.ladeMdHoch(g, KTX);
      for (const h of geraete) {
        if (h === g) continue;
        w.ladeSidecarsHerunter(h);
        await h.poll(KTX);
      }
    }
  }

  if (k.szenario === 'geteilt') {
    for (const n of NOTIZEN) {
      await a.tippe(n, BASIS.replace('fuss\n', 'gemeinsam\nfuss\n'));
      await a.modify(n);
      w.ladeMdHoch(a, n);
      w.ladeSidecarsHoch(a);
      for (const g of rest) {
        w.ladeMdHerunter(g, n);
        w.ladeSidecarsHerunter(g);
        await g.modify(n);
        await g.poll(n);
        w.ladeSidecarsHoch(g);
        w.ladeMdHoch(g, n);
        for (const h of geraete) {
          if (h === g) continue;
          w.ladeSidecarsHerunter(h);
          await h.poll(n);
        }
      }
    }
  }

  for (const g of geraete) g.politikAktiv = true;

  // --- Divergenzphase -----------------------------------------------------
  const tokenProNote = new Map<string, string[]>(NOTIZEN.map((n) => [n, []]));
  const editiere = async (
    g: Geraet,
    t: string,
    pos: number,
    note: string,
    quelle: Quelle = 'nutzer'
  ): Promise<void> => {
    tokenProNote.get(note)!.push(t);
    const zeilen = g.md(note).split('\n');
    zeilen.splice(Math.min(pos, zeilen.length - 1), 0, t);
    const text = zeilen.join('\n');
    if (quelle === 'nutzer') await g.tippe(note, text);
    else g.setMd(note, text);
    await g.modify(note, quelle);
  };
  const marke = (basis: string, ni: number): string => (M === 1 ? basis : `${basis}${ni + 1}`);
  const editoren =
    k.editfall === 'nurA' ? [0] : k.editfall === 'nurB' ? [1] : geraete.map((_, i) => i);
  for (const gi of editoren) {
    for (const [ni, n] of NOTIZEN.entries()) {
      await editiere(geraete[gi], marke(TOKEN[gi], ni), POS[gi], n);
    }
  }
  if (k.externEdit) {
    for (const [ni, n] of NOTIZEN.entries()) {
      await editiere(geraete[1], marke('EEE', ni), EXTERN_POS, n, 'extern');
    }
  }

  // --- Zustellphase -------------------------------------------------------
  let inZustellung = true;
  const wegSet = new Set(k.offline ?? []);
  const weg = (gi: number): boolean => inZustellung && wegSet.has(gi);

  const ereignisse: Array<() => Promise<void>> = [];
  for (const [gi, g] of geraete.entries()) {
    ereignisse.push(async () => {
      if (weg(gi)) return;
      for (const n of NOTIZEN) w.ladeMdHoch(g, n);
      w.ladeSidecarsHoch(g);
    });
  }
  for (const [gi, g] of geraete.entries()) {
    for (const n of NOTIZEN) {
      ereignisse.push(async () => {
        if (weg(gi)) return;
        if (w.ladeMdHerunter(g, n)) await g.modify(n, 'sync');
      });
    }
    ereignisse.push(async () => {
      if (weg(gi)) return;
      if (!gesperrt.has(gi) && w.ladeSidecarsHerunter(g)) {
        for (const n of NOTIZEN) await g.poll(n);
      }
    });
  }

  let aufloesungen = 0;
  let fristNachtraege = 0;
  // Der 30-s-Tick. In 'alle' ist das `tickParkedNotes` (main.ts:1547-1555): eine
  // Uhr, alle geparkten Pfade. Die Aufspaltung in Aufloesung und Fristablauf ist
  // reine Buchhaltung — `resolveParked` ist idempotent und der erste Schritt in
  // `tickParked` selbst, das Verhalten aendert sich dadurch nicht.
  const tick = async (): Promise<void> => {
    for (const g of geraete) {
      if (uhr === 'eine') {
        await g.parkTick(NOTIZEN[0]);
        continue;
      }
      for (const p of g.sync.parkedPaths()) {
        if (!g.sync.hasParked(p)) continue;
        if (g.sync.resolveParked(p)) {
          g.nachtragZaehler++;
          aufloesungen++;
          continue;
        }
        await g.sync.tickParked(p, g.parkFrist);
        if (!g.sync.hasParked(p)) {
          g.nachtragZaehler++;
          fristNachtraege++;
        }
      }
    }
  };

  for (const [i, e] of k.reihenfolge.entries()) {
    schritt = i;
    if (i >= k.sperreBis) gesperrt.clear();
    await ereignisse[e]();
    await tick();
  }
  gesperrt.clear();
  inZustellung = false; // die Ausgefallenen sind zurueck

  // --- Ruhephase ----------------------------------------------------------
  schritt = 100;
  for (let r = 0; r < runden; r++) {
    for (const sender of geraete) {
      for (const n of NOTIZEN) w.ladeMdHoch(sender, n);
      w.ladeSidecarsHoch(sender);
      for (const empf of geraete) {
        if (empf === sender) continue;
        for (const n of NOTIZEN) if (w.ladeMdHerunter(empf, n)) await empf.modify(n, 'sync');
        if (w.ladeSidecarsHerunter(empf)) for (const n of NOTIZEN) await empf.poll(n);
        for (const n of NOTIZEN) await empf.poll(n);
        await tick();
      }
    }
  }

  // --- Bewertung ----------------------------------------------------------
  const verlust: string[] = [];
  const doppel: string[] = [];
  let divergenz = false;
  for (const n of NOTIZEN) {
    const texte = geraete.map((g) => g.md(n));
    if (texte.some((t) => t !== texte[0])) divergenz = true;
    for (const t of tokenProNote.get(n)!) {
      const z = texte.map((x) => occ(x, t));
      if (z.some((x) => x === 0)) verlust.push(t);
      if (z.some((x) => x > 1)) doppel.push(t);
    }
  }
  const alleKopien = [
    ...w.alleKopien(),
    ...geraete.flatMap((g) => [...g.kopien.values()].flat()),
  ];
  const inKopie = verlust.filter((t) => alleKopien.some((kk) => occ(kk, t) > 0));
  const stillVerloren = verlust.filter((t) => !inKopie.includes(t));

  return {
    divergenz,
    verlust,
    stillVerloren,
    doppel,
    sauber: !divergenz && verlust.length === 0 && doppel.length === 0,
    entkoppelt: geraete.some((g) => NOTIZEN.some((n) => g.entkoppelt(n))),
    parkungen: geraete.reduce((s, g) => s + g.parkZaehler, 0),
    nachtraege: geraete.reduce((s, g) => s + g.nachtragZaehler, 0),
    aufloesungen,
    fristNachtraege,
  };
}

// ---- Permutationen ohne die ganze Liste im Speicher ------------------------
//
// 9! = 362 880 und 10! = 3 628 800 — aufzaehlen geht, alle messen nicht. Die
// Rangfunktion (Lehmer-Code) liefert die k-te Permutation in derselben
// lexikographischen Ordnung wie `permutationen()` aus `lauf.ts`; fuer n=6 gilt
// `permutationNr(6,k) === permutationen(6)[k]`.
export function fakultaet(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

export function permutationNr(n: number, rang: number): number[] {
  const rest = Array.from({ length: n }, (_, i) => i);
  const aus: number[] = [];
  let f = fakultaet(n);
  let r = rang % f;
  for (let i = n; i > 0; i--) {
    f /= i;
    const k = Math.floor(r / f);
    r %= f;
    aus.push(rest.splice(k, 1)[0]);
  }
  return aus;
}

// Deterministische Stichprobe: Raenge `i*P mod n!` mit P prim und groesser als
// jeder Faktor von n! — also teilerfremd, also durchlaeuft die Folge den ganzen
// Bereich ohne Wiederholung. Kein PRNG, keine Uhr.
export function stichprobe(n: number, anzahl: number): number[][] {
  const f = fakultaet(n);
  if (anzahl >= f) return Array.from({ length: f }, (_, i) => permutationNr(n, i));
  const P = 104729;
  return Array.from({ length: anzahl }, (_, i) => permutationNr(n, (i * P) % f));
}
