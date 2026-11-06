import clsx from 'clsx';
import React from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useCustomFontStore } from '@/store/customFontStore';
import { SettingsPanelType } from './SettingsDialog';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';

interface DialogMenuProps {
  bookKey: string;
  activePanel: SettingsPanelType;
  setIsDropdownOpen?: (open: boolean) => void;
  onReset: () => void;
  resetLabel?: string;
}

const DialogMenu: React.FC<DialogMenuProps> = ({
  bookKey: _bookKey,
  activePanel,
  setIsDropdownOpen,
  onReset,
  resetLabel,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { setFontPanelView } = useSettingsStore();
  const { getAllFonts, removeFont, saveCustomFonts } = useCustomFontStore();

  const handleResetToDefaults = () => {
    onReset();
    setIsDropdownOpen?.(false);
  };

  const handleManageCustomFont = () => {
    setFontPanelView('custom-fonts');
    setIsDropdownOpen?.(false);
  };

  const handleClearCustomFont = () => {
    getAllFonts().forEach((font) => {
      if (removeFont(font.id)) {
        appService!.deleteFont(font);
      }
    });
    saveCustomFonts(envConfig);
    setIsDropdownOpen?.(false);
  };

  return (
    <Menu className={clsx('dialog-menu dropdown-content no-triangle z-20 mt-2 shadow-2xl')}>
      <MenuItem label={resetLabel || _('Reset Settings')} onClick={handleResetToDefaults} />
      {activePanel === 'Font' && (
        <>
          <MenuItem label={_('Clear Custom Fonts')} onClick={handleClearCustomFont} />
          <MenuItem label={_('Manage Custom Fonts')} onClick={handleManageCustomFont} />
        </>
      )}
    </Menu>
  );
};

export default DialogMenu;
