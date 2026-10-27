export const LAYOUTS = ['performance', 'debugging', 'walkthrough', 'design'] as const;
export type ComparisonLayout = (typeof LAYOUTS)[number];
export const LAYOUT_LABELS: Record<ComparisonLayout, string> = {
  performance: 'Performance',
  debugging: 'Debugging',
  walkthrough: 'Walkthrough',
  design: 'Design review',
};
export const PANELS = ['performance', 'errors', 'journey', 'console', 'network', 'paints'] as const;
export type ComparisonPanel = (typeof PANELS)[number];
export const PANEL_LABELS: Record<ComparisonPanel, string> = {
  performance: 'Captured performance',
  errors: 'Captured errors',
  journey: 'Steps & captions',
  console: 'Console',
  network: 'Network requests',
  paints: 'Paint observations',
};
export const PANEL_SIZES = ['compact', 'regular', 'large'] as const;
export type PanelSize = (typeof PANEL_SIZES)[number];
export interface PanelPreference {
  id: ComparisonPanel;
  visible: boolean;
  size: PanelSize;
}
export interface LayoutPreference {
  canvas: PanelSize;
  panels: PanelPreference[];
}
export type ComparisonPreferences = Record<ComparisonLayout, LayoutPreference>;

export function defaultLayout(layout: ComparisonLayout): LayoutPreference {
  const first: Record<ComparisonLayout, ComparisonPanel[]> = {
    performance: ['performance', 'network', 'journey'],
    debugging: ['errors', 'console', 'network'],
    walkthrough: ['journey', 'errors'],
    design: ['paints', 'journey'],
  };
  const order = [...first[layout], ...PANELS.filter((id) => !first[layout].includes(id))];
  return {
    canvas: layout === 'design' ? 'large' : 'regular',
    panels: order.map((id) => ({
      id,
      visible: first[layout].includes(id),
      size: id === first[layout][0] ? 'large' : 'regular',
    })),
  };
}

/** Versioned, defensive storage. Every layout always retains each panel exactly once. */
export function parsePreferences(raw: string | null): ComparisonPreferences {
  let stored: unknown;
  try {
    stored = raw ? JSON.parse(raw) : undefined;
  } catch {
    stored = undefined;
  }
  const root = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const data = root.version === 1 && root.layouts && typeof root.layouts === 'object' ? (root.layouts as Record<string, unknown>) : {};
  return Object.fromEntries(
    LAYOUTS.map((layout) => {
      const fallback = defaultLayout(layout);
      const value = data[layout];
      if (!value || typeof value !== 'object') return [layout, fallback];
      const candidate = value as Record<string, unknown>;
      const panels: PanelPreference[] = [];
      for (const item of Array.isArray(candidate.panels) ? candidate.panels : []) {
        if (!item || typeof item !== 'object') continue;
        const panel = item as Record<string, unknown>;
        const id = panel.id as ComparisonPanel;
        if (!PANELS.includes(id) || panels.some((entry) => entry.id === id)) continue;
        const defaults = fallback.panels.find((entry) => entry.id === id)!;
        panels.push({
          id,
          visible: typeof panel.visible === 'boolean' ? panel.visible : defaults.visible,
          size: PANEL_SIZES.includes(panel.size as PanelSize) ? (panel.size as PanelSize) : defaults.size,
        });
      }
      panels.push(...fallback.panels.filter((panel) => !panels.some((entry) => entry.id === panel.id)));
      return [layout, { canvas: PANEL_SIZES.includes(candidate.canvas as PanelSize) ? candidate.canvas : fallback.canvas, panels }];
    }),
  ) as ComparisonPreferences;
}

export function movePanel(preference: LayoutPreference, id: ComparisonPanel, direction: -1 | 1): LayoutPreference {
  const panels = [...preference.panels];
  const index = panels.findIndex((panel) => panel.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= panels.length) return preference;
  [panels[index], panels[next]] = [panels[next]!, panels[index]!];
  return { ...preference, panels };
}
