import { App, PluginSettingTab, Setting } from 'obsidian';
import type CrdtSyncPlugin from './main';

// Alles hier landet via saveData in <vault>/.obsidian/plugins/qollab/data.json —
// also in einem Ordner, den der dokumentierte Standard-Aufbau MITSYNCHRONISIERT.
// Deshalb steht die clientId bewusst NICHT mehr hier, sondern im gerätelokalen
// localStorage (main.ts, Task 14): eine mitgesyncte Geräte-ID lässt beide Geräte
// denselben Sidecar-Pfad beschreiben und legt den Remote-Merge still lahm.
export interface CrdtSyncSettings {
  enabled: boolean;
  statusNotice: boolean;
  // GUIDs gelöschter Note-Inkarnationen → deletedAt (epoch ms). Gerätelokal;
  // verhindert Zombie-Resurrection stale fremder .yjs (siehe tombstones.ts).
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
            this.plugin.settings.enabled = value;
            await this.plugin.saveSettings();
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
