export const UI_ATTRIBUTE = 'data-recorder-ui';
export const BLOCK_ATTRIBUTE = 'data-recorder-block';
export const blockProps = { [BLOCK_ATTRIBUTE]: '' } as const;
export const recorderUiProps = { [UI_ATTRIBUTE]: '' } as const;
export const CHAT_WIDGET_PRESETS = {
  crisp: '#crisp-chatbox, .crisp-client',
  intercom: '#intercom-container, .intercom-lightweight-app',
  zendesk: '#launcher, #webWidget, iframe[title="Messaging window"]',
} as const;
const escape = (value: string) => {
  if (!value || !/^[a-zA-Z_][\w-]*$/.test(value)) throw new Error(`Invalid selector identifier: ${value}`);
  return value;
};
export function blockSelector(options: {
  selectors?: string[];
  ids?: string[];
  classes?: string[];
  attributes?: string[];
  media?: boolean;
  presets?: (keyof typeof CHAT_WIDGET_PRESETS)[];
}): string {
  const selectors = [
    ...(options.selectors ?? []),
    ...(options.ids ?? []).map((id) => `#${escape(id)}`),
    ...(options.classes ?? []).map((name) => `.${escape(name)}`),
    ...(options.attributes ?? []).map((name) => `[${escape(name)}]`),
    ...(options.presets ?? []).map((name) => CHAT_WIDGET_PRESETS[name]),
    ...(options.media ? ['img, picture, video, audio, canvas, iframe, object, embed'] : []),
  ];
  if (typeof document === 'undefined' && options.selectors?.length) throw new Error('Raw selectors require a DOM for validation');
  for (const selector of selectors) {
    if (!selector?.trim()) throw new Error('Empty block selector');
    try {
      if (typeof document !== 'undefined') document.createDocumentFragment().querySelector(selector);
    } catch {
      throw new Error(`Invalid block selector: ${selector}`);
    }
  }
  return selectors.join(', ');
}
