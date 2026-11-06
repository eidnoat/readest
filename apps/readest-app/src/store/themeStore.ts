import { create } from 'zustand';
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { AppService } from '@/types/system';
import { getThemeCode, ThemeCode } from '@/utils/style';
import {
  getSystemColorScheme,
  startAmbientLightUpdates,
  stopAmbientLightUpdates,
  type AmbientLightPayload,
} from '@/utils/bridge';
import {
  isValidThemeMode,
  readStoredAmbientIsDarkMode,
  resolveAmbientIsDarkMode,
  resolveThemeIsDarkMode,
} from '@/utils/ambientLight';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { CustomTheme, Palette, ThemeMode, ThemeScope } from '@/styles/themes';
import { EnvConfigType, isWebAppPlatform } from '@/services/environment';
import { SystemSettings } from '@/types/settings';
import type { DuoFoldState } from '@/utils/bridge';
import { Insets } from '@/types/misc';
import { RecordedScreenInsets, RecordedScreenInsetsBySize } from '@/utils/insets';

declare global {
  interface Window {
    __READEST_IS_EINK?: boolean;
    onNativeColorSchemeChange?: (colorScheme: 'light' | 'dark') => void;
  }
}

interface ThemeState {
  /**
   * The theme currently painted on screen — the resolved values for
   * `themeScope`, not raw storage. Everything that just wants to know "what
   * does the UI look like right now" reads these (issue #5945).
   */
  themeMode: ThemeMode;
  themeColor: string;
  lightThemeColor: string;
  darkThemeColor: string;
  /** Which page's theme is applied. Every non-reader route is 'library'. */
  themeScope: ThemeScope;
  /**
   * The reader pair, persisted under the original `themeMode`/`themeColor`
   * keys. `getThemeCode` reads those same keys, so book content and reader
   * overlays follow this pair without any coupling to the scope machinery.
   */
  readerThemeMode: ThemeMode;
  readerThemeColor: string;
  readerLightThemeColor: string;
  readerDarkThemeColor: string;
  /**
   * Library overrides; null means "inherit the reader pair", exactly like the
   * undefined `libraryBackgroundTextureId` fields (#4743). Absent until the
   * user picks a library value in Settings → Theme, so an upgrade changes
   * nothing about how the app looks or how the quick toggles behave.
   */
  libraryThemeMode: ThemeMode | null;
  libraryThemeColor: string | null;
  libraryLightThemeColor: string | null;
  libraryDarkThemeColor: string | null;
  systemIsDarkMode: boolean;
  ambientIsDarkMode: boolean;
  themeCode: ThemeCode;
  isDarkMode: boolean;
  systemUIVisible: boolean;
  statusBarHeight: number;
  systemUIAlwaysHidden: boolean;
  safeAreaInsets: Insets | null;
  // iPhone Duo: top and side insets seen with the status bar hidden, per window
  // size; the reading page keeps them while the toolbar shows the status bar
  // (see getReadingScreenInsets).
  statusBarHiddenInsets: RecordedScreenInsetsBySize | null;
  // The same while the status bar shows, for the toolbars that show with it.
  statusBarShownInsets: RecordedScreenInsetsBySize | null;
  // Radius (px) of the rounded bottom screen corners, 0 when unknown.
  screenCornerRadius: number;
  // iPhone Duo, whose vertical status strip is a large left/right inset (#6307).
  // Every horizontal-inset rule is gated on it, so no other device changes.
  isIPhoneDuo: boolean;
  // iPhone Duo hinge status and folding region, null elsewhere.
  duoFold: DuoFoldState | null;
  isRoundedWindow: boolean;
  setSystemUIAlwaysHidden: (hidden: boolean) => void;
  setStatusBarHeight: (height: number) => void;
  showSystemUI: () => void;
  dismissSystemUI: () => void;
  getIsDarkMode: () => boolean;
  setThemeMode: (mode: ThemeMode) => void;
  setThemeColor: (color: string) => void;
  setLightThemeColor: (color: string) => void;
  setDarkThemeColor: (color: string) => void;
  setThemeScope: (scope: ThemeScope) => void;
  setScopedThemeMode: (scope: ThemeScope, mode: ThemeMode) => void;
  setScopedThemeColor: (scope: ThemeScope, color: string) => void;
  setScopedLightThemeColor: (scope: ThemeScope, color: string) => void;
  setScopedDarkThemeColor: (scope: ThemeScope, color: string) => void;
  getScopedTheme: (scope: ThemeScope) => {
    themeMode: ThemeMode;
    themeColor: string;
    lightThemeColor: string;
    darkThemeColor: string;
  };
  resetThemeScopes: () => void;
  updateAppTheme: (color: keyof Palette) => void;
  saveCustomTheme: (
    envConfig: EnvConfigType,
    settings: SystemSettings,
    theme: CustomTheme,
    isDelete?: boolean,
  ) => void;
  handleSystemThemeChange: (isDark: boolean) => void;
  handleAmbientLightChange: (lux: number) => void;
  updateSafeAreaInsets: (insets: Insets) => void;
  recordStatusBarHiddenInsets: (insets: Insets) => void;
  recordStatusBarShownInsets: (insets: Insets) => void;
  updateScreenCornerRadius: (radius: number) => void;
  setIsIPhoneDuo: (isIPhoneDuo: boolean) => void;
  setDuoFold: (fold: DuoFoldState | null) => void;
}

