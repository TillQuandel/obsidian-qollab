// DIE ATOMARE ZUSTELLUNG — TEIL 1: DIE LAGEN IN DER ZELLE `geteilt`.
//
// DIE HYPOTHESE, DIE HIER AUF DEM PRUEFSTAND STEHT: Reisen `.md` und Hilfsdatei
// eines Geraets ATOMAR (wie in einem Git-Commit) statt als zwei unabhaengige
// Dateien, dann verschwinden zwei gemessene Restprobleme —
//
//   1. der stille Verlust von 60/720 in der Lage `neustart` (der Nachweis liegt
//      nur in 360 von 720 Ordnungen vor, wenn der Sweep laeuft), und
//   2. die Wiederbelebung geloeschter Zeilen beim Erstkontakt.
//
// DAS IST EINE ERWARTUNG, KEIN ERGEBNIS. Diese Datei darf sie widerlegen.
//
// DIE GEGENPROBE STEHT IN JEDER ZEILE MIT: `NOTIZ OHNE NACHWEIS` zaehlt die
// Laeufe, in denen zum Sweep-Zeitpunkt die FREMDE `.md` auf A's Platte lag, ihre
// Hilfsdatei aber nicht. Genau diesen Zustand soll Atomaritaet unmoeglich machen.
// Steht dort unter 'atomar' keine 0 — oder unter 'datei' eine —, ist der Umbau
// kaputt und keine andere Zahl dieser Datei sagt etwas aus.
//
// WARUM NICHT `Beweis da` ALLEIN: Der Zaehler faellt auch dann auf `false`, wenn
// B ueberhaupt noch nichts hochgeladen hat — dann fehlt zwar der Nachweis, aber
// eben auch die fremde Notiz, und es gibt gar nichts falsch zu diffen. `Beweis
// da` misst die Zustellordnung, `NOTIZ OHNE NACHWEIS` misst die Atomaritaet.
//
// Zellbasis: die VOLLSTAENDIGEN 720 Zustellordnungen je Zelle, nichts gekuerzt.

import { permutationen, permutationNr, type Lage, type Transport } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);
// Die Rauchprobe faehrt jede 30-te Ordnung — 24 statt 720. Sie taugt NUR als
// Aktivitaetsprobe des Schalters, nicht als Messwert; jede Zahl daraus waere
// ueber eine gekuerzte Zellbasis erhoben.
const RAUCH = Array.from({ length: 24 }, (_, i) => permutationNr(6, i * 30));

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  // Der BESTAND vor `88ef6fe` — nur mit ausdruecklich gesetzten Schaltern zu
  // bekommen, seit beide Kandidaten Standard sind.
  ['roh', 'aus'],
  // Der PRODUKTIVE Stand seit `88ef6fe`.
  ['semantisch', 'basis-signatur'],
];
const TRANSPORTE: Transport[] = ['datei', 'atomar'];

async function tabelle(
  lagen: Lage[],
  ordnungen: number[][],
  transporte: Transport[] = TRANSPORTE
): Promise<Array<{ name: string; s: string; z: Awaited<ReturnType<typeof messe>> }>> {
  const aus: Array<{ name: string; s: string; z: Awaited<ReturnType<typeof messe>> }> = [];
  for (const lage of lagen) {
    for (const [diffModus, schranke] of STAENDE) {
      for (const transport of transporte) {
        const z = await messe(
          {
            lage,
            aWinnt: true,
            konfliktModus: 'ueberschreiben',
            schranke,
            diffModus,
            transport,
          },
          ordnungen
        );
        const name = `${lage} | ${diffModus}/${schranke} | ${transport}`;
        const s = zeile(name, z);
        aus.push({ name, s, z });
        // eslint-disable-next-line no-console
        console.log(s);
      }
    }
  }
  return aus;
}

