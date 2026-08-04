// Ein Lauf: zwei Geraete, EINE umkaempfte Note, ein Datei-Sync mit getrenntem
// Hoch- und Herunterladen. VOLLSTAENDIG DETERMINISTISCH — kein PRNG.
//
// Zwei verworfene Kalibrierungen stehen dahinter, beide dokumentiert, weil sie
// die Aussagekraft begrenzen:
//
//  (1) Hohe Editrate + Zufallsplan: Die KONTROLLE (`geteilt`: die Note hat
//      bereits eine gemeinsame Historie, es gibt also gar keinen Praegemoment)
//      war genauso rot wie die Testfaelle. Ein Instrument, das im Kontrollfall
//      dasselbe meldet wie im Testfall, misst nicht die Praegung.
//  (2) „Beide laden hoch, dann beide herunter" in der Ruhephase: der zweite
//      Upload kollidiert IMMER, beide Seiten pendeln endlos. Ein echter
//      Datei-Sync verschraenkt.
//
// Deshalb jetzt: wenige, benannte Edits und die VOLLSTAENDIGE Aufzaehlung der
// Zustellreihenfolgen — der Aufbau, der in den Vorarbeiten das klarste Signal
// geliefert hat.

import { Geraet, type Praegepolitik, type Quelle } from './geraet';
import { Wolke } from './wolke';
import { bewerte, occ, type Befund } from './invarianten';
import { setzeGuidFolge, guidQuelleAn } from './guid-quelle';

export const NOTE = 'note.md';
const BASIS = 'kopf\nzeile-1\nzeile-2\nzeile-3\nfuss\n';
const KLEIN = '00000000000000000000000000000000';
const GROSS = 'ffffffffffffffffffffffffffffffff';
const MITTE = '8888888888888888888888888888888888'.slice(0, 32);

// 'rollout'  — B ist frisch: keine eigene Hilfsdatei irgendwo, `.qollab/` trifft
//              verzoegert ein.
// 'alltag'   — beide etabliert; die umkaempfte Note hat dennoch keine Historie.
// 'geteilt'  — KONTROLLE: die Note hat bereits EINE gemeinsame Historie. Hier
//              gibt es keinen Praegemoment.
export type Szenario = 'rollout' | 'alltag' | 'geteilt';
export type Editfall = 'nurA' | 'nurB' | 'beide';

export interface Konfig {
  szenario: Szenario;
  editfall: Editfall;
  reihenfolge: number[]; // Permutation von [0..5]
  aWinnt: boolean; // bekommt A die kleinere Kennung?
  konfliktModus: 'kopie' | 'ohne';
  // Wie viele Zustellschritte lang bleibt B's `.qollab/` leer (nur 'rollout').
  sperreBis: number;
  // LACKMUSTEST: Ein anderes PROGRAMM (Notepad, Skript, LLM-Agent) aendert B's
  // `.md`, waehrend Obsidian laeuft. Fuer das Herkunftssignal sieht das aus wie
  // ein Sync-Overwrite — es gibt aber KEINE Hilfsdatei dazu, jetzt nicht und nie.
  externEdit?: boolean;
}

export interface LaufErgebnis {
  befund: Befund;
  tokens: string[];
  // Tokens, die in keiner `.md` mehr stehen, aber in einer Konfliktkopie —
  // sichtbar auf der Platte, aber Handarbeit.
  inKopie: string[];
  // Tokens, die NIRGENDS mehr stehen: der stille Verlust.
  stillVerloren: string[];
  kopien: number;
  aufschuebe: number;
  praegungen: number;
  ohneHistorie: boolean;
  // Parken-Diagnose.
  parkungen: number;
  nachtraege: number;
  // Am Ende steht Text in der `.md`, den kein Doc deckt: die Note ist still aus
  // dem CRDT ausgestiegen.
  entkoppelt: boolean;
}

export type Fabrik = (
  a: Geraet,
  b: Geraet,
  schritt: () => number
) => { a: Praegepolitik; b: Praegepolitik };

