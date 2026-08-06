// DER FREMDBESTIMMTE RUECKFALL DER `.md`.
//
// Der Fall, den die deutsche README-Fassung (Commit `6a95170^`, Zeile 144) als
// „offen" beschrieb:
//
//   „Faellt die `.md` fremdbestimmt hinter den Merge-Zustand zurueck […] dann ist
//    das Ergebnis auf Datei-Ebene von einer echten lokalen Loeschung nicht zu
//    unterscheiden. Der eigene, noch nicht synchronisierte Edit wird dabei als
//    Loeschung in die eigene Hilfsdatei geschrieben, also gerade dort entfernt,
//    wo er als letztes noch existierte."
//
// Seither ist DAS TOR dazugekommen (main.ts:326-334): Traegt die `.md` einen
// Inhalt, den dieser Prozess nicht geschrieben hat, wird sie geparkt statt
// gediffed. Damit ist der Weg im laufenden Betrieb zu.
//
// ER IST ES NICHT BEIM START. main.ts:87-91 sagt es selbst: „nach einem Neustart
// — der Parkplatz ist rein im Speicher. Der Sweep erfasst dann wie bisher; beim
// Start ist Herkunft ohnehin nicht ableitbar." Der Start-Sweep (main.ts,
// `sweepStaleNotes`) ruft `applyLocalContent` OHNE das Tor.
//
// Genau diese beiden Lagen stellt dieser Treiber gegeneinander. Die Zellbasis ist
// in beiden dieselbe: die VOLLSTAENDIGE Aufzaehlung der 720 Zustellreihenfolgen.
//
// ABGRENZUNG ZUR VORLAGE: `spike/lauf.ts` auf `mess/verdopplung` misst den
// PRAEGEMOMENT (Erstkontakt). Hier laeuft ausschliesslich die Zelle `geteilt` —
// die Note hat bereits eine gemeinsame Historie, es gibt also gar keinen
// Praegemoment und keine Erstkontakt-Verdopplung, die das Ergebnis faerben
// koennte. Was hier gemessen wird, ist allein der Rueckfall.

import { Geraet } from './geraet';
import type { SweepSchranke } from '../src/sync-handler';
import { Wolke } from './wolke';
import { bewerte, occ, type Befund } from './invarianten';
import { decodeStateFile } from '../src/state-file';
import { textFromUpdate } from '../src/crdt-manager';
import { setzeGuidFolge, guidQuelleAn } from './guid-quelle';
import { setzeZufallSeed, zufallQuelleAn, seedAusKonfig } from './zufall-quelle';

export const NOTE = 'note.md';
const BASIS = 'kopf\nzeile-1\nzeile-2\nzeile-3\nfuss\n';
const KLEIN = '00000000000000000000000000000000';
const GROSS = 'ffffffffffffffffffffffffffffffff';
const MITTE = '8888888888888888888888888888888888'.slice(0, 32);

// 'laufend'      — Obsidian laeuft auf A, waehrend der Sync die `.md`
//                  ueberschreibt. Das modify-Ereignis feuert, DAS TOR greift.
// 'neustart'     — Obsidian ist auf A geschlossen, waehrend die Dateien
//                  eintreffen. Danach Start: neuer Prozess, leere Schreibspur,
//                  leerer Parkplatz — und der Start-Sweep, der kein Tor hat.
// 'neustart-ohne-sweep' — MUTATIONSPROBE, kein Betriebszustand. Derselbe
//                  Neustart, aber der Sweep wird ausgelassen. Bleibt der Verlust
//                  hier aus, ist der Sweep die Ursache und nicht der Neustart an
//                  sich. Ohne diese Zelle waere die Zuschreibung geraten.
export type Lage = 'laufend' | 'neustart' | 'neustart-ohne-sweep';

export interface Konfig {
  lage: Lage;
  reihenfolge: number[]; // Permutation von [0..5]
  aWinnt: boolean;
  konfliktModus: 'kopie' | 'ohne' | 'ueberschreiben';
  // DER MESSSCHALTER. 'aus' = Bestand; der Seed haengt bewusst NICHT daran, damit
  // Bestand und Variante ueber DIESELBE Kennungs- und clientID-Folge laufen.
  schranke?: SweepSchranke;
}

