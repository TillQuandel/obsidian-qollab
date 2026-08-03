// Persistenz-Format der .yjs-Sidecar-Dateien mit Doc-GUID-Header.
//
//   [ 'QLB1' (4 ASCII-Bytes Magic) | 16 Bytes GUID (roh) | Yjs-Update (Rest) ]
//
// Die GUID kennzeichnet eine Note-Inkarnation: Löschen + gleichnamige Neuanlage
// erzeugt eine neue GUID, sodass stale fremde .yjs-Dateien einer alten
// Inkarnation erkannt und nicht mehr in die neue gemergt werden (Zombie-Fix).
//
// Legacy-Dateien (ohne Magic) werden weiter gelesen: guid = null, gesamter
// Inhalt ist das Update. Sie sind kompatibel mit allem und werden beim nächsten
// saveState ins neue Format überschrieben.

const MAGIC = new Uint8Array([0x51, 0x4c, 0x42, 0x31]); // 'Q','L','B','1'
const GUID_BYTES = 16;
const HEADER_LEN = MAGIC.length + GUID_BYTES; // 20

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

// Schreibt eine .yjs-Datei im neuen Format.
export function encodeStateFile(guid: string, update: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER_LEN + update.length);
  out.set(MAGIC, 0);
  out.set(hexToBytes(guid), MAGIC.length);
  out.set(update, HEADER_LEN);
  return out;
}

function hasMagic(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_LEN) return false;
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) return false;
  }
  return true;
}

// Liest eine .yjs-Datei. Ohne gültigen Header → Legacy (guid null, alles Update).
export function decodeStateFile(bytes: Uint8Array): {
  guid: string | null;
  update: Uint8Array;
} {
  if (!hasMagic(bytes)) {
    return { guid: null, update: bytes };
  }
  return {
    guid: bytesToHex(bytes.subarray(MAGIC.length, HEADER_LEN)),
    update: bytes.subarray(HEADER_LEN),
  };
}
