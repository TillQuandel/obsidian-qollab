// Persistenz-Format der .yjs-Sidecar-Dateien mit Doc-GUID-Header.
//
// GESCHRIEBEN wird ausschließlich QLB2:
//
//   [ 'QLB2' (4 ASCII) | FNV-1a über GUID+Update (4, LE) | 16 B GUID (roh) | Update (Rest) ]
//
// GELESEN werden drei Formen — alle drei sind Pflicht, weil sonst das Update
// selbst der Datenverlust wäre:
//
//   QLB2   wie oben, mit Integritätsprüfung.
//   QLB1   [ 'QLB1' (4) | 16 B GUID (roh) | Update (Rest) ] — die eigenen Dateien
//          bis v0.4.0. Sie werden beim nächsten `saveState` als QLB2 neu
//          geschrieben; eine Migration braucht es dafür nicht.
//   Legacy (v0.1) headerlos: guid = null, gesamter Inhalt ist das Update.
//
// Die GUID kennzeichnet eine Note-Inkarnation: Löschen + gleichnamige Neuanlage
// erzeugt eine neue GUID, sodass stale fremde .yjs-Dateien einer alten
// Inkarnation erkannt und nicht mehr in die neue gemergt werden (Zombie-Fix).
//
// WARUM DER HASH — gemessen, nicht vermutet (`spike/zzS3-nullfuellung.spec.ts`
// auf `mess/verdopplung`): Eine nullgefüllte Sidecar bei ERHALTENER Größe (der
// dokumentierte OneDrive-/NTFS-Auslöser) parst fehlerfrei. Über alle 391
// Schnittstellen einer 40-Zeilen-Sidecar gemessen, zerfällt der Schaden in zwei
// Klassen:
//   - 19 Fälle: Kopf intakt, Nutzlast trägt gar nichts. Die fängt seit dem
//     Vorgänger-Commit das Prädikat `isNulledYjsState` (crdt-manager.ts).
//   - 367 Fälle: Nutzlast TEILWEISE intakt. Yjs wirft nicht, `carriesYjsOps`
//     sagt `true`, und der Grundtext ist trotzdem still verfälscht. Kein Prädikat
//     auf dem Inhalt kann das erkennen — der Inhalt IST ja plausibel. Deshalb ein
//     Nachweis VOR dem Inhalt, und deshalb ein Formatwechsel.
//
// ZWEI ENTSCHEIDUNGEN AUS DER MESSUNG:
//   1. Der Hash deckt GUID + Update, nicht nur das Update (Spike G1). Sonst
//      passierte eine Verfälschung, die ausschließlich die GUID trifft,
//      ungebremst — und an der GUID hängt die gesamte Inkarnations-/Zombie-Abwehr.
//   2. Kein 4-Byte-Längenfeld (Spike D). Es trug in 0 von 367 Fällen bei: Die
//      Nullfüllung ERHÄLT die Größe, ein Längenfeld sieht sie deshalb nie. 367×
//      fing der Hash, 0× die Länge. Vier Byte, die nur Format kosten.
// Der Hash steht VOR der GUID: eine Nullfüllung, die ihn überhaupt erreicht,
// trifft damit zwangsläufig auch GUID und Update — es gibt kein Fenster, in dem
// der Nachweis schon weg ist und der Inhalt noch „gesund" aussieht.
//
// BEWUSSTER KOMPATIBILITÄTSBRUCH MIT v0.4.0 — nicht überraschen lassen.
// Ein Peer auf v0.4.0 kennt nur 'QLB1'; eine QLB2-Datei sieht für ihn headerlos
// aus (`guid: null`). Gemessen am eingefrorenen Release-Code, zwei Stufen
// (`tests/versionsuebergang-mischflotte.test.ts`, R6):
//   1. Solange er keinen eigenen GUID-Stand hat, meldet er sie immerhin als
//      korrupt — er reicht den ganzen Dateiinhalt an `Y.applyUpdate`, und das
//      wirft. Der Stand darin bleibt für ihn trotzdem unsichtbar: er prägt eine
//      EIGENE Inkarnation, statt unsere zu adoptieren. Ab hier Split-Brain.
//   2. Sobald er einen eigenen Stand geschrieben hat, greift seine R1-Regel
//      (`_v040/sync-handler.ts`): die vermeintliche v0.1-Leiche wird OHNE MELDUNG
//      von der Platte gelöscht — und der Datei-Sync trägt die Löschung zu uns
//      zurück.
// Der Besitzer hat den Bruch in Kauf genommen; die Konsequenz ist, dass ein Vault
// nicht gemischt betrieben werden darf. Diese Richtung ist nicht reparabel — sie
// liegt im ausgelieferten v0.4.0-Code, nicht hier. Die Gegenrichtung ist
// abgesichert: dieses Modul liest QLB1 weiter.

