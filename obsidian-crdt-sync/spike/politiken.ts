// Die Varianten. Alle greifen an GENAU EINER Stelle ein: dem Moment, in dem
// `ensureDoc` eine frische Inkarnation praegen wuerde (kein Doc im Speicher,
// kein eigener Zustand auf der Platte, nichts Adoptierbares). Kein Eingriff in
// `src/`.
//
// Vorbild im Bestand: der Startup-Sweep bricht seit Task 13/B an genau dieser
// Bedingung ab (`main.ts:1283` — „ohne eigene Sidecar nur dann snapshotten, wenn
// eine adoptierbare fremde Sidecar vorliegt"). Die Varianten fragen, was
// passiert, wenn der modify-Pfad dasselbe tut.

import type { Geraet, Praegepolitik } from './geraet';
import { NOTE, type Fabrik } from './lauf';

// Der Bestand: es wird immer gepraegt.
export const heute: Fabrik = () => ({ a: async () => true, b: async () => true });

// Nie praegen, solange es nichts zu adoptieren gibt. Die Note bleibt bis zum
// Eintreffen einer fremden Hilfsdatei ausserhalb des CRDT — der Datei-Sync ist
// dann ihr einziges Netz (inklusive seiner Konfliktkopien).
export const aufschubUnbegrenzt: Fabrik = () => ({
  a: async () => false,
  b: async () => false,
});

// Pro Note: K Ausloeser lang aufschieben, danach doch praegen. Das Wartefenster
// in seiner billigsten Form — aber am Praegemoment statt an einer Ankuendigung.
export const fristProNote =
  (k: number): Fabrik =>
  () => {
    const p: Praegepolitik = async (g, pfad) => (g.aufschuebe.get(pfad) ?? 0) >= k;
    return { a: p, b: p };
  };

// Karenz nach dem Beitritt: Solange das Geraet noch KEINE eigene Hilfsdatei im
// Vault hat (= es ist hier neu) und der Vorgang noch in den ersten K Schritten
// steckt, wird aufgeschoben. Danach Verhalten wie heute.
//
// Das ist der Versuch, die gemessene Trennung zu nutzen: das Wartefenster wirkt
// bei aktivem Peer (0,01 %), versagt im Rollout — also nur den Rollout behandeln.
export const karenzNachBeitritt =
  (k: number): Fabrik =>
  (_a, _b, schritt) => {
    const p: Praegepolitik = async (g) => {
      if (schritt() >= k) return true;
      return await g.hatEigenePraesenz();
    };
    return { a: p, b: p };
  };

// ORAKEL (Obergrenze): Aufschieben genau dann, wenn der Peer fuer diese Note
// bereits eine Inkarnation hat, die uns nur noch nicht erreicht hat. Nicht
// baubar — misst, was mit perfektem Wissen ueberhaupt erreichbar waere.
export const orakel: Fabrik = (a, b) => {
  const mach =
    (peer: Geraet): Praegepolitik =>
    async () => {
      const peerHatKennung =
        peer.crdt.hasDoc(NOTE) ||
        [...(peer.vault._files.keys() as Iterable<string>)].some((p) => p.includes(NOTE));
      return !peerHatKennung;
    };
  return { a: mach(b), b: mach(a) };
};

// GEGENPROBE, ausserhalb der Praegefrage: kein Eingriff am Praegemoment,
// sondern der `.md`-Kanal wird als Quelle EIGENER Ops stillgelegt. Zeigt, ob der
// Hebel dort liegt statt bei der Praegung.
//
// ORAKEL-Vorbehalt: kennt `vonSync` als Grundwahrheit. Das baubare
// Herkunftssignal kann Sync-Overwrite und externen Editor nicht trennen —
// deshalb wirft dieselbe Variante mit `externEdit` den externen Edit weg.
export const ohneFremdErfassung: Fabrik = (a, b) => {
  a.fremdErfassungAus = true;
  b.fremdErfassungAus = true;
  return { a: async () => true, b: async () => true };
};

// PARKEN mit Frist. Fremder Inhalt (Signal: „nicht von diesem Prozess
// geschrieben") wird NICHT als eigene Op erfasst, sondern gemerkt; der
// Write-Back ruht solange. Loest sich das Parken auf (die Hilfsdatei trifft ein
// und deckt den Text), ist nie eine eigene Op entstanden. Laeuft die Frist ab,
// wird der Stand DOCH erfasst — Bestandsverhalten, nur N Ticks spaeter.
//
// `Infinity` ist die reine Verweigerung: nie erfassen.
export const parken =
  (frist: number): Fabrik =>
  (a, b) => {
    for (const g of [a, b]) g.parkFrist = frist;
    return { a: async () => true, b: async () => true };
  };

// Dieselbe Politik, aber mit waehlbarem Verfahren fuer den Fall, dass die
// Fremdhistorie NACH dem Nachtrag eintrifft. Siehe `SyncHandler.nachtragVerfahren`.
export const parkenMit =
  (frist: number, verfahren: 'ersetzen' | 'undo' | 'korrigieren' | 'schnitt' | 'adoptieren'): Fabrik =>
  (a, b) => {
    for (const g of [a, b]) {
      g.parkFrist = frist;
      g.sync.nachtragVerfahren = verfahren;
    }
    return { a: async () => true, b: async () => true };
  };
