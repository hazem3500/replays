import type { CdpLike } from '../session.ts';

/** The closed list of steps a capture script may contain. Arbitrary page scripts are intentionally not a step. */
export type RawStep =
  | { kind: 'click' | 'hover'; selector: string; label?: string }
  | { kind: 'type' | 'fill'; selector: string; text: string; label?: string }
  | { kind: 'press'; key: string; label?: string }
  | { kind: 'wait'; ms: number; label?: string }
  | { kind: 'wait'; selector: string; state?: WaitState; timeout?: number; label?: string }
  | { kind: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; pixels?: number; label?: string }
  | { kind: 'scroll'; selector: string; label?: string }
  | { kind: 'goto'; url: string; label?: string }
  /** A PNG of the page at this moment, saved as `shots/<name>.png` in the output directory. */
  | { kind: 'shot'; name: string; label?: string };

/** What a selector wait waits for: a visible match (default), any match in the DOM, or no visible match. */
export type WaitState = 'visible' | 'attached' | 'hidden';

export interface LaunchOptions {
  viewport: { width: number; height: number };
  /** Where the sanitized-later HAR must be written by `finish()`. */
  harPath: string;
  /** Where the MP4 must be written by `finish()`, or undefined for no video. */
  videoPath?: string;
  /** Embed request and response bodies in the HAR; only asked of drivers with `recordsBodies`. */
  bodies?: boolean;
  /** A Playwright storage state file (cookies and local storage) to start the browser signed in; see `readStateFile`. */
  state?: string;
}

/**
 * A browser the capture CLI can drive. The recorder itself is driver-independent (session.ts speaks CDP);
 * a driver only launches the browser, runs steps, and produces the HAR and the optional video.
 */
export interface CaptureDriver {
  readonly name: string;
  /** The HAR can carry bodies (`launch({ bodies: true })`); without it a capture asking for bodies keeps headers only. */
  readonly recordsBodies?: boolean;
  /** Starts a browser on about:blank, begins the HAR (and video), and returns a CDP connection to the page. */
  launch(options: LaunchOptions): Promise<CdpLike>;
  /** Resolves when the person closes the page or the browser window (manual recordings); drivers that cannot tell leave it out. */
  closed?(): Promise<void>;
  open(url: string): Promise<void>;
  /** Runs one step; capture saves a `shot` step through `screenshot`, so it never reaches this. */
  step(step: RawStep): Promise<void>;
  wait(ms: number): Promise<void>;
  /** Saves a PNG of the page; drivers that cannot leave it out, and a `shot` step then fails the capture. */
  screenshot?(path: string): Promise<void>;
  /** Stops the HAR and video; both files exist afterwards. */
  finish(): Promise<void>;
  close(): Promise<void>;
}
