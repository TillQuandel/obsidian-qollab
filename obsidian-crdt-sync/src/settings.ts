import { App, PluginSettingTab, Setting } from 'obsidian';
import type CrdtSyncPlugin from './main';

export interface CrdtSyncSettings {
  enabled: boolean;
  statusNotice: boolean;
  clientId: string;
  // GUIDs gelöschter Note-Inkarnationen → deletedAt (epoch ms). Gerätelokal;
  // verhindert Zombie-Resurrection stale fremder .yjs (siehe tombstones.ts).
  tombstones: Record<string, number>;
}

export function generateClientId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const DEFAULT_SETTINGS: CrdtSyncSettings = {
  enabled: true,
  statusNotice: true,
  clientId: '',
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
      .setDesc(`Eindeutige ID dieses Geräts: ${this.plugin.settings.clientId}`);
  }
}
