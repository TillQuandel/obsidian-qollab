import { App, PluginSettingTab, Setting } from 'obsidian';
import type CrdtSyncPlugin from './main';

export interface CrdtSyncSettings {
  enabled: boolean;
  statusNotice: boolean;
  clientId: string;
}

export function generateClientId(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
}

export const DEFAULT_SETTINGS: CrdtSyncSettings = {
  enabled: true,
  statusNotice: true,
  clientId: '',
};

export class CrdtSyncSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: CrdtSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'CRDT Sync' });

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
