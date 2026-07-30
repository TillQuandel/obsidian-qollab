import { App, PluginSettingTab, Setting } from 'obsidian';
import type CrdtSyncPlugin from './main';

// Dieses Objekt ist der In-Memory-Zustand; PERSISTIERT wird gesplittet (main.ts,
// `saveSettings`). Grund: `saveData` schreibt nach
// <vault>/.obsidian/plugins/qollab/data.json — also in einen Ordner, den der
// dokumentierte Standard-Aufbau MITSYNCHRONISIERT.
//
// Gerätelokal (App.saveLocalStorage, Obsidian-Profil außerhalb des Vaults):
//   - clientId (Task 14, gar nicht mehr Teil dieses Interfaces): eine mitgesyncte
//     Geräte-ID lässt beide Geräte denselben Sidecar-Pfad beschreiben und legt den
//     Remote-Merge still lahm.
//   - `enabled` und `tombstones` (Task 17/F-3): geteilt schaltete `enabled: false`
//     des einen Geräts das andere still ab, und die Tombstone-Map wurde bei jedem
//     `saveSettings` als Ganzes überschrieben (Last-Writer-Wins statt Vereinigung)
//     bzw. traf auf dem anderen Gerät eine lebende Inkarnation.
//
// Geteilt in data.json: `statusNotice` — reine Anzeigepräferenz ohne
// Zustandssemantik; falsch geteilt kostet sie höchstens eine nicht angezeigte
// Meldung.
export interface CrdtSyncSettings {
  // Gerätelokal persistiert (siehe oben).
  enabled: boolean;
  statusNotice: boolean;
  // Gelöschte Note-Inkarnationen → deletedAt (epoch ms). Gerätelokal persistiert;
  // verhindert Zombie-Resurrection stale fremder .yjs (siehe tombstones.ts). Der
  // Schlüssel ist seit Task 15 das Paar `${notePath}\0${guid}` (tombstoneKey),
  // nicht mehr die GUID allein: derselbe GUID unter einem anderen Pfad (Rename,
  // Adoption) bleibt unberührt. Alt-Format-Einträge werden beim Laden verworfen.
  tombstones: Record<string, number>;
}

// 4 Zufallsbytes = 32 bit Entropie (8 Hex-Zeichen). Bei realistischen
// Gerätezahlen pro Vault (< 100) ist das Kollisionsrisiko vernachlässigbar
// (Geburtstagsschranke ~ 2^16 Geräte für 50 %). Bewusst NICHT verlängert: die
// 8-Hex-Länge ist Teil des Sidecar-Dateinamens-Formats
// (`<note>.<clientId>.yjs`, gematcht von filterYjsFiles/QOLLAB_RE) — eine
// Änderung wäre ein Format-Bruch, kein reiner Settings-Tweak.
export function generateClientId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const DEFAULT_SETTINGS: CrdtSyncSettings = {
  enabled: true,
  statusNotice: true,
  tombstones: {},
};

export class CrdtSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CrdtSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName('Qollab').setHeading();

    new Setting(containerEl)
      .setName('Sync aktiviert')
      .setDesc('Automatisches Mergen bei Datei-Sync (OneDrive, Dropbox, iCloud, …) ein- oder ausschalten.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enabled)
          .onChange(async (value) => {
            const wasEnabled = this.plugin.settings.enabled;
            this.plugin.settings.enabled = value;
            await this.plugin.saveSettings();
            // Task 17/F-5: Beim Wechsel aus → an den Sweep nachholen. Während
            // „aus" fällt jeder Edit am `enabled`-Guard des modify-Handlers ab und
            // lebt nur in der `.md`; gleichzeitig stauen sich die Remote-Trigger
            // korrekt auf (`onRemoteYjsUpdate` gibt `false`, `lastSeen` bleibt
            // stehen). Ohne diesen Aufruf arbeitete der erste Poll nach dem
            // Einschalten sie ab und überschriebe die ganze Aus-Phase —
            // deterministisch binnen eines Poll-Intervalls, nicht als Race.
            //
            // Das Gate in `runStartupSweep` (F-2) hält Trigger währenddessen
            // offen; deshalb genügt hier derselbe Aufruf wie beim Start.
            if (value && !wasEnabled) await this.plugin.runStartupSweep();
          })
      );

    new Setting(containerEl)
      .setName('Merge-Benachrichtigung')
      .setDesc('Kurze Meldung anzeigen wenn ein Merge durchgeführt wurde.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.statusNotice)
          .onChange(async (value) => {
            this.plugin.settings.statusNotice = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Client-ID')
      .setDesc(
        `Eindeutige ID dieses Geräts: ${this.plugin.clientId} ` +
          '(nur auf diesem Gerät gespeichert, wird nicht mitsynchronisiert)'
      );
  }
}