// The records with this window size's set to these insets, or null when it
// already holds them. Each size keeps its own, so turning the device back
// finds the one taken there before.
const recordScreenInsets = (
  records: RecordedScreenInsetsBySize | null,
  { top, left, right }: Insets,
): RecordedScreenInsetsBySize | null => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const key = `${width}x${height}`;
  const prev: RecordedScreenInsets | undefined = records?.[key];
  if (prev && prev.top === top && prev.left === left && prev.right === right) return null;
  return { ...records, [key]: { width, height, top, left, right } };
};

const LIBRARY_THEME_MODE_KEY = 'libraryThemeMode';
const LIBRARY_THEME_COLOR_KEY = 'libraryThemeColor';
const LIGHT_THEME_COLOR_KEY = 'lightThemeColor';
const DARK_THEME_COLOR_KEY = 'darkThemeColor';
const LIBRARY_LIGHT_THEME_COLOR_KEY = 'libraryLightThemeColor';
const LIBRARY_DARK_THEME_COLOR_KEY = 'libraryDarkThemeColor';

const getInitialThemeMode = (): ThemeMode => {
  if (typeof window !== 'undefined' && localStorage) {
    const stored = localStorage.getItem('themeMode');
    if (isValidThemeMode(stored)) return stored;
  }
  return 'auto';
};

const getInitialLightThemeColor = (): string => {
  if (typeof window !== 'undefined' && localStorage) {
    const stored = localStorage.getItem(LIGHT_THEME_COLOR_KEY);
    if (stored) return stored;
    const legacy = localStorage.getItem('themeColor');
    if (legacy && legacy !== 'default') return legacy;
    if (window.__READEST_IS_EINK) return 'contrast';
  }
  return 'gray';
};

const getInitialDarkThemeColor = (): string => {
  if (typeof window !== 'undefined' && localStorage) {
    const stored = localStorage.getItem(DARK_THEME_COLOR_KEY);
    if (stored) return stored;
    const legacy = localStorage.getItem('themeColor');
    if (legacy) return legacy;
    if (window.__READEST_IS_EINK) return 'contrast';
  }
  return 'default';
};

const getInitialLibraryThemeMode = (): ThemeMode | null => {
  if (typeof window !== 'undefined' && localStorage) {
    const stored = localStorage.getItem(LIBRARY_THEME_MODE_KEY);
    if (isValidThemeMode(stored)) return stored;
  }
  return null;
};

const getInitialLibraryLightThemeColor = (): string | null => {
  if (typeof window !== 'undefined' && localStorage) {
    return localStorage.getItem(LIBRARY_LIGHT_THEME_COLOR_KEY) || null;
  }
  return null;
};

const getInitialLibraryDarkThemeColor = (): string | null => {
  if (typeof window !== 'undefined' && localStorage) {
    return localStorage.getItem(LIBRARY_DARK_THEME_COLOR_KEY) || null;
  }
  return null;
};

