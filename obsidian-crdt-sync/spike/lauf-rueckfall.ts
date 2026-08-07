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

import * as Y from 'yjs';
import { Geraet } from './geraet';
import type { SweepSchranke } from '../src/sync-handler';
import { Wolke } from './wolke';
import { bewerteN, occ, type Befund } from './invarianten';
import { decodeStateFile } from '../src/state-file';
import { textFromUpdate, type DiffModus } from '../src/crdt-manager';
import { setzeGuidFolge, guidQuelleAn } from './guid-quelle';
import { setzeZufallSeed, zufallQuelleAn, seedAusKonfig } from './zufall-quelle';

export const NOTE = 'note.md';
const BASIS = 'kopf\nzeile-1\nzeile-2\nzeile-3\nfuss\n';
// Der letzte GEMEINSAME Stand: was beide Geraete tragen, bevor die Divergenzphase
// beginnt. Zugleich der Stand, auf den die Lage 'neustart-rueckspielung'
// zurueckfaellt — die Sicherung von gestern, das `git checkout`.
const GEMEINSAM = BASIS.replace('fuss\n', 'gemeinsam\nfuss\n');
const KLEIN = '00000000000000000000000000000000';
const GROSS = 'ffffffffffffffffffffffffffffffff';
const MITTE = '8888888888888888888888888888888888'.slice(0, 32);
// Die Kennungen des DRITTEN Geraets. Sie liegen zwischen MITTE und GROSS, damit C
// den Tie-Break der umkaempften Note weder gewinnt noch mit B gleichzieht. Sie
// werden NUR bei `geraete: 3` an die Folge gehaengt — mit zwei Geraeten ist die
// Kennungsfolge damit Zeichen fuer Zeichen die des Bestands.
const HOCH = 'cccccccccccccccccccccccccccccccc';

// DER EIGENE OFFLINE-BAUSTEIN. Er kommt in KEINER Hilfsdatei vor — weder in A's
// noch in B's —, denn er entsteht erst NACH der Zustellphase und ausserhalb von
// Obsidian. Genau daran haengt die Falsch-Positiv-Frage: eine Schranke, die ihn
// als „fremd erklaert" abstempelt, irrt sich nachweisbar.
export const OFFLINE = 'OOO';

// DIE OFFLINE GELOESCHTE ZEILE. Sie stammt aus dem Grundtext, steht also in
// BEIDEN Hilfsdateien und auf beiden Geraeten. Genau das macht sie zum haertesten
// Fall: eine Loeschung bringt KEINEN neuen Text mit, an dem ein inhaltliches
// Verfahren sie erkennen koennte — sie sieht aus wie „hier stand schon immer
// weniger". „Zurueckkehrende geloeschte Zeilen" ist zugleich das Ausschluss-
// kriterium des Produkts; parkt die Schranke eine bewusste Loeschung, macht sie
// genau das Problem groesser, an dem das Produkt ohnehin haengt.
export const GELOESCHT = 'zeile-2';

// DIE NOTIZ ALS PARAMETER. Der Bestand ist `NOTIZ_KLEIN` — die sechs Zeilen von
// oben, unveraendert. Alles, was der Treiber ueber die Notiz wissen muss, steht
// hier an EINER Stelle; damit laesst sich derselbe Aufbau mit einer realistisch
// grossen Notiz fahren, ohne dass irgendwo eine zweite Fassung der Zeilenlogik
// entsteht.
//
// WARUM DAS NOETIG IST: `threeWayMerge` verwirft Hunks ab etwa 500 Zeichen
// Kontextverschiebung STILL (text-merge.ts:36-49). Bei sechs Zeilen ist jede
// Verschiebung kleiner als das; ob die gemessenen Zahlen daran haengen, ist mit
// der kleinen Notiz allein nicht zu beantworten.
export interface Notiz {
  basis: string; // der Grundtext, mit dem beide Geraete starten
  gemeinsam: string; // basis + eine gemeinsame Zeile — der letzte geteilte Stand
  posA: number; // Zeilenindex, an dem A seinen Edit AAA einfuegt
  posB: number; // dito fuer B / BBB
  posOffline: number; // dito fuer den Offline-Baustein OFFLINE
  geloescht: string[]; // die bei geschlossener App entfernten Zeilen
  // Nur bei `geraete: 3`: der Zeilenindex des dritten Geraets (CCC). Bewusst
  // hinter B, damit alle drei Eingriffe an VERSCHIEDENEN Stellen sitzen — sonst
  // vermischte sich der Mehrgeraete-Fall mit dem Gleiche-Zeile-Fall.
  posC?: number;
  // Nur bei `editArt: 'gleiche-zeile'`: die GRUNDZEILE, die A und B BEIDE
  // veraendern. Sie muss im Grundtext genau einmal als ganze Zeile vorkommen.
  zeileGleich?: string;
}

export const NOTIZ_KLEIN: Notiz = {
  basis: BASIS,
  gemeinsam: GEMEINSAM,
  posA: 1,
  posB: 3,
  posOffline: 1,
  geloescht: [GELOESCHT],
  // GEMEINSAM ist `kopf/zeile-1/zeile-2/zeile-3/gemeinsam/fuss/''` — Index 5 setzt
  // C zwischen `gemeinsam` und `fuss`, also hinter B (Index 3).
  posC: 5,
  zeileGleich: 'zeile-2',
};

// Fuellwoerter der grossen Notiz. Bewusst klein geschrieben und ohne 'AAA',
// 'BBB', 'OOO' — sonst zaehlte `occ` Fuelltext als Messtoken mit.
const WOERTER = [
  'lorem',
  'ipsum',
  'dolor',
  'sit',
  'amet',
  'consectetur',
  'adipiscing',
  'elit',
  'sed',
  'eiusmod',
  'tempor',
  'incididunt',
  'labore',
  'dolore',
  'magna',
  'aliqua',
  'veniam',
  'quis',
  'nostrud',
];

