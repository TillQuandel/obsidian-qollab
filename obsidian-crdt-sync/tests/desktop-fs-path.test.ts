// Der Desktop-Lesepfad — bisher von keinem Test berührt
//
// Befund der Szenariosuche (Mutationsproben, 2026-07-31): `makeVaultMock`
// liefert kein `getBasePath`, also steigt `fsTarget()` aus und alle Suiten
// laufen über den Adapter-Zweig. Auf dem Desktop bindet `main.ts` `getBasePath`
// dagegen immer — dort geht JEDER Sidecar-Zugriff über `fs.promises`.
//
// Gemessen: Verschmilzt man im fs-Zweig die beiden Fehlerklassen („Datei fehlt"
// gegen „gerade nicht lesbar"), bleiben 278/278 Tests grün. Dieselbe Mutation im
// Adapter-Zweig macht 68 rot. Der real genutzte Pfad war ungetestet — und genau
// dort sitzt die Unterscheidung, die Task 12 als sicherheitskritisch bezeichnet:
// Wird ein EBUSY (Sync-Dienst hält ein Handle, der belegte Realfall) als
// „existiert nicht" gelesen, merged das Plugin auf Halbwissen, erfindet die
// fremde Op beim `.md`-Diff als eigene und dupliziert sie dauerhaft.
jest.mock('fs', () => require('./helpers/fs-mock').fsMockModule);

import { readSidecar, statSidecar, listYjsInDir } from '../src/sidecar-io';
import { makeVaultMock } from './helpers/vault-mock';
import { bindFsMock, fsFehler, fsFehlerLoeschen } from './helpers/fs-mock';

const SIDECAR = '.qollab/notiz.md.aaaa1111.yjs';

function vaultMitSidecar() {
  const vault = makeVaultMock();
  vault._files.set(SIDECAR, new TextEncoder().encode('QLB1-Testinhalt').buffer as ArrayBuffer);
  bindFsMock(vault);
  return vault;
}

describe('Desktop-Lesepfad (fs), bisher ungetestet', () => {
  beforeEach(() => fsFehlerLoeschen());

  it('nimmt überhaupt den fs-Zweig, wenn getBasePath gesetzt ist', async () => {
    const vault = vaultMitSidecar();
    // Der Adapter würde die Datei ebenfalls finden — deshalb ein Nachweis, der
    // NUR im fs-Zweig gelingen kann: Der Adapter wird unbrauchbar gemacht.
    vault.adapter.exists = async () => {
      throw new Error('Adapter darf hier nicht gefragt werden');
    };
    vault.adapter.readBinary = async () => {
      throw new Error('Adapter darf hier nicht gefragt werden');
    };
    const buf = await readSidecar(vault.adapter, SIDECAR);
    expect(buf).not.toBeNull();
  });

  it('EBUSY wird GEWORFEN, nicht als „existiert nicht" gelesen', async () => {
    const vault = vaultMitSidecar();
    fsFehler(SIDECAR, 'EBUSY');
    await expect(readSidecar(vault.adapter, SIDECAR)).rejects.toMatchObject({ code: 'EBUSY' });
  });

  it('EACCES wird GEWORFEN', async () => {
    const vault = vaultMitSidecar();
    fsFehler(SIDECAR, 'EACCES');
    await expect(readSidecar(vault.adapter, SIDECAR)).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('eine wirklich fehlende Datei liefert null', async () => {
    const vault = vaultMitSidecar();
    expect(await readSidecar(vault.adapter, '.qollab/gibtsnicht.md.bbbb2222.yjs')).toBeNull();
  });

  it('statSidecar: EBUSY wird nicht zu „existiert nicht" — Rückfall auf die Adapter-Sicht', async () => {
    // Anders als `readSidecar` wirft `statSidecar` hier NICHT, sondern fällt
    // bewusst auf den Adapter zurück (`sidecar-io.ts:130`). Entscheidend ist
    // trotzdem dasselbe: aus einem Lesefehler darf kein `null` werden, denn das
    // hiesse „Datei existiert nicht" und der Sweep zöge daraus falsche Schlüsse.
    const vault = vaultMitSidecar();
    fsFehler(SIDECAR, 'EBUSY');
    const s = await statSidecar(vault.adapter, SIDECAR);
    expect(s).not.toBeNull();
  });

  it('statSidecar: fehlt die Datei auch im Adapter, bleibt es bei null', async () => {
    const vault = vaultMitSidecar();
    expect(await statSidecar(vault.adapter, '.qollab/weg.md.cccc3333.yjs')).toBeNull();
  });

  it('statSidecar liefert Größe und mtime aus dem fs-Zweig', async () => {
    const vault = vaultMitSidecar();
    const s = await statSidecar(vault.adapter, SIDECAR);
    expect(s).not.toBeNull();
    expect(s!.size).toBe(15);
  });

  it('listYjsInDir liest das Verzeichnis über fs', async () => {
    const vault = vaultMitSidecar();
    vault._files.set('.qollab/notiz.md.bbbb2222.yjs', new ArrayBuffer(4));
    const namen = await listYjsInDir(vault.adapter, 'notiz.md');
    expect(namen.sort()).toEqual(
      ['.qollab/notiz.md.aaaa1111.yjs', '.qollab/notiz.md.bbbb2222.yjs'].sort()
    );
  });
});
