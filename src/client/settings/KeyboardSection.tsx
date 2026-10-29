import { Kbd } from '@/components/ui/kbd.tsx';

import { commentsEnabled } from '../comments/enabled.ts';
import { INDEX_SEARCH_ALT_KEY, indexSearchShortcut, SHORTCUT_GROUPS } from '../shortcuts.ts';
import { SettingsGroup, SettingsRow } from './rows.tsx';
import { strings } from './strings.ts';

function Keys({ keys, pair = false }: { keys: readonly string[]; pair?: boolean }) {
  return (
    <span className="settings-keys" data-pair={pair || undefined}>
      {keys.map((key, index) => (
        <span key={key} className="settings-keys-item">
          {index > 0 && !pair ? <span className="settings-keys-or">{strings.keyboard.or}</span> : null}
          <Kbd className="settings-kbd">{key}</Kbd>
        </span>
      ))}
    </span>
  );
}

export function KeyboardSection() {
  const comments = commentsEnabled();
  return (
    <div className="settings-dense">
      <p className="settings-intro">{strings.keyboard.intro}</p>
      {SHORTCUT_GROUPS.map((group) => (
        <SettingsGroup key={group.title} title={group.title}>
          {group.items
            .filter((item) => item.feature !== 'comments' || comments)
            .map((item) => (
              <SettingsRow key={item.label} label={item.label} control={<Keys keys={item.keys} pair={item.pair === true} />} />
            ))}
        </SettingsGroup>
      ))}
      <SettingsGroup title={strings.keyboard.replayList}>
        <SettingsRow label={strings.keyboard.search} control={<Keys keys={[indexSearchShortcut(), INDEX_SEARCH_ALT_KEY]} />} />
      </SettingsGroup>
    </div>
  );
}
