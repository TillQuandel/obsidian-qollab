// Zeilenweiser 3-Wege-Merge — Prototyp mit zwei Korrekturen.
//
// Ausgangspunkt ist `dreiWegeZeilen` aus `schnitte.mjs`. Der bleibt dort
// UNVERAENDERT: er ist Messinstrument und hat die ganze Kampagne getragen; ihn
// zu aendern hiesse, die Vergleichsbasis unter den Zahlen wegzuziehen.
//
// Gemessen (`probe-dreiwege.mjs`, 3000 Tripel) ist er dem Fuzzy-`patch_apply`
// deutlich ueberlegen — WEG 431 -> 0, LOKALWEG 17 -> 0 bei +4,3 % Text. Zwei
// Faelle traegt er aber nicht:
//
//   1. ANGRENZENDE HUNKS gelten als Konflikt. Loescht die eine Seite den
//      Basisbereich [3,4) und fuegt die andere bei Position 4 ein, ueberlappen
//      sie NICHT — sie grenzen nur aneinander. Die Einsammelbedingung `<= ende`
//      zieht sie trotzdem zusammen, das Ergebnis behaelt beide Fassungen, und
//      die geloeschte Zeile kehrt zurueck. Genau daran fiel
//      `sweep-schranke-basiswahl.test.ts`.
//      Korrektur: Ein reiner EINFUEGE-Hunk (start === ende) kollidiert nur mit
//      einem anderen Hunk, der an derselben Stelle EINFUEGT. Gegen einen
//      Loesch-/Ersetzbereich kollidiert er erst, wenn er ECHT darin liegt.
//
//   2. Die KONFLIKTAUFLOESUNG ist nicht idempotent. „Beide Fassungen behalten"
//      haengt bei jedem weiteren Merge erneut an (132 -> 150 -> 168 Zeichen ueber
//      drei Runden) — dieselbe Bauart wie die im August behobene Ersetzung.
//      Korrektur: Steht eine Fassung bereits vollstaendig in der anderen, ist
//      nichts nachzutragen.
import { diff_match_patch } from 'diff-match-patch';

const DMP = new diff_match_patch();

const zeilen = (text) =>
  text.length ? text.split('\n').slice(0, -1).map((l) => l + '\n') : [];

function zeilenDiff(o, x) {
  const { chars1, chars2, lineArray } = DMP.diff_linesToChars_(o, x);
  const d = DMP.diff_main(chars1, chars2, false);
  DMP.diff_charsToLines_(d, lineArray);
  return d;
}

// Hunks als (basisStart, basisEnde, ersatzZeilen).
function hunks(base, x) {
  const out = [];
  let i = 0;
  const d = zeilenDiff(base, x);
  for (let k = 0; k < d.length; k++) {
    const [op, txt] = d[k];
    const zs = zeilen(txt);
    if (op === 0) { i += zs.length; continue; }
    if (op === -1) {
      let ersatz = [];
      if (k + 1 < d.length && d[k + 1][0] === 1) {
        ersatz = zeilen(d[k + 1][1]);
        k++;
      }
      out.push([i, i + zs.length, ersatz]);
      i += zs.length;
    } else {
      out.push([i, i, zs]);
    }
  }
  return out;
}

// Kollidiert der Hunk `h` mit dem bereits eingesammelten Bereich [start, ende)?
//
// Ein Einfuege-Hunk hat start === ende und belegt keinen Basisbereich. Er darf
// deshalb an `ende` andocken, ohne als Konflikt zu gelten — es sei denn, an
// derselben Stelle fuegt auch die Gegenseite ein, denn dann ist die Reihenfolge
// offen und muss festgelegt werden.
function kollidiert(h, start, ende, gegenEinfuegungenBei) {
  const [s, e] = h;
  // Der Hunk, der die Runde eroeffnet, gehoert immer dazu. Ohne diese Zeile
  // wird ein Einfuege-Hunk bei `start` nie konsumiert und die Schleife dreht
  // sich endlos (gemessen: RangeError, `out` waechst unbegrenzt).
  if (s === start) return true;
  if (s === e) {
    // Reine Einfuegung bei s: belegt keinen Basisbereich, darf also an `ende`
    // andocken. Konflikt nur, wenn sie ECHT im Bereich liegt oder die
    // Gegenseite an derselben Stelle einfuegt.
    if (s > start && s < ende) return true;
    return gegenEinfuegungenBei.has(s);
  }
  return s < ende && e > start;
}

export function dreiWegeZeilen(base, a, b) {
  const ob = zeilen(base);
  const ha = hunks(base, a);
  const hb = hunks(base, b);
  const out = [];
  let i = 0;
  let ia = 0;
  let ib = 0;

  while (ia < ha.length || ib < hb.length) {
    const sa = ia < ha.length ? ha[ia][0] : Infinity;
    const sb = ib < hb.length ? hb[ib][0] : Infinity;
    const start = Math.min(sa, sb);
    for (; i < start && i < ob.length; i++) out.push(ob[i]);

    let ende = start;
    const aH = [];
    const bH = [];
    const aEinfuegungen = new Set();
    const bEinfuegungen = new Set();
    // Zuerst alle Hunks, die exakt hier beginnen — danach so lange erweitern,
    // wie die Gegenseite echt hineinragt.
    let gewachsen = true;
    while (gewachsen) {
      gewachsen = false;
      while (ia < ha.length && kollidiert(ha[ia], start, ende, bEinfuegungen)) {
        ende = Math.max(ende, ha[ia][1]);
        if (ha[ia][0] === ha[ia][1]) aEinfuegungen.add(ha[ia][0]);
        aH.push(ha[ia++]);
        gewachsen = true;
      }
      while (ib < hb.length && kollidiert(hb[ib], start, ende, aEinfuegungen)) {
        ende = Math.max(ende, hb[ib][1]);
        if (hb[ib][0] === hb[ib][1]) bEinfuegungen.add(hb[ib][0]);
        bH.push(hb[ib++]);
        gewachsen = true;
      }
    }

    const bau = (hs) => {
      const res = [];
      let p = start;
      for (const [s, e, r] of hs) {
        for (; p < s; p++) res.push(ob[p]);
        res.push(...r);
        p = e;
      }
      for (; p < ende; p++) res.push(ob[p]);
      return res;
    };
    const va = aH.length ? bau(aH) : ob.slice(start, ende);
    const vb = bH.length ? bau(bH) : ob.slice(start, ende);
    const ta = va.join('');
    const tb = vb.join('');

    if (ta === tb) out.push(ta);
    else if (aH.length === 0) out.push(tb);
    else if (bH.length === 0) out.push(ta);
    // IDEMPOTENZ: Traegt eine Fassung die andere bereits vollstaendig, ist
    // nichts nachzutragen. Ohne diese beiden Zeilen waechst der Text bei jedem
    // weiteren Merge.
    else if (ta.includes(tb)) out.push(ta);
    else if (tb.includes(ta)) out.push(tb);
    else {
      // Beide Seiten haben dieselbe Stelle angefasst und keine enthaelt die
      // andere: beide Fassungen behalten, in fester Reihenfolge, damit alle
      // Geraete dasselbe rechnen.
      const [x, y] = [ta, tb].sort();
      out.push(x, y);
    }
    i = Math.max(i, ende);
  }
  for (; i < ob.length; i++) out.push(ob[i]);
  return out.join('');
}