describe('Atomare Zustellung — Lagen in Zelle geteilt', () => {
  it('Rauchprobe: der Transport-Schalter aendert die Zustellung ueberhaupt', async () => {
    const r = await tabelle(['neustart'], RAUCH);
    // eslint-disable-next-line no-console
    console.log('\n===== RAUCHPROBE (24 von 720 Ordnungen) =====\n' + r.map((x) => x.s).join('\n'));
    const datei = r.filter((x) => x.name.endsWith('datei'));
    const atomar = r.filter((x) => x.name.endsWith('atomar'));
    // Der Riegel: unter 'datei' MUSS es Laeufe geben, in denen die Notiz ohne
    // ihren Nachweis ankam — sonst misst die Gegenprobe nichts.
    expect(datei.every((x) => x.z.notizOhneNachweis > 0)).toBe(true);
    // Und unter 'atomar' darf es keinen einzigen geben.
    expect(atomar.every((x) => x.z.notizOhneNachweis === 0)).toBe(true);
  });

  it('misst die Lage neustart — der stille Verlust', async () => {
    const r = await tabelle(['neustart'], PERMS);
    // eslint-disable-next-line no-console
    console.log('\n===== ATOMAR · LAGE neustart =====\n' + r.map((x) => x.s).join('\n'));

    // KALIBRIERUNG. Die veroeffentlichten Zahlen aus `herkunft-2026-08-07.md`
    // muessen unter 'datei' ziffernweise stehen — sonst ist der Umbau kaputt und
    // keine Zahl der Vergleichsspalte sagt etwas aus.
    const bestand = r.find((x) => x.name === 'neustart | roh/aus | datei')!.z;
    expect(bestand.n).toBe(720);
    expect(bestand.stillVerloren).toBe(240);
    expect(bestand.doppel).toBe(256);
    expect(bestand.divergenz).toBe(0);
    expect(bestand.schranke).toBe(0);
    expect(bestand.beweisDa).toBe(360);
    expect(bestand.ganzWeg).toBe(0);

    const produktiv = r.find(
      (x) => x.name === 'neustart | semantisch/basis-signatur | datei'
    )!.z;
    expect(produktiv.stillVerloren).toBe(60);
    expect(produktiv.doppel).toBe(76);
    expect(produktiv.divergenz).toBe(0);
    expect(produktiv.schranke).toBe(180);
    expect(produktiv.beweisDa).toBe(360);
    expect(produktiv.ganzWeg).toBe(0);

    // GEGENPROBE, in der vollen Zellbasis.
    expect(r.filter((x) => x.name.endsWith('atomar')).every((x) => x.z.notizOhneNachweis === 0)).toBe(
      true
    );
    expect(r.filter((x) => x.name.endsWith('datei')).every((x) => x.z.notizOhneNachweis > 0)).toBe(
      true
    );
  });

  // DER KONTROLLARM ZUM EINWAND GEGEN DEN AUFBAU. Unter 'atomar' zieht A das
  // Paket zweimal (Ereignis 2 und 3), im Bestand kommt die fremde `.md` nur
  // einmal (Ereignis 2). Ein Teil des Unterschieds koennte also an der groesseren
  // Zustellmenge haengen und nicht an der Atomaritaet. 'atomar-einmal' zieht je
  // Geraet nur EIN Paket — weniger Zustellung als der Bestand, nicht mehr.
  //
  // ZELLBASIS AUSDRUECKLICH ANDERS: 720 Laeufe, aber nur 24 VERSCHIEDENE
  // Zustellordnungen (je 30-mal), weil zwei der sechs Ereignisse nichts tun. Die
  // Zeile ist deshalb NICHT mit den beiden anderen Armen gepaart — sie
  // beantwortet nur die Ja/Nein-Frage, ob der Gewinn die halbierte Zustellung
  // ueberlebt.
  it('Kontrollarm: dasselbe mit nur EINEM Paket je Geraet', async () => {
    const r = await tabelle(['neustart'], PERMS, ['atomar-einmal']);
    // eslint-disable-next-line no-console
    console.log('\n===== ATOMAR · KONTROLLARM (je Geraet ein Paket) =====\n' +
      r.map((x) => x.s).join('\n'));
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.z.notizOhneNachweis === 0)).toBe(true);
  });

  it('misst die beiden Loeschungs-Lagen — die Wiederbelebung', async () => {
    const r = await tabelle(['neustart-offline-loeschung', 'laufend-loeschung'], PERMS);
    // eslint-disable-next-line no-console
    console.log('\n===== ATOMAR · LOESCHUNGS-LAGEN =====\n' + r.map((x) => x.s).join('\n'));
    expect(r).toHaveLength(8);
    // In beiden Lagen MUSS geloescht worden sein — sonst ist die Spalte WIEDER
    // eine ungestellte Frage und keine Null.
    expect(r.every((x) => x.z.loeschLauf === 720)).toBe(true);
  });
});