export async function lauf(k: Konfig, fabrik: Fabrik): Promise<LaufErgebnis> {
  guidQuelleAn();
  // Feste Kennungsfolge. Die ersten beiden Ziehungen gehoeren A (Kontext-Note
  // und umkaempfte Note), danach B. MITTE ist die Kennung der Kontext-Note, sie
  // spielt fuer den Tie-Break der umkaempften Note keine Rolle.
  setzeGuidFolge(
    k.aWinnt ? [MITTE, KLEIN, MITTE, GROSS, GROSS] : [MITTE, GROSS, MITTE, KLEIN, KLEIN]
  );

  const a = new Geraet('aaaa1111');
  const b = new Geraet('bbbb2222');
  const w = new Wolke([a, b]);
  w.konfliktModus = k.konfliktModus;
  let schritt = 0;
  const pol = fabrik(a, b, () => schritt);
  a.setPolitik(pol.a);
  b.setPolitik(pol.b);

  // --- Ausgangslage -------------------------------------------------------
  const KTX = 'kontext.md';
  w.saeen([a, b], KTX, 'ktx\n');
  w.saeen([a, b], NOTE, BASIS);

  // A ist immer etabliert.
  await a.tippe(KTX, 'ktx\nA-vorher\n');
  await a.modify(KTX);
  w.ladeMdHoch(a, KTX);
  w.ladeSidecarsHoch(a);
  w.ladeMdHerunter(b, KTX);

  let bGesperrt = k.szenario === 'rollout';
  if (k.szenario !== 'rollout') {
    // B ist ebenfalls etabliert: es hat die Kontext-Note adoptiert und
    // bearbeitet, hat also eine eigene Hilfsdatei im Vault.
    w.ladeSidecarsHerunter(b);
    await b.poll(KTX);
    await b.tippe(KTX, 'ktx\nA-vorher\nB-vorher\n');
    await b.modify(KTX);
    w.ladeSidecarsHoch(b);
    w.ladeMdHoch(b, KTX);
    w.ladeSidecarsHerunter(a);
    await a.poll(KTX);
  }

  if (k.szenario === 'geteilt') {
    // KONTROLLE: EINE Inkarnation. A praegt, B adoptiert, beide konvergent.
    await a.tippe(NOTE, BASIS.replace('fuss\n', 'gemeinsam\nfuss\n'));
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeSidecarsHoch(a);
    w.ladeMdHerunter(b, NOTE);
    w.ladeSidecarsHerunter(b);
    await b.modify(NOTE);
    await b.poll(NOTE);
    w.ladeSidecarsHoch(b);
    w.ladeMdHoch(b, NOTE);
    w.ladeSidecarsHerunter(a);
    await a.poll(NOTE);
  }

  // Ab hier greift die Politik — der Aufbau lief fuer alle Varianten gleich.
  a.politikAktiv = true;
  b.politikAktiv = true;

  // --- Divergenzphase -----------------------------------------------------
  const tokens: string[] = [];
  const editiere = async (
    g: Geraet,
    t: string,
    pos: number,
    quelle: Quelle = 'nutzer'
  ): Promise<void> => {
    tokens.push(t);
    const zeilen = g.md(NOTE).split('\n');
    zeilen.splice(Math.min(pos, zeilen.length - 1), 0, t);
    const text = zeilen.join('\n');
    // Ein Nutzer-Edit laeuft ueber den Adapter (Editor-Autosave), ein externer
    // Schreiber daran vorbei. Genau diesen Unterschied misst die Schreibspur.
    if (quelle === 'nutzer') await g.tippe(NOTE, text);
    else g.setMd(NOTE, text);
    await g.modify(NOTE, quelle);
  };
  if (k.editfall !== 'nurB') await editiere(a, 'AAA', 1);
  if (k.editfall !== 'nurA') await editiere(b, 'BBB', 3);
  // Der externe Schreiber. Bewusst auf B und bewusst NACH den regulaeren Edits:
  // so konkurriert er mit derselben Zustellreihenfolge wie alles andere.
  if (k.externEdit) await editiere(b, 'EEE', 2, 'extern');

  // --- Zustellphase: die uebergebene Reihenfolge --------------------------
  // Die sechs Ereignisse sind so geschnitten, dass die EMPFANGSseitige Trennung
  // von `.md` und Hilfsdatei in der Permutation steckt — das ist der in der
  // Wissenspool-Note benannte Ausloeser („Kommt die Datei vor der zugehoerigen
  // Historie an…"). Auf der Sendeseite schreibt ein Geraet beides praktisch
  // gleichzeitig; die Verzoegerung entsteht im Transport.
  const ereignisse: Array<() => Promise<void>> = [
    async () => {
      w.ladeMdHoch(a, NOTE);
      w.ladeSidecarsHoch(a);
    },
    async () => {
      w.ladeMdHoch(b, NOTE);
      w.ladeSidecarsHoch(b);
    },
    async () => {
      if (w.ladeMdHerunter(a, NOTE)) await a.modify(NOTE, 'sync');
    },
    async () => {
      if (w.ladeSidecarsHerunter(a)) await a.poll(NOTE);
    },
    async () => {
      if (w.ladeMdHerunter(b, NOTE)) await b.modify(NOTE, 'sync');
    },
    async () => {
      if (!bGesperrt && w.ladeSidecarsHerunter(b)) await b.poll(NOTE);
    },
  ];
  // Der 30-s-Tick der beiden Geraete. Er haengt an keinem Sidecar-Wechsel —
  // ohne ihn bekaeme eine geparkte Note, deren Hilfsdatei nie kommt, nie wieder
  // einen Trigger (sidecar-watcher.ts:129-137).
  const tick = async (): Promise<void> => {
    await a.parkTick(NOTE);
    await b.parkTick(NOTE);
  };
  for (const [i, e] of k.reihenfolge.entries()) {
    schritt = i;
    if (i >= k.sperreBis) bGesperrt = false;
    await ereignisse[e]();
    await tick();
  }
  bGesperrt = false;

  // --- Ruhephase: ABWECHSELND zustellen bis zum Fixpunkt -------------------
  schritt = 100;
  for (let i = 0; i < 8; i++) {
    for (const [sender, empfaenger] of [
      [a, b],
      [b, a],
    ] as Array<[Geraet, Geraet]>) {
      w.ladeMdHoch(sender, NOTE);
      w.ladeSidecarsHoch(sender);
      if (w.ladeMdHerunter(empfaenger, NOTE)) await empfaenger.modify(NOTE, 'sync');
      if (w.ladeSidecarsHerunter(empfaenger)) await empfaenger.poll(NOTE);
      await empfaenger.poll(NOTE);
      await tick();
    }
  }

  const befund = bewerte(a.md(NOTE), b.md(NOTE), tokens);
  // Die Konfliktkopien des Sync-Dienstes UND die Sicherungen des Plugins. Beide
  // sind dasselbe fuer die Frage „steht der Text noch irgendwo": eine Datei, die
  // der Nutzer oeffnen kann. Ohne die zweite Haelfte zaehlte die Messung einen
  // Verlust, den es nicht gibt.
  const alleKopien = [
    ...w.alleKopien(),
    ...[...a.kopien.values()].flat(),
    ...[...b.kopien.values()].flat(),
  ];
  const inKopie = befund.verlust.filter((t) => alleKopien.some((kk) => occ(kk, t) > 0));
  const stillVerloren = befund.verlust.filter((t) => !inKopie.includes(t));
  const ohneHistorie =
    ![...(a.vault._files.keys() as Iterable<string>)].some((p) => p.includes(NOTE)) &&
    ![...(b.vault._files.keys() as Iterable<string>)].some((p) => p.includes(NOTE));

  return {
    befund,
    tokens,
    inKopie,
    stillVerloren,
    kopien: alleKopien.length,
    aufschuebe: a.aufschubZaehler + b.aufschubZaehler,
    praegungen: a.praegeZaehler + b.praegeZaehler,
    ohneHistorie,
    parkungen: a.parkZaehler + b.parkZaehler,
    nachtraege: a.nachtragZaehler + b.nachtragZaehler,
    entkoppelt: a.entkoppelt(NOTE) || b.entkoppelt(NOTE),
  };
}

// Alle Permutationen von [0..n-1].
export function permutationen(n: number): number[][] {
  if (n === 0) return [[]];
  const aus: number[][] = [];
  const bau = (rest: number[], vor: number[]): void => {
    if (rest.length === 0) {
      aus.push(vor);
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      bau([...rest.slice(0, i), ...rest.slice(i + 1)], [...vor, rest[i]]);
    }
  };
  bau(
    Array.from({ length: n }, (_, i) => i),
    []
  );
  return aus;
}
