// Beantwortet die eine Frage, die Obsidians Ereignis-API offen lässt: „Stammt
// dieser Dateiinhalt aus diesem Prozess?"
//
// `vault.on('modify')` feuert identisch, ob ein Mensch tippt oder ein Datei-Sync
// (OneDrive, Syncthing) die .md von außen überschreibt — Pfad, mtime und size
// sehen in beiden Fällen gleich aus. Unterscheidbar sind die beiden Fälle nur an
// ihrem WEG: jeder prozessinterne Schreibvorgang (Editor, Kernfunktionen, fremde
// Plugins, Qollab selbst) läuft über die als `@public` dokumentierten Methoden
// `DataAdapter.write` / `.process` / `.append`. Eine per Sync gelieferte Datei
// hat keinen solchen Aufruf hinter sich.
//
// Die Klasse umhüllt diese drei Methoden und führt pro Pfad zwei Spuren:
//   - die Hashes der zuletzt SELBST geschriebenen Stände (nach dem Schreiben)
//   - einen Zähler laufender eigener Schreibvorgänge (während des Schreibens)
// Der Zähler ist nötig, weil Obsidian `modify` bereits WÄHREND des Writes feuert;
// die Hashes sind nötig, weil die Auswertung des Ereignisses (Queue) erst nach
// dessen Abschluss stattfindet.
//
// Mechanik gemessen an echtem Obsidian: docs/spike-herkunftssignal/probe.mjs
// (Branch spike/herkunftssignal), Abschnitt „Kandidat 2".

// Der Ausschnitt der DataAdapter-API, den die Umhüllung anfasst. Bewusst schmaler
// als Obsidians DataAdapter — wie SidecarAdapter in sidecar-io.ts.
export interface ProvenanceAdapter {
  write(path: string, data: string, options?: unknown): Promise<void>;
  process(path: string, fn: (data: string) => string, options?: unknown): Promise<string>;
  append(path: string, data: string, options?: unknown): Promise<void>;
}

type Methode = (...args: any[]) => unknown;

// `writeBinary` gehoert zur selben `@public`-Familie und wurde uebersehen: Jedes
// Plugin, das eine `.md` ueber `vault.modifyBinary` schreibt, galt damit als
// fremd (Recherche 2026-08-04). Ein Volltext ist daraus nicht zu gewinnen — die
// Bytes sind kein `string` —, aber der Laufzeitzaehler deckt das Schreibfenster
// ab, und genau darin feuert Obsidians `modify`.
const UMHUELLTE = ['write', 'process', 'append', 'writeBinary'] as const;
type MethodenName = (typeof UMHUELLTE)[number];

// Wieviele Stände je Pfad gehalten werden. Die Antwort ist EINER, und das ist
// keine Sparmaßnahme, sondern Korrektheit.
//
// Der erste Entwurf hielt vier — mit der Begründung, ein Stand, der mehr als ein
// paar Schritte zurückliegt, könne ohnehin nicht mehr der Dateiinhalt sein. Das
// ist falsch: Ein Datei-Sync spielt ältere Fassungen zurück (Microsoft
// dokumentiert das für OneDrive ausdrücklich). Steht die zurückgespielte Fassung
// noch im Puffer, gilt sie als „eigen", wird nicht geparkt — und der Diff gegen
// den neueren Stand macht aus der Differenz eine LÖSCHUNG, die zum anderen Gerät
// propagiert. Gemessen in `rueckgespielte-eigenfassung.test.ts`: bei vier und
// bei zwei Ständen tritt der Verlust ein und verlässt das Gerät, bei einem nicht.
//
// Warum einer reicht: Der modify-Handler liest den AKTUELLEN Dateiinhalt, und
// der Puffer wird synchron VOR dem Schreiben gesetzt. Der gelesene Inhalt ist
// damit entweder der zuletzt gemerkte Stand oder ein noch laufender Write — und
// den deckt der Laufzeitzähler ab. Kommen zwischen Ereignis und Lesung weitere
// Writes dazu, liest der Handler deren Ergebnis, also wieder den neuesten Stand.
//
// Die Fehlerrichtung bei einem Stand ist die billige: Ein eigener Edit, der doch
// einmal danebenfällt, wird geparkt und mit Verzögerung erfasst. Bei vier
// Ständen war sie die teure — stiller, propagierender Verlust.
export const MAX_STAENDE = 1;