const getInitialAmbientIsDarkMode = (systemIsDarkMode: boolean): boolean => {
  if (typeof window !== 'undefined' && localStorage) {
    return readStoredAmbientIsDarkMode(localStorage.getItem('ambientIsDarkMode'), systemIsDarkMode);
  }
  return systemIsDarkMode;
};

const persistAmbientIsDarkMode = (isDark: boolean) => {
  if (typeof window !== 'undefined' && localStorage) {
    localStorage.setItem('ambientIsDarkMode', isDark ? 'true' : 'false');
  }
};

const applyDataTheme = (themeColor: string, isDarkMode: boolean) => {
  document.documentElement.setAttribute(
    'data-theme',
    `${themeColor}-${isDarkMode ? 'dark' : 'light'}`,
  );
};

/**
 * Resolve one scope's pair from the raw stored values. The reader pair is the
 * base; the library falls back to it per field, so a user who only overrides
 * the mode keeps following the reader's color.
 */
const resolveScopedTheme = (
  scope: ThemeScope,
  raw: Pick<
    ThemeState,
    | 'readerThemeMode'
    | 'readerLightThemeColor'
    | 'readerDarkThemeColor'
    | 'libraryThemeMode'
    | 'libraryLightThemeColor'
    | 'libraryDarkThemeColor'
  >,
  isDark: boolean,
): {
  themeMode: ThemeMode;
  themeColor: string;
  lightThemeColor: string;
  darkThemeColor: string;
} => {
  const isReader = scope === 'reader';
  const themeMode = isReader ? raw.readerThemeMode : (raw.libraryThemeMode ?? raw.readerThemeMode);
  const lightThemeColor = isReader
    ? raw.readerLightThemeColor
    : (raw.libraryLightThemeColor ?? raw.readerLightThemeColor);
  const darkThemeColor = isReader
    ? raw.readerDarkThemeColor
    : (raw.libraryDarkThemeColor ?? raw.readerDarkThemeColor);
  const themeColor = isDark ? darkThemeColor : lightThemeColor;

  return { themeMode, themeColor, lightThemeColor, darkThemeColor };
};

/**
 * The reader owns `/reader`; everything else (library, settings, OPDS, player,
 * auth) shares the library scope so no route paints a third look.
 */
export const getThemeScopeForPath = (pathname?: string): ThemeScope => {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '');
  return path.startsWith('/reader') ? 'reader' : 'library';
};

let ambientLightListener: PluginListener | null = null;
let ambientLightListening = false;
let ambientHasLuxReading = false;

const stopAmbientLightListening = async () => {
  if (ambientLightListener) {
    try {
      await ambientLightListener.unregister();
    } catch {
      // ignore unregister races on teardown
    }
    ambientLightListener = null;
  }
  if (ambientLightListening) {
    ambientLightListening = false;
    try {
      await stopAmbientLightUpdates();
    } catch {
      // platform may not support ambient light
    }
  }
  ambientHasLuxReading = false;
};

const startAmbientLightListening = async () => {
  if (ambientLightListening) return;
  try {
    const started = await startAmbientLightUpdates();
    if (!started.success) {
      useThemeStore.getState().setThemeMode('auto');
      return;
    }
    ambientLightListening = true;
    ambientLightListener = await addPluginListener<AmbientLightPayload>(
      'native-bridge',
      'ambient-light',
      (payload) => {
        if (typeof payload?.lux === 'number') {
          useThemeStore.getState().handleAmbientLightChange(payload.lux);
        }
      },
    );
  } catch {
    useThemeStore.getState().setThemeMode('auto');
  }
};

// Start and stop both span several awaits, so overlapping calls could
// interleave: a stop landing after a start leaves the sensor off while we
// still believe we are listening, and two starts leak the first listener.
// Chaining every transition keeps the sensor in step with the last mode set.
let ambientLightSync: Promise<void> = Promise.resolve();

