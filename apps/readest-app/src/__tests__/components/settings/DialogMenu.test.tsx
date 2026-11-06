import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: {},
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    setFontPanelView: vi.fn(),
  }),
}));

vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({
    getAllFonts: vi.fn(() => []),
    removeFont: vi.fn(),
    saveCustomFonts: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import DialogMenu from '@/components/settings/DialogMenu';

afterEach(() => cleanup());

describe('DialogMenu', () => {
  it('does not render Apply to All Books or Apply to This Book toggles', () => {
    render(<DialogMenu bookKey='book-1' activePanel='Font' onReset={vi.fn()} />);

    expect(screen.queryByText('Apply to All Books')).toBeNull();
    expect(screen.queryByText('Apply to This Book')).toBeNull();
  });

  it('renders Reset Settings and font management options when activePanel is Font', () => {
    render(<DialogMenu bookKey='book-1' activePanel='Font' onReset={vi.fn()} />);

    expect(screen.getByText('Reset Settings')).not.toBeNull();
    expect(screen.getByText('Clear Custom Fonts')).not.toBeNull();
    expect(screen.getByText('Manage Custom Fonts')).not.toBeNull();
  });

  it('renders custom reset label when provided', () => {
    render(
      <DialogMenu
        bookKey='book-1'
        activePanel='Layout'
        onReset={vi.fn()}
        resetLabel='Reset Layout'
      />,
    );

    expect(screen.getByText('Reset Layout')).not.toBeNull();
    expect(screen.queryByText('Clear Custom Fonts')).toBeNull();
  });
});