// EINE REALISTISCH GROSSE NOTIZ: zwoelf Absaetze verschiedener Laenge, 105
// Textzeilen, elf Leerzeilen, 116 Zeilen und 6657 Zeichen (gemessen, nicht
// geschaetzt). Jede Zeile traegt vorn eine eindeutige Kennung (`p03z07`) — ohne
// sie waere keine Zeile als Teilstring von jeder anderen unterscheidbar und
// `occ` zaehlte falsch.
//
// Die Eingriffe liegen MITTENDRIN, nicht am Rand: A bei Zeile 40, B bei Zeile 83,
// die Loeschung bei Zeile 60. Zwischen A's und B's Edit liegen damit 2568
// Zeichen (gemessen) — das Fuenffache der 500, ab denen `threeWayMerge` still
// verwirft.
//
// `nah`: GEGENPROBE zur Gegenprobe. In der Fassung oben liegen B's Einfuegung
// (Zeile 83) und die Loeschung (Zeile 60) 1318 Zeichen auseinander — der
// Grundtext-Verlust der kleinen Notiz kann dort schon deshalb nicht auftreten.
// Mit `nah` setzt B seine Zeile UNMITTELBAR hinter die geloeschte, also in
// dieselbe Nachbarschaft wie im kleinen Aufbau. Ohne diese Fassung waere „bei
// grosser Notiz kein Grundtext-Verlust" eine Aussage ueber den Abstand der
// Eingriffe und nicht ueber die Groesse.
export function notizGross(nah = false): Notiz {
  const laengen = [7, 4, 12, 6, 9, 14, 5, 11, 8, 13, 6, 10];
  const zeilen: string[] = [];
  const textIndex: number[] = []; // Positionen der nicht-leeren Zeilen
  let nr = 0;
  for (let p = 0; p < laengen.length; p++) {
    if (p > 0) zeilen.push('');
    for (let z = 0; z < laengen[p]; z++) {
      const kennung = `p${String(p).padStart(2, '0')}z${String(z).padStart(2, '0')}`;
      const worte = 4 + ((p * 7 + z * 3) % 9);
      const text = Array.from(
        { length: worte },
        (_, i) => WOERTER[(nr + i * 5) % WOERTER.length]
      ).join(' ');
      textIndex.push(zeilen.length);
      zeilen.push(`${kennung} ${text}`);
      nr++;
    }
  }
  const basis = zeilen.join('\n') + '\n';
  // Die gemeinsame Zeile vor die LETZTE Textzeile — dasselbe Muster wie klein
  // (dort vor `fuss`).
  const mitGemeinsam = [...zeilen];
  mitGemeinsam.splice(mitGemeinsam.length - 1, 0, 'gemeinsam');
  const geloeschtIdx = textIndex[Math.floor(textIndex.length * 0.52)];
  return {
    basis,
    gemeinsam: mitGemeinsam.join('\n') + '\n',
    posA: textIndex[Math.floor(textIndex.length * 0.35)],
    // `nah`: eine Zeile HINTER die geloeschte — dieselbe Nachbarschaft wie klein
    // (dort loescht A `zeile-2`, B setzt BBB davor zwischen `zeile-2` und
    // `zeile-3`).
    posB: nah ? geloeschtIdx + 1 : textIndex[Math.floor(textIndex.length * 0.72)],
    posOffline: textIndex[Math.floor(textIndex.length * 0.35)],
    geloescht: [zeilen[geloeschtIdx]],
  };
}

// 'laufend'      — Obsidian laeuft auf A, waehrend der Sync die `.md`
//                  ueberschreibt. Das modify-Ereignis feuert, DAS TOR greift.
// 'neustart'     — Obsidian ist auf A geschlossen, waehrend die Dateien
//                  eintreffen. Danach Start: neuer Prozess, leere Schreibspur,
//                  leerer Parkplatz — und der Start-Sweep, der kein Tor hat.
// 'neustart-ohne-sweep' — MUTATIONSPROBE, kein Betriebszustand. Derselbe
//                  Neustart, aber der Sweep wird ausgelassen. Bleibt der Verlust
//                  hier aus, ist der Sweep die Ursache und nicht der Neustart an
//                  sich. Ohne diese Zelle waere die Zuschreibung geraten.
//
// DIE DREI FALSCH-POSITIV-LAGEN. In den drei Lagen oben ist A durchgehend
// geschlossen und tut NICHTS Eigenes — dort kann die Schranke gar nichts Eigenes
// wegparken, und ueber Falsch-Positive sagen sie folglich nichts. Die Lagen
// unten setzen genau da an: A aendert seine `.md` bei geschlossener App selbst.
//
// 'neustart-offline-edit' — der Nutzer tippt bei geschlossenem Obsidian in einem
//                  anderen Editor eine NEUE Zeile (`OFFLINE`). Sie steht in
//                  keiner Hilfsdatei. ERWARTUNG: die Schranke darf nicht greifen,
//                  der Baustein muss ueberleben.
// 'neustart-rueckspielung' — A's `.md` faellt vor dem Start auf den letzten
//                  gemeinsamen Stand zurueck (zurueckgespielte Sicherung,
//                  `git checkout`). Der eigene Edit AAA ist damit ZURUECKGENOMMEN.
//                  ERWARTUNG: die Schranke darf nicht greifen, der Sweep muss die
//                  Ruecknahme wie bisher erfassen.
// 'neustart-offline-loeschung' — der Nutzer LOESCHT bei geschlossenem Obsidian
//                  eine Zeile des Grundtexts (`GELOESCHT`). Der haerteste Fall:
//                  eine Loeschung bringt keinen neuen Text mit, an dem ein
//                  inhaltliches Verfahren die eigene Herkunft erkennen koennte.
//                  ERWARTUNG: die Schranke darf nicht greifen, die Zeile darf
//                  nicht zurueckkehren.
//
// DIE LAGE FUER DIE KAUSALITAETSFRAGE:
//
// 'laufend-loeschung' — Obsidian laeuft auf A die GANZE Zustellphase ueber, und
//                  ERST DANACH loescht der Nutzer die Zeile — im laufenden
//                  Betrieb, ueber den Adapter, mit Schreibspur und modify-Handler.
//                  Kein Neustart, kein Sweep.
//
//                  WOZU: In 'neustart-offline-loeschung' ist A waehrend der
//                  ganzen Zustellung ZU. Die Loeschung kann den fremden Stand
//                  dort per Bau nicht kennen — sie ist IMMER nebenlaeufig. Damit
//                  laesst sich die Frage „wie viel der zurueckkehrenden Zeilen
//                  ist legitimes Add-wins und wie viel ist Fehler?" gar nicht
//                  stellen. In dieser Lage haengt es an der Zustellordnung: liegt
//                  Ereignis 1 (B laedt hoch) VOR Ereignis 3 (A zieht Hilfsdateien
//                  und pollt), hat A B's Ops eingespielt, BEVOR es loescht — die
//                  Loeschung liegt dann KAUSAL DANACH. Sonst ist sie nebenlaeufig.
//                  Beide Faelle kommen in derselben Zelle vor und sind ueber
//                  `kannteFremd` einzeln auszaehlbar.
export type Lage =
  | 'laufend'
  | 'laufend-loeschung'
  | 'neustart'
  | 'neustart-ohne-sweep'
  | 'neustart-offline-edit'
  | 'neustart-rueckspielung'
  | 'neustart-offline-loeschung';

