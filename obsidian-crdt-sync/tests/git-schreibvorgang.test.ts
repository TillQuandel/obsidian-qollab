import { makeVaultMock } from './helpers/vault-mock';

// `git checkout` schreibt am Obsidian-Adapter vorbei (git legt jede Datei neu an:
// `unlink` + `open(O_CREAT|O_EXCL)`, entry.c) — für das Herkunftssignal ist er
// deshalb von einem Sync-Overwrite nicht zu unterscheiden. Er ist aber das
// Gegenteil: eine ausdrückliche Anweisung des Nutzers, die wirken soll.
//
// `.git/index.lock` ist das einzige taugliche Signal. Gemessen an einem per
// Smudge-Filter auf 4 s gebremsten Checkout: Bei 0,7 / 1,4 / 2,1 / 2,8 s steht
// der Lock und `HEAD` zeigt noch den alten Branch; erst bei 3,5 s ist der Lock
// weg und `HEAD` umgesprungen. `HEAD` und Reflog sind also nachlaufend und
// taugen nicht.
describe('git schreibt gerade — die Bedingung des Tors', () => {
  const LOCK = '.git/index.lock';

  it('der Lock ist über den Adapter sichtbar, obwohl .git ein Dot-Ordner ist', async () => {
    const vault = makeVaultMock() as any;
    expect(await vault.adapter.exists(LOCK)).toBe(false);

    // git nimmt den Lock, bevor es ins Arbeitsverzeichnis schreibt.
    vault._files.set(LOCK, new ArrayBuffer(0));
    expect(await vault.adapter.exists(LOCK)).toBe(true);

    // Und gibt ihn erst frei, wenn alle Dateien geschrieben sind.
    vault._files.delete(LOCK);
    expect(await vault.adapter.exists(LOCK)).toBe(false);
  });

  it('der Vault-Index bleibt für .git blind — nur der Adapter sieht ihn', () => {
    const vault = makeVaultMock() as any;
    vault._files.set(LOCK, new ArrayBuffer(0));
    // Dieselbe Dot-Ordner-Blindheit wie bei `.qollab/`. Deshalb MUSS die Prüfung
    // über den Adapter laufen und nicht über `getAbstractFileByPath`.
    expect(vault.getAbstractFileByPath(LOCK)).toBeNull();
  });
});
