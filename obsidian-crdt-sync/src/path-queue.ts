// Serialisiert asynchrone Operationen pro Key. Aufrufe mit demselben Key laufen
// strikt nacheinander (FIFO), verschiedene Keys parallel. Map-Einträge werden
// nach Abarbeitung aufgeräumt (kein Leak), und ein rejecteter `fn` blockiert die
// Queue für nachfolgende Aufrufe desselben Keys NICHT.
//
// Extrahiert aus der vormaligen Inline-`mergeQueue`-Logik in main.ts, damit ALLE
// Doc-Mutationen eines Note-Pfads (Remote-Merge, lokale Änderung, Startup-Sweep)
// über dieselbe Serialisierung laufen.
export class PathQueue {
  private tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // `prev` ist der Tail des vorherigen Aufrufs (oder resolved). Tails
    // schlucken ihre Fehler (siehe unten) → `prev` rejected nie, `fn` läuft also
    // auch dann, wenn der vorherige `fn` rejectet hat.
    const prev = this.tails.get(key) ?? Promise.resolve();
    const result = prev.then(fn);

    // Nachfolgende Aufrufe hängen sich an diesen Tail; er darf nie rejecten,
    // sonst würde ein Fehler die Kette blockieren.
    const tail = result.then(
      () => {},
      () => {}
    );
    this.tails.set(key, tail);

    // Aufräumen, sobald niemand mehr nachgerückt ist (Map-Eintrag == unser Tail).
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });

    return result;
  }

  // Serialisiert über MEHRERE Keys gleichzeitig (Task 15 Fix C: der rename-Handler
  // mutiert newPath-Zustand, muss aber auch oldPath halten, damit ein dort
  // geparkter Task nicht parallel läuft).
  //
  // Alle Tails werden in EINEM Schritt genommen und gesetzt. Verschachtelte
  // run-Aufrufe (`run(a, () => run(b, fn))`) leisten das NICHT: den zweiten Key
  // belegen sie erst, wenn der Body startet — ein zwischenzeitlich eingereihter
  // Task auf diesem Key zieht vorbei. Genau das ist der rename+delete-Race
  // (Befund 4/7), und genau deshalb reicht Verschachteln hier nicht.
  //
  // Deadlock-frei — aber NICHT, weil es kein Hold-and-Wait gäbe (Review M-1). Das
  // gibt es sehr wohl: der eigene Tail wird unten synchron auf allen Keys
  // veröffentlicht, während oben noch auf die Vorgänger-Tails gewartet wird. Ein
  // danach eingereihter Task blockiert also hinter einem Lock, dessen Halter es
  // selbst noch nicht erworben hat — genau das ist hier gewollt (es schließt den
  // rename+delete-Race).
  //
  // Tragfähig ist eine andere Begründung: Snapshot und Publikation der Tails
  // liegen im SELBEN Tick, ohne dazwischenliegendes await. Deshalb zeigt jede
  // Wartekante ausschließlich auf strikt FRÜHER gestartete Aufrufe; der
  // Wait-for-Graph ist nach Aufrufzeit topologisch sortiert und kann keinen
  // Zyklus enthalten. Wer hier ein `await` vor die `tails.set`-Schleife zieht,
  // zerstört genau diese Eigenschaft.
  //
  // Sortiert wird für eine deterministische Reihenfolge, dedupliziert, damit ein
  // doppelter Key nicht auf sich selbst wartet.
  runAll<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const unique = [...new Set(keys)].sort();
    const prev = Promise.all(unique.map((k) => this.tails.get(k) ?? Promise.resolve()));
    const result = prev.then(fn);

    // Wie in run(): der Tail darf nie rejecten, sonst blockiert ein Fehler die Kette.
    const tail = result.then(
      () => {},
      () => {}
    );
    for (const k of unique) this.tails.set(k, tail);

    void tail.then(() => {
      for (const k of unique) {
        if (this.tails.get(k) === tail) this.tails.delete(k);
      }
    });

    return result;
  }

  // Anzahl aktuell verfolgter Keys — nur für Leak-Assertions in Tests.
  get size(): number {
    return this.tails.size;
  }
}