// DIE ZELLBASIS, portiert aus `spike/lauf.ts` auf `mess/verdopplung` (dort
// `Szenario`). Sie beschreibt, was VOR der Divergenzphase schon da war:
//
// 'geteilt' — Bestand dieses Treibers und einzige bisher gefahrene Zelle: beide
//             Geraete sind etabliert UND die umkaempfte Note hat bereits eine
//             gemeinsame Historie. Es gibt keinen Praegemoment.
// 'alltag'  — beide etabliert (eigene Hilfsdatei ueber die Kontext-Note), die
//             umkaempfte Note hat aber KEINE gemeinsame Historie. Beide koennen
//             sie unabhaengig praegen.
// 'rollout' — B ist frisch: keine eigene Hilfsdatei irgendwo. `.qollab/` trifft
//             verzoegert ein (`sperreBis`).
//
// WARUM DIE BEIDEN DAZUKOMMEN: Der frueher gefallene Geschwister-Abgleich
// (`geschwister-abgleich-widerlegt-2026-08-04.md`) erzeugte genau in `rollout`
// und `alltag` neuen STILLEN Verlust, waehrend `geteilt` sauber blieb. Ein
// Instrument, das nur `geteilt` kennt, kann diese Klasse von Schaden nicht sehen.
export type Zelle = 'geteilt' | 'rollout' | 'alltag';

// 'getrennt'     — Bestand: A und B setzen ihre Bausteine an VERSCHIEDENE Stellen.
//                  Bewusst so gebaut, damit das Ergebnis deterministisch bleibt.
// 'gleiche-zeile'— A und B aendern DIESELBE Grundzeile (`Notiz.zeileGleich`): aus
//                  `zeile-2` wird bei A `zeile-2 AAA`, bei B `zeile-2 BBB`. Damit
//                  konkurrieren die Einfuegungen an derselben Position und der
//                  YATA-Tie-Break entscheidet — deshalb ist die clientID-Folge
//                  hier tragend und nicht nur Beiwerk.
export type EditArt = 'getrennt' | 'gleiche-zeile';

export interface Konfig {
  lage: Lage;
  // Permutation von [0..5] bei zwei Geraeten, von [0..8] bei dreien.
  reihenfolge: number[];
  aWinnt: boolean;
  konfliktModus: 'kopie' | 'ohne' | 'ueberschreiben';
  // DER MESSSCHALTER. 'aus' = Bestand; der Seed haengt bewusst NICHT daran, damit
  // Bestand und Variante ueber DIESELBE Kennungs- und clientID-Folge laufen.
  schranke?: SweepSchranke;
  // DER ZWEITE MESSSCHALTER: die Op-Folge von `CrdtManager.setContent`. 'roh' =
  // Bestand. Der Seed haengt bewusst NICHT daran — Bestand und Kandidat laufen
  // ueber DIESELBE Kennungs- und clientID-Folge.
  diffModus?: DiffModus;
  // Ohne Angabe die sechs Zeilen des Bestands (`NOTIZ_KLEIN`). Der Seed haengt
  // bewusst NICHT daran — kleine und grosse Notiz laufen ueber dieselbe Kennungs-
  // und clientID-Folge.
  notiz?: Notiz;
  // GEGENPROBE zu jeder Lage: derselbe Neustart, aber der Sweep wird ausgelassen.
  // Bleibt ein Schaden auch hier, ist der Sweep nicht die Ursache. Die Lage
  // 'neustart-ohne-sweep' tut dasselbe fuer die drei alten Lagen; dieses Feld
  // macht es fuer JEDE Lage verfuegbar, ohne den Lagen-Typ aufzublaehen.
  ohneSweep?: boolean;
  // Ohne Angabe die bisherige Zellbasis `geteilt` — dann ist der Lauf mit dem
  // Bestand dieses Treibers identisch.
  zelle?: Zelle;
  // Nur 'rollout': wie viele Zustellschritte lang B's `.qollab/` leer bleibt.
  sperreBis?: number;
  // Ohne Angabe zwei Geraete — dann laeuft exakt der Bestandsaufbau, bis hin zur
  // Kennungsfolge und zur Zahl der Zustellereignisse.
  geraete?: 2 | 3;
  // Ohne Angabe 'getrennt' — der Bestand.
  editArt?: EditArt;
  // Nach WIE VIELEN Zustellereignissen greift der Nutzer ein? `0` = vor allen,
  // `3` = nach dem dritten. Ohne Angabe nach allen — der Bestand jeder
  // bisherigen Lage, Zahl fuer Zahl unveraendert.
  loeschungNach?: number;
  // DIAGNOSE: Zwischenstaende mitschreiben. Kostet Speicher und Zeit, deshalb
  // standardmaessig aus.
  spur?: boolean;
}