export interface Ergebnis {
  befund: Befund;
  tokens: string[];
  // Tokens, die in keiner `.md` mehr stehen, aber in einer Konfliktkopie des
  // Sync-Dienstes ODER in einer Sicherung des Plugins — sichtbar auf der Platte,
  // aber Handarbeit.
  inKopie: string[];
  // Tokens, die NIRGENDS mehr stehen: DER STILLE VERLUST.
  stillVerloren: string[];
  // Hat der Start-Sweep die Note tatsaechlich angesehen? Ohne dieses Feld waere
  // nicht nachweisbar, dass die Zelle den gemessenen Weg ueberhaupt gelaufen ist.
  sweepAngesehen: boolean;
  // Hat der Sync-Dienst A's lokal geaenderte `.md` waehrend der Zustellphase
  // tatsaechlich ueberschrieben? In den Reihenfolgen, in denen A zuerst
  // hochlaedt, passiert das nicht — dort ist A's Edit ohnehin in Sicherheit.
  // Die Zahl trennt die unbedingte Rate von der bedingten.
  aUeberschrieben: boolean;
  parkungen: number;
  // AKTIVITAETSPROBE: Wie oft hat die Sweep-Schranke in diesem Lauf gegriffen?
  schranke: number;
  // GEGENPROBE ZUR PRAEMISSE, unabhaengig vom Eingriff gemessen: Lag B's
  // Hilfsdatei zum Sweep-Zeitpunkt auf A's Platte UND trug sie B's Edit? Nur dann
  // KANN die Schranke ueberhaupt etwas nachweisen. Wird auch mit ausgeschaltetem
  // Schalter erhoben — sie ist eine Eigenschaft der Zustellordnung, nicht des
  // Eingriffs.
  beweisDa: boolean;
}

// Der Seed haengt nur an Feldern, die es in beiden Lagen gibt — `lage` geht
// bewusst NICHT ein. So laufen beide Lagen ueber DIESELBE Kennungs- und
// clientID-Folge, und ein Unterschied im Ergebnis ist der Lage zuzuschreiben,
// nicht dem Wuerfel.
function seed(k: Konfig): number {
  return seedAusKonfig({
    szenario: 'geteilt',
    editfall: 'beide',
    reihenfolge: k.reihenfolge,
    aWinnt: k.aWinnt,
    konfliktModus: k.konfliktModus,
    sperreBis: 0,
  });
}