const syncAmbientLightSubscription = (mode: ThemeMode) => {
  ambientLightSync = ambientLightSync.then(() =>
    mode === 'ambient' ? startAmbientLightListening() : stopAmbientLightListening(),
  );
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialThemeMode = getInitialThemeMode();
  const initialLightThemeColor = getInitialLightThemeColor();
  const initialDarkThemeColor = getInitialDarkThemeColor();
  const initialLibraryThemeMode = getInitialLibraryThemeMode();
  const initialLibraryLightThemeColor = getInitialLibraryLightThemeColor();
  const initialLibraryDarkThemeColor = getInitialLibraryDarkThemeColor();
  const systemIsDarkMode =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const ambientIsDarkMode = getInitialAmbientIsDarkMode(systemIsDarkMode);
  const initialScope = getThemeScopeForPath();
  const tempMode =
    initialScope === 'reader' ? initialThemeMode : (initialLibraryThemeMode ?? initialThemeMode);
  const tempIsDark = resolveThemeIsDarkMode(tempMode, systemIsDarkMode, ambientIsDarkMode);
  const initialEffective = resolveScopedTheme(
    initialScope,
    {
      readerThemeMode: initialThemeMode,
      readerLightThemeColor: initialLightThemeColor,
      readerDarkThemeColor: initialDarkThemeColor,
      libraryThemeMode: initialLibraryThemeMode,
      libraryLightThemeColor: initialLibraryLightThemeColor,
      libraryDarkThemeColor: initialLibraryDarkThemeColor,
    },
    tempIsDark,
  );
  const isDarkMode = resolveThemeIsDarkMode(
    initialEffective.themeMode,
    systemIsDarkMode,
    ambientIsDarkMode,
  );
  const themeCode = getThemeCode();

  /**
   * Recompute the active scope's pair after a change and paint it. Writes that
   * land on the scope the user is NOT looking at resolve to the same effective
   * values, so this is a no-op repaint for them — which is what keeps editing
   * the library theme from repainting an open book (the rule the background
   * texture scope already follows, #4743).
   *
   * `refreshThemeCode` is set only when the reader pair or the system/ambient
   * flags moved. `themeCode` feeds the CSS injected into the book iframe, and
   * handing it a fresh object identity re-runs the reader's style effects.
   */
  const applyActiveScope = (patch: Partial<ThemeState>, refreshThemeCode: boolean) => {
    const next = { ...get(), ...patch };
    const activeMode =
      next.themeScope === 'reader'
        ? next.readerThemeMode
        : (next.libraryThemeMode ?? next.readerThemeMode);
    const activeIsDark = resolveThemeIsDarkMode(
      activeMode,
      next.systemIsDarkMode,
      next.ambientIsDarkMode,
    );
    const effective = resolveScopedTheme(next.themeScope, next, activeIsDark);
    const nextIsDarkMode = resolveThemeIsDarkMode(
      effective.themeMode,
      next.systemIsDarkMode,
      next.ambientIsDarkMode,
    );
    if (typeof window !== 'undefined' && localStorage) {
      localStorage.setItem('themeColor', effective.themeColor);
    }
    applyDataTheme(effective.themeColor, nextIsDarkMode);
    set({
      ...patch,
      themeMode: effective.themeMode,
      themeColor: effective.themeColor,
      lightThemeColor: effective.lightThemeColor,
      darkThemeColor: effective.darkThemeColor,
      isDarkMode: nextIsDarkMode,
      ...(refreshThemeCode ? { themeCode: getThemeCode() } : {}),
    });
    return effective.themeMode;
  };

  return {
    themeMode: initialEffective.themeMode,
    themeColor: initialEffective.themeColor,
    lightThemeColor: initialEffective.lightThemeColor,
    darkThemeColor: initialEffective.darkThemeColor,
    themeScope: initialScope,
    readerThemeMode: initialThemeMode,
    readerThemeColor: initialEffective.themeColor,
    readerLightThemeColor: initialLightThemeColor,
    readerDarkThemeColor: initialDarkThemeColor,
    libraryThemeMode: initialLibraryThemeMode,
    libraryThemeColor: initialLibraryThemeMode ? initialEffective.themeColor : null,
    libraryLightThemeColor: initialLibraryLightThemeColor,
    libraryDarkThemeColor: initialLibraryDarkThemeColor,
    systemIsDarkMode,
    ambientIsDarkMode,
    isDarkMode,
    themeCode,
    systemUIVisible: false,
    statusBarHeight: 24,
    systemUIAlwaysHidden: false,
    safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    statusBarHiddenInsets: null,
    statusBarShownInsets: null,
    screenCornerRadius: 0,
    isIPhoneDuo: false,
    duoFold: null,
    isRoundedWindow: true,
    showSystemUI: () => set({ systemUIVisible: true }),
    dismissSystemUI: () => set({ systemUIVisible: false }),
    setStatusBarHeight: (height: number) => set({ statusBarHeight: height }),
    setSystemUIAlwaysHidden: (hidden: boolean) => set({ systemUIAlwaysHidden: hidden }),
    getIsDarkMode: () => get().isDarkMode,
    getScopedTheme: (scope) => {
      const raw = get();
      const isReader = scope === 'reader';
      const mode = isReader ? raw.readerThemeMode : (raw.libraryThemeMode ?? raw.readerThemeMode);
      const isDark = resolveThemeIsDarkMode(mode, raw.systemIsDarkMode, raw.ambientIsDarkMode);
      return resolveScopedTheme(scope, raw, isDark);
    },
    setThemeScope: (scope) => {
      if (get().themeScope === scope) return;
      const mode = applyActiveScope({ themeScope: scope }, false);
      syncAmbientLightSubscription(mode);
    },
    // The quick toggles (library settings menu, reader view menu, reader color
    // panel, command palette) route through here. While the library is still
    // inheriting, a toggle from either page writes the shared reader pair so
    // both pages move together exactly as they did before #5945 — only an
    // explicit library edit in Settings → Theme decouples the two.
    setThemeMode: (mode) => {
      const { themeScope, libraryThemeMode } = get();
      const target: ThemeScope =
        themeScope === 'library' && libraryThemeMode !== null ? 'library' : 'reader';
      get().setScopedThemeMode(target, mode);
    },
    setLightThemeColor: (color) => {
      const { themeScope, libraryLightThemeColor } = get();
      const target: ThemeScope =
        themeScope === 'library' && libraryLightThemeColor !== null ? 'library' : 'reader';
      get().setScopedLightThemeColor(target, color);
    },
    setDarkThemeColor: (color) => {
      const { themeScope, libraryDarkThemeColor } = get();
      const target: ThemeScope =
        themeScope === 'library' && libraryDarkThemeColor !== null ? 'library' : 'reader';
      get().setScopedDarkThemeColor(target, color);
    },
    setScopedLightThemeColor: (scope, color) => {
      const isReader = scope === 'reader';
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem(
          isReader ? LIGHT_THEME_COLOR_KEY : LIBRARY_LIGHT_THEME_COLOR_KEY,
          color,
        );
      }
      applyActiveScope(
        isReader ? { readerLightThemeColor: color } : { libraryLightThemeColor: color },
        isReader,
      );
    },
    setScopedDarkThemeColor: (scope, color) => {
      const isReader = scope === 'reader';
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem(isReader ? DARK_THEME_COLOR_KEY : LIBRARY_DARK_THEME_COLOR_KEY, color);
      }
      applyActiveScope(
        isReader ? { readerDarkThemeColor: color } : { libraryDarkThemeColor: color },
        isReader,
      );
    },
    setThemeColor: (color) => {
      if (get().isDarkMode) {
        get().setDarkThemeColor(color);
      } else {
        get().setLightThemeColor(color);
      }
    },
    setScopedThemeMode: (scope, mode) => {
      const isReader = scope === 'reader';
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem(isReader ? 'themeMode' : LIBRARY_THEME_MODE_KEY, mode);
      }
      const activeMode = applyActiveScope(
        isReader ? { readerThemeMode: mode } : { libraryThemeMode: mode },
        isReader,
      );
      syncAmbientLightSubscription(activeMode);
    },
    setScopedThemeColor: (scope, color) => {
      const isReader = scope === 'reader';
      const mode = isReader
        ? get().readerThemeMode
        : (get().libraryThemeMode ?? get().readerThemeMode);
      const isDark = resolveThemeIsDarkMode(mode, get().systemIsDarkMode, get().ambientIsDarkMode);
      if (isDark) {
        get().setScopedDarkThemeColor(scope, color);
      } else {
        get().setScopedLightThemeColor(scope, color);
      }
    },
    // "Reset to defaults" has to drop the library override too, otherwise a
    // decoupled library keeps its old look and the reset looks broken.
    resetThemeScopes: () => {
      if (typeof window !== 'undefined' && localStorage) {
        localStorage.setItem('themeMode', 'auto');
        localStorage.setItem(LIGHT_THEME_COLOR_KEY, 'gray');
        localStorage.setItem(DARK_THEME_COLOR_KEY, 'default');
        localStorage.setItem('themeColor', 'gray');
        localStorage.removeItem(LIBRARY_THEME_MODE_KEY);
        localStorage.removeItem(LIBRARY_LIGHT_THEME_COLOR_KEY);
        localStorage.removeItem(LIBRARY_DARK_THEME_COLOR_KEY);
        localStorage.removeItem(LIBRARY_THEME_COLOR_KEY);
      }
      const activeMode = applyActiveScope(
        {
          readerThemeMode: 'auto',
          readerLightThemeColor: 'gray',
          readerDarkThemeColor: 'default',
          libraryThemeMode: null,
          libraryLightThemeColor: null,
          libraryDarkThemeColor: null,
        },
        true,
      );
      syncAmbientLightSubscription(activeMode);
    },
    updateAppTheme: (color) => {
      if (isWebAppPlatform()) {
        const { palette } = get().themeCode;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette[color]);
      }
    },
    saveCustomTheme: async (envConfig, settings, theme, isDelete) => {
      const customThemes = settings.globalReadSettings.customThemes || [];
      const index = customThemes.findIndex((t) => t.name === theme.name);
      if (isDelete) {
        if (index > -1) {
          customThemes.splice(index, 1);
        }
      } else {
        if (index > -1) {
          customThemes[index] = theme;
        } else {
          customThemes.push(theme);
        }
      }
      settings.globalReadSettings.customThemes = customThemes;
      localStorage.setItem('customThemes', JSON.stringify(customThemes));
      const appService = await envConfig.getAppService();
      await appService.saveSettings(settings);
    },
    handleSystemThemeChange: (systemIsDarkMode) => {
      applyActiveScope({ systemIsDarkMode }, true);
    },
    handleAmbientLightChange: (lux) => {
      if (get().themeMode !== 'ambient') return;
      const previous = ambientHasLuxReading ? get().ambientIsDarkMode : null;
      ambientHasLuxReading = true;
      const nextAmbientIsDark = resolveAmbientIsDarkMode(lux, previous);
      if (nextAmbientIsDark === get().ambientIsDarkMode && get().isDarkMode === nextAmbientIsDark) {
        return;
      }
      persistAmbientIsDarkMode(nextAmbientIsDark);
      applyActiveScope({ ambientIsDarkMode: nextAmbientIsDark }, true);
    },
    updateSafeAreaInsets: (insets) => {
      set({ safeAreaInsets: insets });
    },
    recordStatusBarHiddenInsets: (insets) => {
      const record = recordScreenInsets(get().statusBarHiddenInsets, insets);
      if (record) set({ statusBarHiddenInsets: record });
    },
    recordStatusBarShownInsets: (insets) => {
      const record = recordScreenInsets(get().statusBarShownInsets, insets);
      if (record) set({ statusBarShownInsets: record });
    },
    updateScreenCornerRadius: (radius) => {
      if (get().screenCornerRadius !== radius) set({ screenCornerRadius: radius });
    },
    setIsIPhoneDuo: (isIPhoneDuo) => {
      if (get().isIPhoneDuo !== isIPhoneDuo) set({ isIPhoneDuo });
    },
    setDuoFold: (fold) => {
      // Refetched on every resize and focus: keep the reference while nothing
      // changed so the reader does not re-lay out the page.
      if (JSON.stringify(get().duoFold) !== JSON.stringify(fold)) set({ duoFold: fold });
    },
  };
});