// Ein Zwischenstand: welche Grundzeile fehlt zu diesem Zeitpunkt auf welchem
// Geraet, und wie die beiden `.md` da aussehen.
//
// ZWEI MASSE, absichtlich beide: `fehlt*` ist das Mass, das `grundtextDa` seit
// jeher benutzt (`occ` — der Text kommt irgendwo vor). `ganz*` verlangt die
// Grundzeile als GANZE Zeile. Der Unterschied ist nicht akademisch: klebt ein
// fremder Baustein hinten an die Zeile (`zeile-2BBB`), ist die Zeile zerstoert,
// `occ` sieht sie aber weiter. Ohne das zweite Mass waere nicht zu sagen, ob die
// gemeldete Zahl zu hoch oder zu niedrig ist.
export interface Schritt {
  schritt: string;
  fehltA: string[];
  fehltB: string[];
  ganzA: string[];
  ganzB: string[];
  aMd: string;
  bMd: string;
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
  // MEHRDEUTIGKEITSPROBE (nur mit drei Geraeten ueberhaupt moeglich): wie oft lag
  // mehr als ein erklaerender Sibling vor, wie viele waren es insgesamt, und wie
  // oft haette 'basis-naechster' einen anderen als den ersten genommen (letzteres
  // wird nur in genau diesem Schalterstand gebildet).
  schrankeMehrfach: number;
  schrankeTreffer: number;
  schrankeAndereWahl: number;
  // AUFWANDSPROBE: dekodierte Geschwister-Texte, dieselbe Zahl beim fruehen
  // Ausstieg, und die Abstands-Diffs der Wahlregel.
  schrankeText: number;
  schrankeTextFrueher: number;
  schrankeAbstand: number;
  // AKTIVITAETSPROBE des Diff-Schalters: Wie oft hat er die Op-Folge von
  // `setContent` TATSAECHLICH veraendert? Bei 'roh' ist das per Bau 0.
  diffGeaendert: number;
  // GEGENPROBE ZUR PRAEMISSE, unabhaengig vom Eingriff gemessen: Lag B's
  // Hilfsdatei zum Sweep-Zeitpunkt auf A's Platte UND trug sie B's Edit? Nur dann
  // KANN die Schranke ueberhaupt etwas nachweisen. Wird auch mit ausgeschaltetem
  // Schalter erhoben — sie ist eine Eigenschaft der Zustellordnung, nicht des
  // Eingriffs.
  beweisDa: boolean;
  // DIE FALSCH-POSITIV-PROBE. Hat sich der Eingriff durchgesetzt, den der Nutzer
  // bei geschlossener App an A's `.md` vorgenommen hat?
  //   'neustart-offline-edit'  — `OFFLINE` steht am Ende in BEIDEN `.md`.
  //   'neustart-rueckspielung' — die Ruecknahme kam durch: AAA steht am Ende in
  //                              KEINER `.md`.
  //   'neustart-offline-loeschung' — die Loeschung kam durch: `GELOESCHT` steht
  //                              am Ende in KEINER `.md`. `false` heisst hier:
  //                              DIE GELOESCHTE ZEILE IST ZURUECK.
  // In den drei alten Lagen gibt es keinen Eingriff; dort ist das Feld `false`
  // und ohne Aussage.
  eingriffDurch: boolean;
  // Nur 'neustart-offline-edit': `OFFLINE` steht in keiner `.md` UND in keiner
  // Konfliktkopie und in keiner Sicherung — der eigene Offline-Edit ist STILL WEG.
  eingriffStillWeg: boolean;
  // DIE KAUSALITAETSPROBE. Nur in den beiden Loeschungs-Lagen belegt; sonst
  // `false` und ohne Aussage (`loeschLage` sagt, welches von beidem gilt).
  //
  // Erhoben UNMITTELBAR vor der Loeschung, aus dem Zustandsvektor von A's
  // lebendem Doc gegen den Zustandsvektor, den B's Doc direkt nach dem
  // BBB-Edit trug. Das ist die Kausalitaet im CRDT-Sinn (Lamport/Shapiro):
  // deckt A's Vektor B's Vektor in JEDEM Client ab, hat A B's Ops eingespielt,
  // die Loeschung liegt also KAUSAL DANACH. Sonst sind Loeschung und fremder
  // Edit NEBENLAEUFIG — und dann gewinnt der Add nach Shapiro et al. 2018 zu
  // Recht („a concurrent add and remove of the same element, the add wins").
  //
  // Bewusst NICHT am Text abgelesen: steht 'BBB' in A's Doc, kann es auch der
  // Sweep oder ein Diff aus der ueberschriebenen `.md` als A's EIGENE Ops
  // hineingeschrieben haben — das waere Textkenntnis ohne kausale Kenntnis. Der
  // Zustandsvektor kennt diesen Unterschied, der Text nicht.
  kannteFremd: boolean;
  // Dieselbe Frage am TEXT, zwei Wege, beide zum Zeitpunkt der Loeschung:
  //   `sahFremdMd`  — der Nutzer hat den fremden Baustein in der `.md` vor sich
  //                   gehabt, als er loeschte.
  //   `fremdImDoc`  — A's Doc trug den fremden Baustein, egal auf wessen Ops.
  // Beide sind Diagnose, nicht das Urteil: sie zeigen, wo Textkenntnis und
  // kausale Kenntnis auseinanderlaufen.
  sahFremdMd: boolean;
  fremdImDoc: boolean;
  // Ist diese Lage ueberhaupt eine Loeschungs-Lage? Ohne das Feld liest sich
  // `kannteFremd === false` in `neustart` wie ein Messwert, obwohl dort gar
  // nicht geloescht wird.
  loeschLage: boolean;
  // DAS K.O.-KRITERIUM, in ALLEN Lagen erhoben: Stehen die Zeilen des Grundtexts
  // am Ende noch in BEIDEN `.md`? Die Token-Bilanz oben sieht das nicht — sie
  // zaehlt nur AAA/BBB/OFFLINE. Ein Kandidat der Vorarbeiten bestand 5/5
  // Einzelfaelle und loeschte ueber 1152 Harness-Laeufe 100 % des Grundtexts;
  // ohne diese Zeile faellt so etwas hier nicht auf.
  grundtextDa: boolean;
  // DIAGNOSE zu `grundtextDa`: WELCHE Grundzeile fehlt am Ende, und WO. Ohne die
  // beiden Listen ist `grundtextDa === false` nur ein Alarm ohne Adresse.
  fehltA: string[];
  fehltB: string[];
  // Das STRENGERE Mass (siehe `Schritt`): die Grundzeile steht nicht mehr als
  // ganze Zeile da. `grundtextDa` bleibt unveraendert am alten Mass, damit die
  // Zahlen der Vorlaeufe vergleichbar bleiben.
  ganzFehltA: string[];
  ganzFehltB: string[];
  grundtextGanzDa: boolean;
  // Grundzeilen, die am Ende auf mindestens einem Geraet MEHRFACH als ganze Zeile
  // dastehen — das strenge Gegenstueck zu `Befund.doppel`.
  ganzDoppelt: string[];
  // Die Zwischenstaende — nur befuellt, wenn `Konfig.spur` gesetzt ist.
  spur: Schritt[];
}

