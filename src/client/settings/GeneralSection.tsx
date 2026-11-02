import { useId } from 'react';

import { type Theme, useThemeControls } from '../theme.tsx';
import { Segmented, SettingsGroup, SettingsRow } from './rows.tsx';
import { strings } from './strings.ts';

export function GeneralSection() {
  const { theme, switchTheme } = useThemeControls();
  const themeLabel = useId();
  return (
    <SettingsGroup title={strings.general.appearance} footer={strings.savedInBrowser}>
      <SettingsRow
        label={strings.general.theme}
        labelId={themeLabel}
        description={strings.general.themeDescription}
        control={
          <Segmented<Theme>
            labelledBy={themeLabel}
            value={theme}
            options={[
              { value: 'light', label: strings.general.light },
              { value: 'dark', label: strings.general.dark },
            ]}
            onChange={(next) => {
              if (next !== theme) switchTheme();
            }}
          />
        }
      />
    </SettingsGroup>
  );
}
