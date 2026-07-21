import { encodeStateFile, decodeStateFile, generateGuid } from '../src/state-file';

// Test 5 (Task 3): Format-Roundtrip inkl. Legacy-Pfad.
// Format: 'QLB1' (4 ASCII) + 16 Bytes GUID (roh) + Yjs-Update (Rest).

describe('state-file Format', () => {
  it('generateGuid liefert 32 lowercase Hex-Zeichen (16 Bytes)', () => {
    expect(generateGuid()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generateGuid liefert bei jedem Aufruf einen anderen Wert', () => {
    const ids = new Set(Array.from({ length: 50 }, generateGuid));
    expect(ids.size).toBe(50);
  });

  it('Roundtrip: encode → decode liefert GUID und Update zurück', () => {
    const guid = generateGuid();
    const update = new Uint8Array([1, 2, 3, 4, 250, 0, 99]);
    const bytes = encodeStateFile(guid, update);

    // Header (4) + GUID (16) + Update.
    expect(bytes.length).toBe(4 + 16 + update.length);
    expect(String.fromCharCode(...Array.from(bytes.subarray(0, 4)))).toBe('QLB1');

    const decoded = decodeStateFile(bytes);
    expect(decoded.guid).toBe(guid);
    expect(Array.from(decoded.update)).toEqual(Array.from(update));
  });

  it('Legacy: headerlose Bytes → guid null, gesamter Inhalt ist das Update', () => {
    const raw = new Uint8Array([9, 8, 7, 6, 5]);
    const decoded = decodeStateFile(raw);
    expect(decoded.guid).toBeNull();
    expect(Array.from(decoded.update)).toEqual(Array.from(raw));
  });

  it('Bytes kürzer als der Header gelten als Legacy', () => {
    const raw = new Uint8Array([0x51, 0x4c]); // nur "QL"
    const decoded = decodeStateFile(raw);
    expect(decoded.guid).toBeNull();
    expect(Array.from(decoded.update)).toEqual(Array.from(raw));
  });

  it('Bytes mit falschem Magic gelten als Legacy', () => {
    const raw = new Uint8Array([0x51, 0x4c, 0x42, 0x39, 1, 2, 3]); // "QLB9"
    const decoded = decodeStateFile(raw);
    expect(decoded.guid).toBeNull();
    expect(Array.from(decoded.update)).toEqual(Array.from(raw));
  });
});
