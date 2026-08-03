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

  // Anzahl aktuell verfolgter Keys — nur für Leak-Assertions in Tests.
  get size(): number {
    return this.tails.size;
  }
}
