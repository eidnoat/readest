import { ViewSettings } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getStyles } from '@/utils/style';

/**
 * Resolve the effective background texture for the library page (issue #4743).
 * The library texture is stored separately from the reader's, but each field
 * falls back to the reader/global value when unset — so the bookshelf inherits
 * the current look until the user explicitly picks a library texture, then
 * decouples per-field. Returns a `ViewSettings` so it can be handed straight to
 * `useBackgroundTexture().applyBackgroundTexture`.
 */
export const getLibraryViewSettings = (settings: SystemSettings): ViewSettings => {
  // globalViewSettings can be absent on the very first renders — the store
  // starts as `{} as SystemSettings` until appService.loadSettings() runs — so
  // every read is optional and falls back to a no-texture default.
  const globalViewSettings = settings.globalViewSettings;
  return {
    ...globalViewSettings,
    backgroundTextureId:
      settings.libraryBackgroundTextureId ?? globalViewSettings?.backgroundTextureId ?? 'none',
    backgroundOpacity:
      settings.libraryBackgroundOpacity ?? globalViewSettings?.backgroundOpacity ?? 0.6,
    backgroundSize: settings.libraryBackgroundSize ?? globalViewSettings?.backgroundSize ?? 'cover',
  };
};

export type BackgroundTextureScope = 'library' | 'reader';

/**
 * Resolve the three background-texture fields for one scope of the Settings →
 * Theme picker (issue #5306). 'library' resolves exactly like the library page
 * (per-field inheritance, see getLibraryViewSettings); 'reader' reads the open
 * book's view settings when provided, else the global defaults.
 */
export const getBackgroundTextureSettings = (
  scope: BackgroundTextureScope,
  settings: SystemSettings,
  readerViewSettings?: ViewSettings,
): Pick<ViewSettings, 'backgroundTextureId' | 'backgroundOpacity' | 'backgroundSize'> => {
  const source =
    scope === 'library'
      ? getLibraryViewSettings(settings)
      : (readerViewSettings ?? settings.globalViewSettings);
  return {
    backgroundTextureId: source?.backgroundTextureId ?? 'none',
    backgroundOpacity: source?.backgroundOpacity ?? 0.6,
    backgroundSize: source?.backgroundSize ?? 'cover',
  };
};

export const saveViewSettings = async <K extends keyof ViewSettings>(
  envConfig: EnvConfigType,
  bookKey: string,
  key: K,
  value: ViewSettings[K],
  _skipGlobal = false,
  applyStyles = true,
) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  const { getView, getViewState, getViewSettings, setViewSettings } = useReaderStore.getState();
  const { getConfig, saveConfig } = useBookDataStore.getState();

  // uiLanguage is a global system setting that lives under globalViewSettings
  if (key === 'uiLanguage') {
    const nextSettings: SystemSettings = {
      ...settings,
      globalViewSettings: { ...settings.globalViewSettings, [key]: value },
    };
    setSettings(nextSettings);
    await saveSettings(envConfig, nextSettings);
    if (!bookKey) return;
  }

  if (!bookKey) return;

  const viewSettings = getViewSettings(bookKey);
  const viewState = getViewState(bookKey);
  if (viewSettings && viewSettings[key] !== value) {
    viewSettings[key] = value;
    viewSettings.isGlobal = false;
    setViewSettings(bookKey, viewSettings);
    if (applyStyles) {
      const view = getView(bookKey);
      view?.renderer.setStyles?.(getStyles(viewSettings));
    }
    const config = getConfig(bookKey);
    if (viewState?.isPrimary && config) {
      await saveConfig(envConfig, bookKey, config, settings);
    }
  }
};

export const saveSysSettings = async <K extends keyof SystemSettings>(
  envConfig: EnvConfigType,
  key: K,
  value: SystemSettings[K],
) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  if (settings[key] !== value) {
    settings[key] = value;
    setSettings(settings);
    await saveSettings(envConfig, settings);
  }
};
