// Wem gehoert eine Zeile im Y.Doc?
//
// DIE FRAGE, um die es geht: Beim Inkarnationswechsel (`switchToGuid`,
// `src/sync-handler.ts:1375-1455`) baut das unterlegene Geraet den Gewinner-Doc
// auf und materialisiert dann `unionMerge(winnerText, localText)` per
// `setContent` (:1454). Fuer jede Zeile des lokalen Standes entscheidet sich
// dabei, ob sie ein EIGENES Yjs-Item bekommt (frische Op dieses Geraets) oder
// ob sie auf einem FREMDEN Item des Gewinners mitreitet. Im zweiten Fall nimmt
// ein spaeterer Delete des Gewinners den lokalen Beitrag mit.
//
// GEMESSEN WIRD AM ITEM, nicht am Text: Nach `setContent` traegt der Doc genau
// zwei Sorten Items — die per `applyUpdate` eingespielten Gewinner-Ops (fremde
// clientIDs) und die Ops, die `setContent` gerade erzeugt hat (die clientID
// DIESES Docs). Das ist die Grundwahrheit; jede Ableitung aus den Texten allein
// waere ein Stellvertreter dafuer.
//
// Ein `for..of` ueber den String laeuft ueber Code POINTS — ein Surrogatpaar
// zaehlt als ein Zeichen. Fuer die Zuordnung Zeile->Besitzer ist das
// gleichwertig; gezaehlt wird nur, ob ueberhaupt eigene bzw. fremde Zeichen in
// der Zeile stehen.

// Liefert je Zeile des SICHTBAREN Textes (Tombstones uebersprungen):
//   { zeile, eigen, fremd }  — Zahl der Zeichen aus eigenen bzw. fremden Items.
// Das Zeilenende selbst wird nicht mitgezaehlt: es ist der Trenner, nicht Inhalt.
export function zeilenBesitz(ytext, eigenClient) {
  const out = [];
  let puffer = '';
  let eigen = 0;
  let fremd = 0;
  const schliesse = () => {
    out.push({ zeile: puffer, eigen, fremd });
    puffer = '';
    eigen = 0;
    fremd = 0;
  };
  let item = ytext._start;
  while (item !== null && item !== undefined) {
    const c = item.content;
    if (!item.deleted && c && typeof c.str === 'string') {
      const eigenesItem = item.id.client === eigenClient;
      for (const ch of c.str) {
        if (ch === '\n') {
          schliesse();
          continue;
        }
        puffer += ch;
        if (eigenesItem) eigen++;
        else fremd++;
      }
    }
    item = item.right;
  }
  // Schlusszeile ohne Zeilenende. Eine leere Schlusszeile (Text endet auf \n)
  // wird bewusst NICHT gebucht — sie ist kein Inhalt.
  if (puffer.length > 0) schliesse();
  return out;
}

// Welche clientIDs stehen ueberhaupt (sichtbar oder als Tombstone) im Doc?
// Gebraucht fuer die Kollisionsprobe: liegt die eigene clientID schon vor dem
// `setContent` im Doc, waere die Zuordnung oben nicht eindeutig.
export function clientsImDoc(doc) {
  const s = new Set();
  for (const client of doc.store.clients.keys()) s.add(client);
  return s;
}

// Zeile -> Vorkommenszahl. Leerzeilen bleiben draussen, wie in der
// Endzustands-Metrik (`spike/schnitt/harness.mjs:188`) und in
// `spike/verdopplung/zaehl-text-merge.ts:71`.
export function zaehleZeilen(text) {
  const m = new Map();
  for (const roh of text.split('\n')) {
    const z = roh.endsWith('\r') ? roh.slice(0, -1) : roh;
    if (z.length === 0) continue;
    m.set(z, (m.get(z) ?? 0) + 1);
  }
  return m;
}

// Zeilenart im Szenario von `spike/schnitt/harness.mjs:128-156`:
//   `n<i>-base-<l>`  Grundtext — steht per Konstruktion auf JEDEM Geraet
//                    byte-identisch (`seedFile`), hat also genau EINE Herkunft.
//   `n<i>-D<d>-<k>`  Bearbeitungs-Token — genau EINMAL von Geraet <d> eingefuegt
//                    (`buildScenario` vergibt jeden Token nur einmal).
// Alles andere waere ein Merge-Artefakt und wird als solches ausgewiesen.
const BASIS = /^n\d+-base-\d+$/;
const TOKEN = /^n\d+-D(\d+)-\d+$/;

export function zeilenArt(zeile) {
  if (BASIS.test(zeile)) return { art: 'basis', dev: null };
  const m = TOKEN.exec(zeile);
  if (m) return { art: 'token', dev: Number(m[1]) };
  return { art: 'sonstiges', dev: null };
}