// Der Seed haengt nur an Feldern, die es in beiden Lagen gibt — `lage` geht
// bewusst NICHT ein. So laufen beide Lagen ueber DIESELBE Kennungs- und
// clientID-Folge, und ein Unterschied im Ergebnis ist der Lage zuzuschreiben,
// nicht dem Wuerfel.
function seed(k: Konfig): number {
  return seedAusKonfig({
    szenario: k.zelle ?? 'geteilt',
    editfall: 'beide',
    reihenfolge: k.reihenfolge,
    aWinnt: k.aWinnt,
    konfliktModus: k.konfliktModus,
    sperreBis: k.sperreBis ?? 0,
  });
}

// DER ZUSTANDSVEKTOR eines lebenden Docs: Client -> hoechste bekannte Uhr.
//
// Er ist der einzige Weg, „hat dieses Geraet die Ops des anderen eingespielt?" zu
// beantworten, ohne den Text zu befragen — und der Text ist an genau dieser
// Stelle unbrauchbar: er sagt nur, dass der fremde Baustein DASTEHT, nicht, ob
// er ueber die fremden Ops hereinkam oder ueber einen eigenen Diff aus der
// ueberschriebenen `.md`. Das erste ist kausale Kenntnis, das zweite nicht.
//
// Loeschungen bewegen die Uhr nicht (sie erzeugen keine neuen Structs, nur
// Eintraege im DeleteSet). Fuer die Frage hier ist das genau richtig: es geht um
// die fremde EINFUEGUNG, und die zaehlt die Uhr.
function zustandsvektor(g: Geraet): Map<number, number> {
  if (!g.crdt.hasDoc(NOTE)) return new Map();
  try {
    return Y.decodeStateVector(Y.encodeStateVectorFromUpdate(g.crdt.encodeState(NOTE)));
  } catch {
    return new Map();
  }
}