export const loadDataTheme = (scope: ThemeScope = getThemeScopeForPath()) => {
  if (typeof localStorage === 'undefined' || typeof document === 'undefined') return;

  const themeMode = localStorage.getItem('themeMode');
  const lightThemeColor = localStorage.getItem(LIGHT_THEME_COLOR_KEY);
  const darkThemeColor = localStorage.getItem(DARK_THEME_COLOR_KEY);
  const themeColor = localStorage.getItem('themeColor');
  const libraryThemeMode = getInitialLibraryThemeMode();
  const libraryLightThemeColor = getInitialLibraryLightThemeColor();
  const libraryDarkThemeColor = getInitialLibraryDarkThemeColor();
  if (
    !(themeMode && (lightThemeColor || darkThemeColor || themeColor)) &&
    !libraryThemeMode &&
    !libraryLightThemeColor &&
    !libraryDarkThemeColor
  )
    return;

  const systemIsDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const ambientIsDarkMode = getInitialAmbientIsDarkMode(systemIsDarkMode);
  const tempMode =
    scope === 'reader' ? getInitialThemeMode() : (libraryThemeMode ?? getInitialThemeMode());
  const tempIsDark = resolveThemeIsDarkMode(tempMode, systemIsDarkMode, ambientIsDarkMode);
  const effective = resolveScopedTheme(
    scope,
    {
      readerThemeMode: getInitialThemeMode(),
      readerLightThemeColor: getInitialLightThemeColor(),
      readerDarkThemeColor: getInitialDarkThemeColor(),
      libraryThemeMode,
      libraryLightThemeColor,
      libraryDarkThemeColor,
    },
    tempIsDark,
  );
  const isDarkMode = resolveThemeIsDarkMode(
    effective.themeMode,
    systemIsDarkMode,
    ambientIsDarkMode,
  );
  applyDataTheme(effective.themeColor, isDarkMode);
};

