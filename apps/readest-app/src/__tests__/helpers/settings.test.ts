import { describe, test, expect, beforeEach, vi } from 'vitest';

const getViewSettingsMock = vi.fn<(bookKey: string) => { isGlobal?: boolean } | undefined>(
  () => undefined,
);
const setViewSettingsMock = vi.fn();
const getViewMock = vi.fn(() => null);
const getViewStateMock = vi.fn(() => undefined);

vi.mock('@/store/readerStore', () => ({
  useReaderStore: {
    getState: () => ({
      bookKeys: [],
      getView: getViewMock,
      getViewState: getViewStateMock,
      getViewSettings: getViewSettingsMock,
      setViewSettings: setViewSettingsMock,
    }),
  },
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getConfig: vi.fn(() => null),
      saveConfig: vi.fn(),
    }),
  },
}));

vi.mock('@/utils/style', () => ({
  getStyles: vi.fn(() => ''),
}));

import {
  getBackgroundTextureSettings,
  getLibraryViewSettings,
  saveViewSettings,
} from '@/helpers/settings';
import { useSettingsStore } from '@/store/settingsStore';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import type { ViewSettings } from '@/types/book';

const envConfig = {} as EnvConfigType;

const makeSettings = (): SystemSettings =>
  ({
    globalViewSettings: { userStylesheet: '', userUIStylesheet: '' },
  }) as unknown as SystemSettings;

const makeTextureSettings = (overrides: Partial<SystemSettings> = {}): SystemSettings =>
  ({
    globalViewSettings: {
      backgroundTextureId: 'paper',
      backgroundOpacity: 0.6,
      backgroundSize: 'cover',
    },
    ...overrides,
  }) as unknown as SystemSettings;

beforeEach(() => {
  getViewSettingsMock.mockReset();
  getViewSettingsMock.mockReturnValue(undefined);
  setViewSettingsMock.mockReset();
  useSettingsStore.setState({
    settings: makeSettings(),
    setSettings: (s: SystemSettings) => useSettingsStore.setState({ settings: s }),
    saveSettings: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useSettingsStore.getState>);
});

describe('getLibraryViewSettings', () => {
  test('inherits the reader/global texture when no library override is set', () => {
    const result = getLibraryViewSettings(makeTextureSettings());

    expect(result.backgroundTextureId).toBe('paper');
    expect(result.backgroundOpacity).toBe(0.6);
    expect(result.backgroundSize).toBe('cover');
  });

  test('uses the library overrides when they are set', () => {
    const result = getLibraryViewSettings(
      makeTextureSettings({
        libraryBackgroundTextureId: 'none',
        libraryBackgroundOpacity: 0.3,
        libraryBackgroundSize: 'contain',
      }),
    );

    expect(result.backgroundTextureId).toBe('none');
    expect(result.backgroundOpacity).toBe(0.3);
    expect(result.backgroundSize).toBe('contain');
  });

  test("tolerates the store's initial empty settings (no globalViewSettings yet)", () => {
    // useSettingsStore starts as `{} as SystemSettings`; the library page's
    // texture effect can resolve before appService.loadSettings() populates it.
    // It must yield a usable "no texture" result instead of throwing.
    const result = getLibraryViewSettings({} as SystemSettings);

    expect(result.backgroundTextureId).toBe('none');
  });

  test('resolves each field independently — an unset field still inherits', () => {
    // Only the texture id is decoupled; opacity/size were never touched and
    // must keep tracking the reader/global values.
    const result = getLibraryViewSettings(
      makeTextureSettings({ libraryBackgroundTextureId: 'sand' }),
    );

    expect(result.backgroundTextureId).toBe('sand');
    expect(result.backgroundOpacity).toBe(0.6);
    expect(result.backgroundSize).toBe('cover');
  });
});

describe('getBackgroundTextureSettings', () => {
  test('library scope resolves like the library page, inheriting until decoupled', () => {
    expect(getBackgroundTextureSettings('library', makeTextureSettings())).toEqual({
      backgroundTextureId: 'paper',
      backgroundOpacity: 0.6,
      backgroundSize: 'cover',
    });
    expect(
      getBackgroundTextureSettings(
        'library',
        makeTextureSettings({ libraryBackgroundTextureId: 'sand' }),
      ).backgroundTextureId,
    ).toBe('sand');
  });

  test('reader scope uses the open book view settings when provided', () => {
    const readerViewSettings = {
      backgroundTextureId: 'moon',
      backgroundOpacity: 0.4,
      backgroundSize: 'auto',
    } as unknown as ViewSettings;

    expect(
      getBackgroundTextureSettings('reader', makeTextureSettings(), readerViewSettings),
    ).toEqual({
      backgroundTextureId: 'moon',
      backgroundOpacity: 0.4,
      backgroundSize: 'auto',
    });
  });

  test('reader scope falls back to global view settings when no book is open', () => {
    expect(getBackgroundTextureSettings('reader', makeTextureSettings())).toEqual({
      backgroundTextureId: 'paper',
      backgroundOpacity: 0.6,
      backgroundSize: 'cover',
    });
  });

  test('reader scope tolerates the initial empty settings', () => {
    expect(getBackgroundTextureSettings('reader', {} as SystemSettings)).toEqual({
      backgroundTextureId: 'none',
      backgroundOpacity: 0.6,
      backgroundSize: 'cover',
    });
  });
});

describe('saveViewSettings', () => {
  test('book setting write does not touch global settings and applies only to book', async () => {
    const bookSettings: Record<string, unknown> = { defaultFontSize: 16 };
    getViewSettingsMock.mockImplementation(() => bookSettings);
    const initial = useSettingsStore.getState().settings;
    const referenceChanges: SystemSettings[] = [];
    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (state.settings && state.settings !== prev?.settings) {
        referenceChanges.push(state.settings);
      }
    });

    try {
      await saveViewSettings(envConfig, 'book-1', 'defaultFontSize', 18);
    } finally {
      unsubscribe();
    }

    expect(referenceChanges).toHaveLength(0);
    expect(useSettingsStore.getState().settings).toBe(initial);
    expect(bookSettings['defaultFontSize']).toBe(18);
    expect(bookSettings['isGlobal']).toBe(false);
    expect(setViewSettingsMock).toHaveBeenCalledWith('book-1', bookSettings);
  });

  test('uiLanguage write updates global settings', async () => {
    let savedSettings: SystemSettings | null = null;
    const saveSettingsMock = vi.fn(async (_env: EnvConfigType, s: SystemSettings) => {
      savedSettings = s;
    });
    useSettingsStore.setState({
      saveSettings: saveSettingsMock,
    } as unknown as ReturnType<typeof useSettingsStore.getState>);

    await saveViewSettings(envConfig, '', 'uiLanguage', 'zh-CN');

    expect(saveSettingsMock).toHaveBeenCalledTimes(1);
    expect(savedSettings!.globalViewSettings.uiLanguage).toBe('zh-CN');
    expect(savedSettings).toBe(useSettingsStore.getState().settings);
  });

  test('no-op when bookKey is empty for book settings', async () => {
    const initial = useSettingsStore.getState().settings;
    await saveViewSettings(envConfig, '', 'defaultFontSize', 20);

    expect(setViewSettingsMock).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings).toBe(initial);
  });
});
