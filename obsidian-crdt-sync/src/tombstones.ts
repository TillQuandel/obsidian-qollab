// Tombstone-Store-Housekeeping. Tombstones sind gerätelokal (Teil der
// Plugin-Data): Map (notePath, guid) → deletedAt (epoch ms). Beim Laden werden
// Einträge entfernt, die älter als 90 Tage sind — so bleibt die Data-Datei klein
// und eine getombstonte Inkarnation kann nach Ablauf theoretisch wiederverwendet
// werden (praktisch irrelevant, GUIDs sind 128-Bit-Zufall).
//
// Task 15: Der Schlüssel trägt seit Fix A den Note-Pfad mit. Der dokumentierte
// Zweck (README §Grenzen, „Zombie-Resurrection") ist per Definition pfadgebunden
// — eine gelöschte und GLEICHNAMIG neu angelegte Note soll nicht durch eine
// verspätet ankommende alte Hilfsdatei wiederbelebt werden. GUID-global war der
// Scope breiter als der Zweck: lebt dieselbe GUID unter einem anderen Pfad weiter
// (Rename, Adoption), traf der Tombstone dort eine lebende Inkarnation.

export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// NUL trennt Pfad und GUID. Bewusst NUL und kein Leerzeichen/Slash/Doppelpunkt:
// die kommen alle in Vault-Pfaden vor, NUL kann in keinem Dateinamen stehen.
export const TOMBSTONE_KEY_SEP = '\0';

export function tombstoneKey(notePath: string, guid: string): string {
  return `${notePath}${TOMBSTONE_KEY_SEP}${guid}`;
}

// Liefert eine neue Map ohne Einträge, die mindestens maxAgeMs alt sind.
// Key-agnostisch. Reine Funktion (mutiert die Eingabe nicht) — direkt testbar.
export function pruneTombstones(
  tombstones: Record<string, number>,
  now: number = Date.now(),
  maxAgeMs: number = TOMBSTONE_MAX_AGE_MS
): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [key, deletedAt] of Object.entries(tombstones)) {
    if (now - deletedAt < maxAgeMs) kept[key] = deletedAt;
  }
  return kept;
}

// Beim Laden: Alt-Format-Einträge (Schlüssel ohne NUL, also GUID-global aus
// Versionen vor Task 15) verwerfen, danach wie bisher nach Alter prunen.
//
// Verworfen statt umgeschrieben, weil für einen Alt-Eintrag der Pfad nicht
// rekonstruierbar ist; ihn als Wildcard zu behalten trüge genau den Bug weiter,
// den Fix A beseitigt. Der Verlust ist harmlos: schlimmstenfalls wird eine stale
// Sidecar einmalig gemergt — das entspricht der dokumentierten v0.1-Grenze und
// ist kein Datenverlust. Die Einträge sind ohnehin gerätelokal und maximal
// 90 Tage alt.
export function migrateTombstones(
  tombstones: Record<string, number>,
  now: number = Date.now(),
  maxAgeMs: number = TOMBSTONE_MAX_AGE_MS
): Record<string, number> {
  const withPath: Record<string, number> = {};
  for (const [key, deletedAt] of Object.entries(tombstones)) {
    if (key.includes(TOMBSTONE_KEY_SEP)) withPath[key] = deletedAt;
  }
  return pruneTombstones(withPath, now, maxAgeMs);
}