const MAGIC1 = new Uint8Array([0x51, 0x4c, 0x42, 0x31]); // 'Q','L','B','1'
const MAGIC2 = new Uint8Array([0x51, 0x4c, 0x42, 0x32]); // 'Q','L','B','2'
const MAGIC_BYTES = 4;
const GUID_BYTES = 16;
const HASH_BYTES = 4;
const HEADER1_LEN = MAGIC_BYTES + GUID_BYTES; // 20
// QLB2: der Hash sitzt zwischen Magic und GUID, gedeckt ist alles ab GUID_OFFSET.
const GUID_OFFSET = MAGIC_BYTES + HASH_BYTES; // 8
const HEADER2_LEN = GUID_OFFSET + GUID_BYTES; // 24

// Eine Datei, die sich als QLB2 ausweist, deren Inhalt aber nicht zum
// mitgeschriebenen Nachweis passt. Eigene Fehlerklasse, damit der Aufrufer sie
// von einem IO-Fehler trennen kann: die Datei ist da und lesbar, nur ihr Inhalt
// ist nicht der, der geschrieben wurde.
export class StateFileIntegrityError extends Error {
  constructor(public readonly reason: string) {
    super(`QLB2-Integritaetspruefung fehlgeschlagen: ${reason}`);
    this.name = 'StateFileIntegrityError';
  }
}

// FNV-1a, 32 Bit. Kein kryptographischer Anspruch — abgewehrt wird ein
// zerrissener Schreib-/Sync-Vorgang, kein Angreifer. Gemessen: 0 Kollisionen
// über 18.200 echte Nullfüllungen (Spike E4).
export function hashBytes(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Neue Doc-GUID: 16 zufällige Bytes als 32-Hex-String.
export function generateGuid(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(GUID_BYTES)));
}

// Schreibt eine .yjs-Datei — immer QLB2.
export function encodeStateFile(guid: string, update: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER2_LEN + update.length);
  out.set(MAGIC2, 0);
  out.set(hexToBytes(guid), GUID_OFFSET);
  out.set(update, HEADER2_LEN);
  writeU32LE(out, MAGIC_BYTES, hashBytes(out.subarray(GUID_OFFSET)));
  return out;
}

function writeU32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function startsWith(bytes: Uint8Array, magic: Uint8Array): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

// Liest eine .yjs-Datei: QLB2 (geprüft), QLB1 (ungeprüft) oder headerlose
// v0.1-Legacy. Wirft `StateFileIntegrityError`, wenn eine QLB2-Datei ihren
// eigenen Nachweis verfehlt — der Aufrufer behandelt das über den bestehenden
// Korrupt-Weg (melden, überspringen, NIE löschen).
export function decodeStateFile(bytes: Uint8Array): {
  guid: string | null;
  update: Uint8Array;
} {
  if (startsWith(bytes, MAGIC2)) {
    // Zu kurz für den eigenen Kopf: das ist keine Legacy-Datei, sondern eine
    // abgeschnittene eigene. Sie als headerlos durchzureichen hieße, ihre
    // Kopf-Bytes als Yjs-Update auszugeben.
    if (bytes.length < HEADER2_LEN) throw new StateFileIntegrityError('Kopf unvollstaendig');
    const gedeckt = bytes.subarray(GUID_OFFSET);
    if (hashBytes(gedeckt) !== readU32LE(bytes, MAGIC_BYTES)) {
      throw new StateFileIntegrityError('Hash');
    }
    return {
      guid: bytesToHex(bytes.subarray(GUID_OFFSET, HEADER2_LEN)),
      update: bytes.subarray(HEADER2_LEN),
    };
  }
  // QLB1: die eigenen Dateien bis v0.4.0. Kein Nachweis vorhanden, also auch
  // keiner zu prüfen — sie werden gelesen wie bisher und beim nächsten
  // `saveState` als QLB2 ersetzt.
  if (bytes.length >= HEADER1_LEN && startsWith(bytes, MAGIC1)) {
    return {
      guid: bytesToHex(bytes.subarray(MAGIC_BYTES, HEADER1_LEN)),
      update: bytes.subarray(HEADER1_LEN),
    };
  }
  return { guid: null, update: bytes };
}