export async function laufRueckfall(k: Konfig): Promise<Ergebnis> {
  guidQuelleAn();
  zufallQuelleAn();
  setzeZufallSeed(seed(k));
  setzeGuidFolge(
    k.aWinnt ? [MITTE, KLEIN, MITTE, GROSS, GROSS] : [MITTE, GROSS, MITTE, KLEIN, KLEIN]
  );

  const a = new Geraet('aaaa1111');
  const b = new Geraet('bbbb2222');
  // Die Frist des Produkts (PARK_FRIST_TICKS = 4). Ohne sie waere das Tor aus.
  a.parkFrist = 4;
  b.parkFrist = 4;
  a.setzeSchranke(k.schranke ?? 'aus');
  b.setzeSchranke(k.schranke ?? 'aus');
  const w = new Wolke([a, b]);
  w.konfliktModus = k.konfliktModus;

  // --- Ausgangslage: beide etabliert, die Note hat GEMEINSAME Historie -----
  const KTX = 'kontext.md';
  w.saeen([a, b], KTX, 'ktx\n');
  w.saeen([a, b], NOTE, BASIS);

  await a.tippe(KTX, 'ktx\nA-vorher\n');
  await a.modify(KTX);
  w.ladeMdHoch(a, KTX);
  w.ladeSidecarsHoch(a);
  w.ladeMdHerunter(b, KTX);
  w.ladeSidecarsHerunter(b);
  await b.poll(KTX);
  await b.tippe(KTX, 'ktx\nA-vorher\nB-vorher\n');
  await b.modify(KTX);
  w.ladeSidecarsHoch(b);
  w.ladeMdHoch(b, KTX);
  w.ladeSidecarsHerunter(a);
  await a.poll(KTX);

  // EINE Inkarnation der umkaempften Note: A praegt, B adoptiert, beide konvergent.
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

  // --- Divergenzphase: je ein NUTZER-Edit, beide noch nicht ausgetauscht ---
  const tokens: string[] = [];
  const editiere = async (g: Geraet, t: string, pos: number): Promise<void> => {
    tokens.push(t);
    const zeilen = g.md(NOTE).split('\n');
    zeilen.splice(Math.min(pos, zeilen.length - 1), 0, t);
    const text = zeilen.join('\n');
    // Ueber den Adapter — ein Nutzer-Edit mit Editor-Autosave. Genau das, was die
    // Schreibspur als EIGEN erkennt und was danach in der eigenen Hilfsdatei steht.
    await g.tippe(NOTE, text);
    await g.modify(NOTE);
  };
  // AAA ist der Edit, um den es geht: A hat ihn getippt, er steht in A's `.md`
  // UND in A's eigener Hilfsdatei — und er ist noch NICHT hochgeladen.
  await editiere(a, 'AAA', 1);
  await editiere(b, 'BBB', 3);

  // --- Zustellphase --------------------------------------------------------
  // Dieselben sechs Ereignisse wie in der Vorlage. Der Unterschied steckt in
  // `aWach`: ist A geschlossen, landen die Dateien auf der Platte, ohne dass ein
  // Handler feuert — genau so, wie es ein Sync-Dienst bei geschlossener App tut.
  const aWach = k.lage === 'laufend';
  let aUeberschrieben = false;
  const ereignisse: Array<() => Promise<void>> = [
    async () => {
      // A laedt nur hoch, wenn es laeuft. Bei geschlossener App synchronisiert der
      // Dienst die Dateien weiter — der Stand auf der Platte ist der, den A
      // hinterlassen hat.
      w.ladeMdHoch(a, NOTE);
      w.ladeSidecarsHoch(a);
    },
    async () => {
      w.ladeMdHoch(b, NOTE);
      w.ladeSidecarsHoch(b);
    },
    async () => {
      // DAS EREIGNIS. Der Sync-Dienst legt B's Fassung an A's Originalnamen; A's
      // lokal geaenderte Fassung wird zur Konfliktkopie (konfliktModus 'kopie').
      const ueberschrieben = w.ladeMdHerunter(a, NOTE);
      if (ueberschrieben) aUeberschrieben = true;
      if (ueberschrieben && aWach) await a.modify(NOTE, 'sync');
    },
    async () => {
      const neu = w.ladeSidecarsHerunter(a);
      if (neu && aWach) await a.poll(NOTE);
    },
    async () => {
      if (w.ladeMdHerunter(b, NOTE)) await b.modify(NOTE, 'sync');
    },
    async () => {
      if (w.ladeSidecarsHerunter(b)) await b.poll(NOTE);
    },
  ];
  const tick = async (): Promise<void> => {
    if (aWach) await a.parkTick(NOTE);
    await b.parkTick(NOTE);
  };
  for (const e of k.reihenfolge) {
    await ereignisse[e]();
    await tick();
  }

  // --- Der Start ----------------------------------------------------------
  // Obsidian wird geoeffnet: neuer Prozess (leere Schreibspur, leerer Parkplatz,
  // keine Docs), danach der Start-Sweep und der erste Poll. Genau die Reihenfolge
  // aus `onLayoutReady`.
  // GEGENPROBE, hier erhoben — unmittelbar VOR dem Neustart und damit vor dem
  // Sweep: was liegt an fremdem Nachweis auf A's Platte? Ereignis 3 (A zieht
  // Hilfsdateien) kann VOR Ereignis 1 (B laedt hoch) liegen; dann hat A nur B's
  // ALTE Datei, und kein Verfahren, das den Nachweis braucht, kann greifen.
  const fremdBytes = a.vault._files.get(`.qollab/${NOTE}.bbbb2222.yjs`) as
    | ArrayBuffer
    | undefined;
  let fremdText = '';
  if (fremdBytes !== undefined) {
    try {
      fremdText = textFromUpdate(decodeStateFile(new Uint8Array(fremdBytes)).update);
    } catch {
      fremdText = '';
    }
  }
  const beweisDa = occ(fremdText, 'BBB') > 0;

  let sweepAngesehen = false;
  if (k.lage !== 'laufend') {
    await a.neustart();
    if (k.lage === 'neustart') {
      const angesehen = await a.sweep();
      sweepAngesehen = angesehen.includes(NOTE);
    }
    await a.poll(NOTE);
  }

  // --- Ruhephase: abwechselnd zustellen bis zum Fixpunkt -------------------
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
      await a.parkTick(NOTE);
      await b.parkTick(NOTE);
    }
  }

  const befund = bewerte(a.md(NOTE), b.md(NOTE), tokens);
  // Konfliktkopien des Sync-Dienstes UND Sicherungen des Plugins. Beide sind
  // dasselbe fuer die Frage „steht der Text noch irgendwo": eine Datei, die der
  // Nutzer oeffnen kann. Ohne die zweite Haelfte zaehlte die Messung einen
  // Verlust, den es nicht gibt.
  const alleKopien = [
    ...w.alleKopien(),
    ...[...a.kopien.values()].flat(),
    ...[...b.kopien.values()].flat(),
  ];
  const inKopie = befund.verlust.filter((t) => alleKopien.some((kk) => occ(kk, t) > 0));
  const stillVerloren = befund.verlust.filter((t) => !inKopie.includes(t));

  return {
    befund,
    tokens,
    inKopie,
    stillVerloren,
    sweepAngesehen,
    aUeberschrieben,
    parkungen: a.parkZaehler + b.parkZaehler,
    schranke: a.schrankeZaehler + b.schrankeZaehler,
    beweisDa,
  };
}

// Alle Permutationen von [0..n-1].
export function permutationen(n: number): number[][] {
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
