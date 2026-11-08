import type { ReplayBundle } from './bundle-types.ts';
import type { Session } from './recorder-session.ts';
import { recorderContext } from './host-context.ts';
import { redactText } from './redact.ts';
import { capAtWord } from './step-label.ts';
import type { RecorderOptions } from './types.ts';

export function annotateSession(session: Session | undefined, label: unknown, maxBytes: number): boolean {
  if (!session || session.steps.length >= 500 || typeof label !== 'string') return false;
  const sanitized = capAtWord(redactText(label, 200), 200).trim();
  if (!sanitized) return false;
  const action = { at: Date.now(), kind: 'action', label: sanitized };
  const bytes = new TextEncoder().encode(JSON.stringify(action)).length;
  if (session.bytes + bytes > maxBytes) return false;
  session.steps.push(action);
  session.bytes += bytes;
  return true;
}

export function snapshotContext(context: RecorderOptions['context'], startedAt: number, warn: (message: string) => void) {
  if (!context) return;
  try {
    return recorderContext(typeof context === 'function' ? context() : context, new Date(startedAt).toISOString());
  } catch {
    warn('Host context was omitted because it could not be captured safely');
    return;
  }
}

export function finishSessionExtras(bundle: ReplayBundle, session: Session): ReplayBundle {
  const track = session.performance;
  const origin = bundle.events[0]?.timestamp ?? session.startedAt;
  const relative = <T extends { at: number }>(entry: T): T => ({ ...entry, at: Math.max(0, entry.at - origin) });
  return {
    ...bundle,
    ...(track
      ? {
          performance: {
            ...track,
            entries: track.entries.map(relative),
            ...(track.frames ? { frames: track.frames.map(relative) } : {}),
            ...(track.layoutShifts ? { layoutShifts: track.layoutShifts.map(relative) } : {}),
          },
        }
      : {}),
    ...(session.context ? { context: session.context } : {}),
  };
}
