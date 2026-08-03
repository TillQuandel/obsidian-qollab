// Tombstone-Store-Housekeeping. Tombstones sind gerätelokal (Teil der
// Plugin-Data): Map guid → deletedAt (epoch ms). Beim Laden werden Einträge
// entfernt, die älter als 90 Tage sind — so bleibt die Data-Datei klein und
// eine getombstonte GUID kann nach Ablauf theoretisch wiederverwendet werden
// (praktisch irrelevant, GUIDs sind 128-Bit-Zufall).

export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Liefert eine neue Map ohne Einträge, die mindestens maxAgeMs alt sind.
// Reine Funktion (mutiert die Eingabe nicht) — direkt testbar.
export function pruneTombstones(
  tombstones: Record<string, number>,
  now: number = Date.now(),
  maxAgeMs: number = TOMBSTONE_MAX_AGE_MS
): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [guid, deletedAt] of Object.entries(tombstones)) {
    if (now - deletedAt < maxAgeMs) kept[guid] = deletedAt;
  }
  return kept;
}
