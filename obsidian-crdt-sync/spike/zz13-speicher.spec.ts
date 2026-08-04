// TEIL 13 — SPEICHER. Was haelt der SyncHandler bei einem Vault von Tills Groesse
// tatsaechlich im Arbeitsspeicher?
//
// Gemessen am ECHTEN Vault (2026-08-04): 1653 Notizen, 8,33 MB, Schnitt 5284 B,
// groesste 350 KB. Genau diese Groessen werden hier nachgebaut.
//
// Getrennt ausgewiesen, damit der Posten der Yjs-Docs nicht den Karten
// zugeschrieben wird — der Doc-Speicher ist der Preis des CRDT und steht hier
// nicht zur Debatte.

import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { makeVaultMock } from '../tests/helpers/vault-mock';

const N = Number(process.env.SPIKE_NOTIZEN ?? 1653);
const SCHNITT = 5284;

jest.setTimeout(1800000);

function bytes(s: string): number {
  // V8 haelt reines ASCII als OneByteString (1 B/Zeichen); alles andere UTF-16.
  return /^[\x00-\x7F]*$/.test(s) ? s.length : s.length * 2;
}

function summe(m: unknown): { eintraege: number; bytes: number } {
  const map = m as Map<string, unknown>;
  if (!(map instanceof Map)) return { eintraege: -1, bytes: -1 };
  let b = 0;
  for (const [k, v] of map.entries()) {
    b += bytes(k);
    if (typeof v === 'string') b += bytes(v);
    else if (v && typeof v === 'object' && typeof (v as any).text === 'string') {
      b += bytes((v as any).text);
    }
  }
  return { eintraege: map.size, bytes: b };
}

const mb = (b: number): string => `${(b / 1024 / 1024).toFixed(2)} MB`;

describe('Speicher', () => {
  it('S-vaultgroesse', async () => {
    const vault = makeVaultMock() as any;
    const crdt = new CrdtManager();
    const sync = new SyncHandler(vault, crdt, 'aaaa1111');

    // Notiztexte in der gemessenen Groessenverteilung: der Schnitt trifft, eine
    // Notiz ist die grosse mit 350 KB.
    const zeile = 'zeile mit etwas text darin, wie in einer echten notiz\n';
    const proNotiz = Math.max(1, Math.round(SCHNITT / zeile.length));
    let vaultBytes = 0;

    const vorher = process.memoryUsage().heapUsed;

    for (let i = 0; i < N; i++) {
      const pfad = `notiz-${i}.md`;
      const anzahl = i === 0 ? Math.round((350 * 1024) / zeile.length) : proNotiz;
      const text = `# Notiz ${i}\n` + zeile.repeat(anzahl);
      vaultBytes += bytes(text);
      vault._textFiles.set(pfad, text);
      await sync.applyLocalContent(pfad, text);
    }

    const nachher = process.memoryUsage().heapUsed;

    const s = sync as any;
    const diffBase = summe(s.localDiffBase);
    const parked = summe(s.parked);
    const nachgetragen = summe(s.nachgetragen);
    const guids = summe(s.guids);

    // eslint-disable-next-line no-console
    console.log(
      `\n===== SPEICHER | ${N} Notizen, ${mb(vaultBytes)} Vault-Text =====\n` +
        `  localDiffBase   ${String(diffBase.eintraege).padStart(5)} Eintraege | ${mb(diffBase.bytes)}\n` +
        `  parked          ${String(parked.eintraege).padStart(5)} Eintraege | ${mb(parked.bytes)}\n` +
        `  nachgetragen    ${String(nachgetragen.eintraege).padStart(5)} Eintraege | ${mb(nachgetragen.bytes)}\n` +
        `  guids           ${String(guids.eintraege).padStart(5)} Eintraege | ${mb(guids.bytes)}\n` +
        `  ---\n` +
        `  Karten zusammen                        ${mb(diffBase.bytes + parked.bytes + nachgetragen.bytes + guids.bytes)}\n` +
        `  Anteil am Vault-Text                   ${(
          (100 * (diffBase.bytes + parked.bytes + nachgetragen.bytes + guids.bytes)) /
          vaultBytes
        ).toFixed(0)} %\n` +
        `  Heap gesamt (Karten UND Yjs-Docs)      ${mb(nachher - vorher)}\n` +
        `  davon Yjs-Docs (Rest)                  ${mb(
          nachher - vorher - (diffBase.bytes + parked.bytes + nachgetragen.bytes + guids.bytes)
        )}\n`
    );

    expect(diffBase.eintraege).toBeGreaterThan(0);
  });
});