export async function laufRueckfall(k: Konfig): Promise<Ergebnis> {
  const zelle = k.zelle ?? 'geteilt';
  const dreiGeraete = (k.geraete ?? 2) === 3;
  guidQuelleAn();
  zufallQuelleAn();
  setzeZufallSeed(seed(k));
  const folge = k.aWinnt
    ? [MITTE, KLEIN, MITTE, GROSS, GROSS]
    : [MITTE, GROSS, MITTE, KLEIN, KLEIN];
  // ANGEHAENGT, nicht eingemischt: mit zwei Geraeten bleibt die Folge woertlich die
  // des Bestands, und die Kalibrierung gegen die alten Zahlen ist gueltig.
  setzeGuidFolge(dreiGeraete ? [...folge, MITTE, HOCH, HOCH] : folge);

  const n = k.notiz ?? NOTIZ_KLEIN;
  const a = new Geraet('aaaa1111');
  const b = new Geraet('bbbb2222');
  const c = dreiGeraete ? new Geraet('cccc3333') : undefined;
  const geraete = c ? [a, b, c] : [a, b];
  for (const g of geraete) {
    // Die Frist des Produkts (PARK_FRIST_TICKS = 4). Ohne sie waere das Tor aus.
    g.parkFrist = 4;
    g.setzeSchranke(k.schranke ?? 'aus');
    g.setzeDiffModus(k.diffModus ?? 'roh');
  }
  const w = new Wolke(geraete);
  w.konfliktModus = k.konfliktModus;

  // Der Grundtext — jede nicht-leere Zeile aus der Basis. In der Loeschungs-Lage
  // sind die absichtlich geloeschten Zeilen ausgenommen: dort ist ihr
  // Verschwinden der Nutzerwille und kein Grundtext-Verlust. Bewusst HIER
  // gebildet und nicht erst am Ende — die Spur unten braucht dieselbe Liste, und
  // zwei Fassungen davon waeren zwei Messungen.
  // Beide Lagen, in denen der Nutzer eine Grundzeile ABSICHTLICH entfernt.
  const loeschLage =
    k.lage === 'neustart-offline-loeschung' || k.lage === 'laufend-loeschung';
  const grundzeilen = n.basis
    .split('\n')
    .filter((z) => z !== '' && !(loeschLage && n.geloescht.includes(z)));
  // DIE LISTE FUER DAS STRENGE MASS. Sie weicht in genau einem Fall von der obigen
  // ab: aendern A und B DIESELBE Zeile, steht sie danach als `zeile-2 AAA` bzw.
  // `zeile-2 BBB` da — als GANZE Zeile ist sie damit weg, und zwar auf Wunsch des
  // Nutzers. Sie hier mitzufuehren hiesse, jeden Lauf dieser Lage als K.o. zu
  // melden. Das lockere Mass (`occ`, Teilstring) behaelt sie: dort ist „der
  // Grundtext steckt noch drin" genau die richtige Frage.
  const grundzeilenGanz =
    k.editArt === 'gleiche-zeile'
      ? grundzeilen.filter((z) => z !== n.zeileGleich)
      : grundzeilen;
  const spur: Schritt[] = [];
  const fehlt = (text: string): string[] => grundzeilen.filter((z) => occ(text, z) === 0);
  const fehltGanz = (text: string): string[] => {
    const da = new Set(text.split('\n'));
    return grundzeilenGanz.filter((z) => !da.has(z));
  };
  // DIE STRENGE VERDOPPLUNG. `Befund.doppel` sieht ausschliesslich die drei
  // Marker AAA/BBB/OFFLINE — eine verdoppelte GRUNDTEXTZEILE faellt dort komplett
  // durch. Genau die waere aber der Preis, den die Gegenhypothese vorhersagt
  // (groebere Diffs -> mehr Zeichen mit neuen Item-IDs -> der Merge konkateniert
  // statt zu deduplizieren). Ohne dieses Mass ist „die Verdopplung steigt nicht"
  // eine Aussage ueber drei Marker und nicht ueber den Text.
  const doppeltGanz = (text: string): string[] => {
    const zahl = new Map<string, number>();
    for (const z of text.split('\n')) zahl.set(z, (zahl.get(z) ?? 0) + 1);
    return grundzeilenGanz.filter((z) => (zahl.get(z) ?? 0) > 1);
  };
  const halte = (schritt: string): void => {
    if (k.spur !== true) return;
    const aMd = a.md(NOTE);
    const bMd = b.md(NOTE);
    spur.push({
      schritt,
      fehltA: fehlt(aMd),
      fehltB: fehlt(bMd),
      ganzA: fehltGanz(aMd),
      ganzB: fehltGanz(bMd),
      aMd,
      bMd,
    });
  };

  // --- Ausgangslage --------------------------------------------------------
  // In 'geteilt' (Bestand): beide etabliert UND die Note hat gemeinsame Historie.
  // In 'alltag': beide etabliert, die Note ohne Historie. In 'rollout': B (und C)
  // sind frisch — sie fassen die Kontext-Note nie an und haben deshalb nirgends
  // eine eigene Hilfsdatei.
  const KTX = 'kontext.md';
  w.saeen(geraete, KTX, 'ktx\n');
  w.saeen(geraete, NOTE, n.basis);

  await a.tippe(KTX, 'ktx\nA-vorher\n');
  await a.modify(KTX);
  w.ladeMdHoch(a, KTX);
  w.ladeSidecarsHoch(a);
  w.ladeMdHerunter(b, KTX);
  if (c) w.ladeMdHerunter(c, KTX);

  let bGesperrt = zelle === 'rollout';
  if (zelle !== 'rollout') {
    w.ladeSidecarsHerunter(b);
    await b.poll(KTX);
    await b.tippe(KTX, 'ktx\nA-vorher\nB-vorher\n');
    await b.modify(KTX);
    w.ladeSidecarsHoch(b);
    w.ladeMdHoch(b, KTX);
    w.ladeSidecarsHerunter(a);
    await a.poll(KTX);
    if (c) {
      w.ladeMdHerunter(c, KTX);
      w.ladeSidecarsHerunter(c);
      await c.poll(KTX);
      await c.tippe(KTX, 'ktx\nA-vorher\nB-vorher\nC-vorher\n');
      await c.modify(KTX);
      w.ladeSidecarsHoch(c);
      w.ladeMdHoch(c, KTX);
      w.ladeSidecarsHerunter(a);
      await a.poll(KTX);
      w.ladeSidecarsHerunter(b);
      await b.poll(KTX);
    }
  }

  if (zelle === 'geteilt') {
    // EINE Inkarnation der umkaempften Note: A praegt, die anderen adoptieren,
    // alle konvergent.
    await a.tippe(NOTE, n.gemeinsam);
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
    if (c) {
      w.ladeMdHerunter(c, NOTE);
      w.ladeSidecarsHerunter(c);
      await c.modify(NOTE);
      await c.poll(NOTE);
      w.ladeSidecarsHoch(c);
      w.ladeMdHoch(c, NOTE);
      w.ladeSidecarsHerunter(a);
      await a.poll(NOTE);
      w.ladeSidecarsHerunter(b);
      await b.poll(NOTE);
    }
  }

  // --- Divergenzphase: je ein NUTZER-Edit, noch nicht ausgetauscht ---------
  const tokens: string[] = [];
  const editiere = async (g: Geraet, t: string, pos: number): Promise<void> => {
    tokens.push(t);
    const zeilen = g.md(NOTE).split('\n');
    if (k.editArt === 'gleiche-zeile') {
      // DIESELBE Zeile, nicht dieselbe Position: der Marker haengt sich an die
      // vorgefundene Grundzeile. Findet sie sich nicht (dann hat ein anderes
      // Geraet sie schon veraendert), faellt der Lauf auf das Einfuegen zurueck —
      // im gemessenen Aufbau tritt das nicht ein, weil die Edits vor jeder
      // Zustellung passieren.
      const i = zeilen.indexOf(n.zeileGleich ?? '');
      if (i >= 0) zeilen[i] = `${zeilen[i]} ${t}`;
      else zeilen.splice(Math.min(pos, zeilen.length - 1), 0, t);
    } else {
      zeilen.splice(Math.min(pos, zeilen.length - 1), 0, t);
    }
    const text = zeilen.join('\n');
    // Ueber den Adapter — ein Nutzer-Edit mit Editor-Autosave. Genau das, was die
    // Schreibspur als EIGEN erkennt und was danach in der eigenen Hilfsdatei steht.
    await g.tippe(NOTE, text);
    await g.modify(NOTE);
  };
  // AAA ist der Edit, um den es geht: A hat ihn getippt, er steht in A's `.md`
  // UND in A's eigener Hilfsdatei — und er ist noch NICHT hochgeladen.
  await editiere(a, 'AAA', n.posA);
  await editiere(b, 'BBB', n.posB);
  // DER BEZUGSPUNKT DER KAUSALITAETSPROBE: B's Zustandsvektor unmittelbar nach
  // dem BBB-Edit. Alles, was B zu diesem Zeitpunkt weiss — genau das muss A
  // eingespielt haben, damit A's spaetere Loeschung kausal DANACH liegt.
  const svB = zustandsvektor(b);
  // C setzt immer an eine EIGENE Stelle — auch im Gleiche-Zeile-Fall. Sonst
  // lieferte der Mehrgeraete-Lauf zwei Befunde in einem.
  if (c) {
    tokens.push('CCC');
    const zeilen = c.md(NOTE).split('\n');
    zeilen.splice(Math.min(n.posC ?? zeilen.length - 1, zeilen.length - 1), 0, 'CCC');
    await c.tippe(NOTE, zeilen.join('\n'));
    await c.modify(NOTE);
  }
  halte('vor-zustellung');

  // --- Zustellphase --------------------------------------------------------
  // Dieselben sechs Ereignisse wie in der Vorlage. Der Unterschied steckt in
  // `aWach`: ist A geschlossen, landen die Dateien auf der Platte, ohne dass ein
  // Handler feuert — genau so, wie es ein Sync-Dienst bei geschlossener App tut.
  const aWach = k.lage === 'laufend' || k.lage === 'laufend-loeschung';
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
      // 'rollout': B's `.qollab/` bleibt die ersten `sperreBis` Schritte leer.
      if (!bGesperrt && w.ladeSidecarsHerunter(b)) await b.poll(NOTE);
    },
  ];
  // DIE DREI EREIGNISSE DES DRITTEN GERAETS. Sie kommen HINTEN dran, damit die
  // Indizes 0..5 dieselben Ereignisse bezeichnen wie bisher — sonst waere keine
  // einzige Zustellordnung zwischen zwei und drei Geraeten vergleichbar.
  if (c) {
    ereignisse.push(
      async () => {
        w.ladeMdHoch(c, NOTE);
        w.ladeSidecarsHoch(c);
      },
      async () => {
        if (w.ladeMdHerunter(c, NOTE)) await c.modify(NOTE, 'sync');
      },
      async () => {
        if (w.ladeSidecarsHerunter(c)) await c.poll(NOTE);
      }
    );
  }
  const tick = async (): Promise<void> => {
    if (aWach) await a.parkTick(NOTE);
    await b.parkTick(NOTE);
    if (c) await c.parkTick(NOTE);
  };
  // --- Der Eingriff --------------------------------------------------------
  // Ohne `loeschungNach`: NACH der Zustellphase, VOR dem Start. Genau das
  // Zeitfenster, in dem Obsidian zu ist und trotzdem etwas an der `.md`
  // passiert — und der einzige Ort, an dem dieser Treiber in den `neustart`-Lagen
  // einen ECHTEN eigenen Vorgang erzeugen kann, den keine Hilfsdatei kennt.
  //
  // In den `neustart`-Lagen bewusst ueber `setMd` statt `tippe`: Der
  // Schreibvorgang laeuft NICHT ueber den Adapter dieses Prozesses — ein anderer
  // Editor, `git checkout`, ein Wiederherstellungs-Dialog. Der Zeitstempel
  // springt dabei ueber alles, was auf der Platte liegt (wie bei jedem echten
  // Schreibvorgang); damit sieht der Start-Sweep die Datei garantiert an, statt
  // sie am mtime-Gate zu ueberspringen. In `laufend-loeschung` dagegen ueber
  // `tippe` — dort IST es ein Vorgang dieses Prozesses.
  //
  // DIE KAUSALITAETSPROBE wird UNMITTELBAR VOR dem Eingriff genommen — und damit
  // vor jedem Neustart, der A's Doc ohnehin wegwerfen wuerde.
  let kannteFremd = false;
  let sahFremdMd = false;
  let fremdImDoc = false;
  let eingriffGetan = false;
  const eingriff = async (): Promise<void> => {
    if (eingriffGetan) return;
    eingriffGetan = true;
    const svVor = zustandsvektor(a);
    kannteFremd = svB.size > 0 && [...svB].every(([client, uhr]) => (svVor.get(client) ?? 0) >= uhr);
    sahFremdMd = occ(a.md(NOTE), 'BBB') > 0;
    fremdImDoc = a.crdt.hasDoc(NOTE) && occ(a.crdt.getContent(NOTE), 'BBB') > 0;

    if (k.lage === 'laufend-loeschung') {
      // DIESELBE Loeschung wie unten — aber im LAUFENDEN Betrieb: ueber den
      // Adapter (also mit Schreibspur, das Tor erkennt sie als eigen) und mit
      // feuerndem modify-Handler. Genau der Vorgang, den ein Nutzer ausloest, der
      // in der offenen App eine Zeile entfernt.
      await a.tippe(
        NOTE,
        a
          .md(NOTE)
          .split('\n')
          .filter((z) => !n.geloescht.includes(z))
          .join('\n')
      );
      await a.modify(NOTE);
    } else if (k.lage === 'neustart-offline-edit') {
      tokens.push(OFFLINE);
      const zeilen = a.md(NOTE).split('\n');
      zeilen.splice(Math.min(n.posOffline, zeilen.length - 1), 0, OFFLINE);
      a.setMd(NOTE, zeilen.join('\n'));
    } else if (k.lage === 'neustart-rueckspielung') {
      // Die Sicherung von gestern: der letzte gemeinsame Stand. A's eigener Edit
      // AAA ist damit zurueckgenommen — das ist der Nutzerwille, nicht ein Verlust.
      a.setMd(NOTE, n.gemeinsam);
    } else if (k.lage === 'neustart-offline-loeschung') {
      // Eine Zeile RAUS, die beide Geraete kennen. Was danach in der Datei steht,
      // ist eine echte Teilmenge dessen, was ohnehin ueberall bekannt ist — und
      // damit von „der Sync hat eine aeltere Fassung abgelegt" inhaltlich nicht
      // mehr zu unterscheiden.
      a.setMd(
        NOTE,
        a
          .md(NOTE)
          .split('\n')
          .filter((z) => !n.geloescht.includes(z))
          .join('\n')
      );
    }
    halte('nach-eingriff');
  };

  // DER ZEITPUNKT DES EINGRIFFS. Ohne Angabe: NACH der ganzen Zustellphase — der
  // Bestand aller bisherigen Lagen, Zahl fuer Zahl unveraendert.
  //
  // WOZU DER SCHALTER: Liegt die Loeschung hinter allen Ereignissen, kann DANACH
  // keine veraltete fremde `.md` mehr eintreffen — und genau dieser Weg ist der
  // interessante. Trifft eine fremde `.md`, die die Zeile noch traegt, NACH der
  // Loeschung ein, wird sie geparkt und die Frist loest per `unionMerge` auf;
  // Vereinigen kann nichts loeschen, die Zeile kaeme also zurueck. Ohne diesen
  // Schalter waere „0 fehlerhafte Wiederbelebungen" eine Aussage ueber genau EINE
  // Anordnung statt ueber den Raum.
  for (const [i, e] of k.reihenfolge.entries()) {
    if (i >= (k.sperreBis ?? 0)) bGesperrt = false;
    if (k.loeschungNach === i) await eingriff();
    await ereignisse[e]();
    await tick();
    halte(`zustell-${e}`);
  }
  bGesperrt = false;
  await eingriff();

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
  if (k.lage !== 'laufend' && k.lage !== 'laufend-loeschung') {
    await a.neustart();
    halte('nach-neustart');
    // Nur die MUTATIONSPROBE laesst den Sweep aus; jede andere Neustart-Lage
    // faehrt ihn — er ist der gemessene Pfad. `ohneSweep` macht dieselbe Probe
    // fuer jede Lage verfuegbar (Gegenprobe „liegt es am Sweep?").
    if (k.lage !== 'neustart-ohne-sweep' && k.ohneSweep !== true) {
      const angesehen = await a.sweep();
      sweepAngesehen = angesehen.includes(NOTE);
    }
    halte('nach-sweep');
    await a.poll(NOTE);
    halte('nach-poll');
  }

  // --- Ruhephase: abwechselnd zustellen bis zum Fixpunkt -------------------
  // Mit drei Geraeten wird aus dem Hin und Her ein RING (a->b->c->a). Mit zweien
  // bleibt es Paar fuer Paar genau die Folge des Bestands.
  const paare: Array<[Geraet, Geraet]> = c
    ? [
        [a, b],
        [b, c],
        [c, a],
      ]
    : [
        [a, b],
        [b, a],
      ];
  for (let i = 0; i < 8; i++) {
    for (const [sender, empfaenger] of paare) {
      w.ladeMdHoch(sender, NOTE);
      w.ladeSidecarsHoch(sender);
      if (w.ladeMdHerunter(empfaenger, NOTE)) await empfaenger.modify(NOTE, 'sync');
      if (w.ladeSidecarsHerunter(empfaenger)) await empfaenger.poll(NOTE);
      await empfaenger.poll(NOTE);
      await a.parkTick(NOTE);
      await b.parkTick(NOTE);
      if (c) await c.parkTick(NOTE);
      halte(`ruhe-${i}-${sender === a ? 'a' : sender === b ? 'b' : 'c'}`);
    }
  }

  const alleMd = geraete.map((g) => g.md(NOTE));
  const befund = bewerteN(alleMd, tokens);
  // Konfliktkopien des Sync-Dienstes UND Sicherungen des Plugins. Beide sind
  // dasselbe fuer die Frage „steht der Text noch irgendwo": eine Datei, die der
  // Nutzer oeffnen kann. Ohne die zweite Haelfte zaehlte die Messung einen
  // Verlust, den es nicht gibt.
  const alleKopien = [...w.alleKopien(), ...geraete.flatMap((g) => [...g.kopien.values()].flat())];
  const inKopie = befund.verlust.filter((t) => alleKopien.some((kk) => occ(kk, t) > 0));
  const stillVerloren = befund.verlust.filter((t) => !inKopie.includes(t));

  // Der Grundtext, auf ALLEN Geraeten. `grundzeilen` steht oben — dieselbe Liste,
  // die die Spur benutzt. Die beiden ausgewiesenen Listen bleiben A und B; mit
  // drei Geraeten geht C ueber die Sammelspalten unten mit ein.
  const fehltA = fehlt(a.md(NOTE));
  const fehltB = fehlt(b.md(NOTE));
  const grundtextDa = alleMd.every((t) => fehlt(t).length === 0);
  const ganzFehltA = fehltGanz(a.md(NOTE));
  const ganzFehltB = fehltGanz(b.md(NOTE));
  const grundtextGanzDa = alleMd.every((t) => fehltGanz(t).length === 0);
  const ganzDoppelt = [...new Set(alleMd.flatMap((t) => doppeltGanz(t)))];
  halte('ende');

  // Der Eingriff, aus allen `.md` am Ende abgelesen.
  const daA = occ(a.md(NOTE), OFFLINE) > 0;
  const daB = alleMd.slice(1).every((t) => occ(t, OFFLINE) > 0);
  const aaaWeg = alleMd.every((t) => occ(t, 'AAA') === 0);
  // Die geloeschte Zeile ist NIRGENDS mehr — die Loeschung wurde erfasst und
  // propagiert. Der Gegenfall ist der Schaden: sie ist ZURUECKGEKEHRT.
  const zeileWeg = n.geloescht.every((z) => alleMd.every((t) => occ(t, z) === 0));
  const summe = (f: (g: Geraet) => number): number =>
    geraete.reduce((s, g) => s + f(g), 0);
  const eingriffDurch =
    k.lage === 'neustart-offline-edit'
      ? daA && daB
      : k.lage === 'neustart-rueckspielung'
        ? aaaWeg
        : loeschLage
          ? zeileWeg
          : false;
  const eingriffStillWeg =
    k.lage === 'neustart-offline-edit' &&
    !daA &&
    !daB &&
    !alleKopien.some((kk) => occ(kk, OFFLINE) > 0);

  return {
    befund,
    tokens,
    inKopie,
    stillVerloren,
    sweepAngesehen,
    aUeberschrieben,
    parkungen: summe((g) => g.parkZaehler),
    schranke: summe((g) => g.schrankeZaehler),
    schrankeMehrfach: summe((g) => g.schrankeMehrfachZaehler),
    schrankeTreffer: summe((g) => g.schrankeTrefferZaehler),
    schrankeAndereWahl: summe((g) => g.schrankeAndereWahlZaehler),
    schrankeText: summe((g) => g.schrankeTextZaehler),
    schrankeTextFrueher: summe((g) => g.schrankeTextFrueherZaehler),
    schrankeAbstand: summe((g) => g.schrankeAbstandZaehler),
    diffGeaendert: summe((g) => g.diffGeaendert),
    beweisDa,
    eingriffDurch,
    eingriffStillWeg,
    kannteFremd,
    sahFremdMd,
    fremdImDoc,
    loeschLage,
    grundtextDa,
    fehltA,
    fehltB,
    ganzFehltA,
    ganzFehltB,
    grundtextGanzDa,
    ganzDoppelt,
    spur,
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

function fakultaet(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

// Die i-te Permutation von [0..n-1] in derselben (lexikographischen) Ordnung, die
// `permutationen` aufzaehlt — ueber das Fakultaets-Zahlensystem, also ohne die
// Liste zu bauen. Mit drei Geraeten sind es 9! = 362.880 Ordnungen; sie alle im
// Speicher zu halten, nur um daraus jede k-te zu nehmen, waere reine Verschwendung.
export function permutationNr(n: number, i: number): number[] {
  const rest = Array.from({ length: n }, (_, x) => x);
  const aus: number[] = [];
  let r = i;
  for (let k = n - 1; k >= 0; k--) {
    const f = fakultaet(k);
    const idx = Math.floor(r / f);
    r -= idx * f;
    aus.push(rest.splice(idx, 1)[0]);
  }
  return aus;
}

// DIE BEWUSSTE KUERZUNG. Jede `schritt`-te Zustellordnung, beginnend bei 0. Bei
// n = 9 und schritt = 504 sind das genau 720 Ordnungen — dieselbe Zellgroesse wie
// die vollstaendige Aufzaehlung bei zwei Geraeten, und die Stichprobe ist ueber
// die ersten beiden Ereignisplaetze exakt gleichverteilt (9!/504 = 720, 8!/504 =
// 80, 7!/504 = 10). Systematisch statt zufaellig: sie ist damit ohne Seed
// reproduzierbar und traegt keine Klumpen.
export function stichprobe(n: number, schritt: number): number[][] {
  const gesamt = fakultaet(n);
  const aus: number[][] = [];
  for (let i = 0; i < gesamt; i += schritt) aus.push(permutationNr(n, i));
  return aus;
}