export const initSystemThemeListener = (appService: AppService) => {
  if (typeof window === 'undefined' || !appService) return;

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const applySystemTheme = (systemIsDarkMode: boolean) => {
    if (typeof window !== 'undefined' && localStorage) {
      localStorage.setItem('systemIsDarkMode', systemIsDarkMode ? 'true' : 'false');
    }
    useThemeStore.getState().handleSystemThemeChange(systemIsDarkMode);
  };
  const updateColorTheme = async () => {
    let systemIsDarkMode;
    if (appService.isIOSApp) {
      const res = await getSystemColorScheme();
      systemIsDarkMode = res.colorScheme === 'dark';
    } else {
      systemIsDarkMode = mediaQuery.matches;
    }
    applySystemTheme(systemIsDarkMode);
  };

  const updateWindowTheme = async () => {
    if (!appService.hasWindow || !appService.isLinuxApp) return;
    const currentWindow = getCurrentWindow();
    const isFullscreen = await currentWindow.isFullscreen();
    const isMaximized = await currentWindow.isMaximized();
    useThemeStore.setState({ isRoundedWindow: !isMaximized && !isFullscreen });
  };

  const syncAmbientForVisibility = () => {
    const mode = useThemeStore.getState().themeMode;
    if (document.visibilityState === 'visible') {
      syncAmbientLightSubscription(mode);
    } else {
      void stopAmbientLightListening();
    }
  };

  mediaQuery?.addEventListener('change', updateColorTheme);
  document.addEventListener('visibilitychange', () => {
    void updateColorTheme();
    syncAmbientForVisibility();
  });
  window.addEventListener('resize', updateWindowTheme);

  // iOS WKWebView never fires the `prefers-color-scheme` media query
  // `change` event while the app stays foregrounded (e.g. toggling dark
  // mode from Control Center), so the native plugin pushes the new
  // appearance through this callback instead.
  if (appService.isIOSApp) {
    window.onNativeColorSchemeChange = (colorScheme) => {
      applySystemTheme(colorScheme === 'dark');
    };
  }

  updateColorTheme();

  // appService.init() has already probed the sensor by the time this runs, so
  // fall back when Ambient Mode was persisted on a device that lacks one.
  const themeMode = useThemeStore.getState().themeMode;
  if (themeMode === 'ambient' && !appService.hasAmbientLightSensor) {
    useThemeStore.getState().setThemeMode('auto');
  } else {
    syncAmbientLightSubscription(themeMode);
  }
};