// djb2 mit XOR, gespeichert als `<Länge>:<32-Bit-Hash>`. Gespeichert wird der
// Schlüssel, nicht der Volltext — sonst läge bei 1600+ Notizen der halbe Vault
// vierfach im Speicher.
//
// Die Länge steht bewusst VOR dem Hash: 32 Bit allein verwechseln nachweislich
// Texte verschiedener Länge (konkretes Paar im Test), und ein falsch-positives
// „ist eigen" verschluckt eine echte Fremdänderung — der teuerste Fehler, den
// diese Klasse machen kann.
export function textSchluessel(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}:${h}`;
}

export class WriteProvenance {
  private staende = new Map<string, string[]>();
  private laufend = new Map<string, number>();
  private originale = new Map<MethodenName, Methode>();
  private eigene = new Map<MethodenName, Methode>();

  // Das Lebenszeichen der aktuellen Installation. Jede Installation bekommt ein
  // EIGENES Objekt, damit eine stillgelegte Schicht, die nach uninstall unter
  // einer fremden Umhüllung hängen bleibt, von einem späteren install() nicht
  // wieder aufwacht — zwei aktive Schichten würden den Zähler doppelt heben.
  private lauf: { aktiv: boolean } | null = null;

  constructor(private adapter: ProvenanceAdapter) {}

  install(): void {
    if (this.lauf) return;
    const lauf = { aktiv: true };
    this.lauf = lauf;
    const traeger = this.adapter as unknown as Record<string, Methode>;
    for (const name of UMHUELLTE) {
      const original = traeger[name];
      if (typeof original !== 'function') continue;
      const umhuellung = this.umhuelle(name, original, lauf);
      this.originale.set(name, original);
      this.eigene.set(name, umhuellung);
      traeger[name] = umhuellung;
    }
  }

  uninstall(): void {
    if (!this.lauf) return;
    // Zuerst stilllegen, dann erst ausbauen versuchen: liegt eine fremde
    // Umhüllung über unserer, bleibt unsere Schicht in der Kette stehen und
    // läuft weiter mit — sie darf dann nichts mehr merken.
    this.lauf.aktiv = false;
    this.lauf = null;
    const traeger = this.adapter as unknown as Record<string, Methode>;
    for (const name of UMHUELLTE) {
      const original = this.originale.get(name);
      // Nur zurücksetzen, wenn oben noch UNSERE Methode steht. Hat ein anderes
      // Plugin nach uns umhüllt, schnitte ein blindes Zurücksetzen dessen
      // Schicht aus der Kette — es bekäme seine Aufrufe nie wieder zu sehen.
      if (original && traeger[name] === this.eigene.get(name)) traeger[name] = original;
    }
    this.originale.clear();
    this.eigene.clear();
    // Haengt inzwischen ein anderes Plugin ueber unserer Umhuellung, bleibt sie in
    // dessen Kette und ihre Closure haelt diese Maps am Leben. Sie hier zu leeren
    // ist der einzige Weg, den Speicher freizugeben (Cross-Model-Review
    // 2026-08-04) — `lauf.aktiv = false` schaltet die Umhuellung ohnehin still.
    this.staende.clear();
    this.laufend.clear();
  }

  istEigen(pfad: string, text: string): boolean {
    // Der Zähler ist PRO PFAD geführt. Ein globaler Zähler stünde bei jedem
    // beliebigen anderen Write des Plugins auf >0 und würde in genau diesem
    // Moment eine von außen gelieferte Datei als eigene Änderung durchwinken.
    if ((this.laufend.get(pfad) ?? 0) > 0) return true;
    const liste = this.staende.get(pfad);
    return liste !== undefined && liste.includes(textSchluessel(text));
  }

  renameNote(altPfad: string, neuPfad: string): void {
    const liste = this.staende.get(altPfad);
    if (liste === undefined) return;
    this.staende.delete(altPfad);
    this.staende.set(neuPfad, liste);
    // Der Laufzeitzähler wandert bewusst NICHT mit: ein noch laufender Write
    // senkt ihn beim Abschluss auf dem Pfad, unter dem er ihn gehoben hat.
  }

  forget(pfad: string): void {
    this.staende.delete(pfad);
    // `laufend` räumt sich selbst — senke() löscht den Eintrag bei 0.
  }

  private umhuelle(name: MethodenName, original: Methode, lauf: { aktiv: boolean }): Methode {
    const spur = this;
    return function (this: unknown, ...args: any[]): unknown {
      const pfad = typeof args[0] === 'string' ? args[0] : null;
      if (!lauf.aktiv || pfad === null) return original.apply(this, args);

      // Was HABEN wir geschrieben? Das muss SYNCHRON feststehen, bevor der
      // Aufruf läuft: Obsidian feuert `modify` noch WÄHREND des Writes.
      if (name === 'write' && typeof args[1] === 'string') {
        spur.merke(pfad, args[1]);
      }
      if (name === 'process' && typeof args[1] === 'function') {
        // Der Endstand ist der Rückgabewert von `fn`. Deshalb wird `fn` umhüllt
        // statt das Promise abgewartet — auf dessen Auflösungswert ist kein
        // Verlass (eine fremde Umhüllung darüber kann ihn verschlucken), und er
        // käme ohnehin zu spät.
        const fn = args[1] as (data: string) => string;
        args = [
          args[0],
          (data: string): string => {
            const neu = fn(data);
            if (typeof neu === 'string') spur.merke(pfad, neu);
            return neu;
          },
          ...args.slice(2),
        ];
      }
      // `append` bekommt bewusst kein merke(): sein zweites Argument ist nur das
      // angehängte Fragment, nie der Endstand. Als Volltext gemerkt würde es eine
      // fremd gelieferte Datei mit genau diesem Inhalt als eigen ausweisen. Die
      // Laufzeit des Aufrufs deckt der Zähler unten trotzdem ab.

      spur.hebe(pfad);
      let ergebnis: unknown;
      try {
        ergebnis = original.apply(this, args);
      } catch (e) {
        // Ohne dieses Senken bliebe der Pfad nach einem EPERM für den Rest der
        // Sitzung „eigen" und jede echte Fremdänderung würde verschluckt.
        spur.senke(pfad);
        throw e;
      }
      if (ergebnis && typeof (ergebnis as Promise<unknown>).then === 'function') {
        // Beide Zweige: eine Ablehnung (ENOSPC, Datei gesperrt) darf den Zähler
        // genauso wenig oben lassen wie ein synchroner Wurf. Der zweite Handler
        // hält die Ablehnung zugleich vom abgeleiteten Promise fern — `.finally`
        // oder ein einarmiges `.then` reichen den Fehler an ein Promise weiter,
        // das niemand mehr liest; in der Mutationsprobe beendete genau das den
        // Node-Prozess mitten im Testlauf.
        (ergebnis as Promise<unknown>).then(
          () => spur.senke(pfad),
          () => spur.senke(pfad)
        );
        return ergebnis;
      }
      spur.senke(pfad);
      return ergebnis;
    };
  }

  private merke(pfad: string, text: string): void {
    const liste = this.staende.get(pfad) ?? [];
    liste.push(textSchluessel(text));
    if (liste.length > MAX_STAENDE) liste.splice(0, liste.length - MAX_STAENDE);
    this.staende.set(pfad, liste);
  }

  private hebe(pfad: string): void {
    this.laufend.set(pfad, (this.laufend.get(pfad) ?? 0) + 1);
  }

  private senke(pfad: string): void {
    const rest = (this.laufend.get(pfad) ?? 0) - 1;
    if (rest > 0) this.laufend.set(pfad, rest);
    else this.laufend.delete(pfad);
  }
}
