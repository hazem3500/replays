import { CheckIcon } from 'lucide-react';
import { plural } from '../plural.ts';
import { type FormEvent, type Ref, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { AnimatedIcon } from '@/components/animated-icon.tsx';
import { IconButton } from '@/components/icon-button.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Progress } from '@/components/ui/progress.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx';

import { formatClock, MAX_TAGS } from '../../shared/replay.ts';
import { pagePurposes } from '../purposes.ts';
import { replayHref, replayInSuiteHref } from '../routing/links.ts';
import { ACCEPTED_FILES, formatSize, type PreparedUpload, parseTags, prepareUpload, UploadError } from './prepare.ts';
import { sendUpload } from './send.ts';

export interface UploadReplayHandle {
  /** Opens the dialog, optionally straight into the preview of `file` (used by drag-and-drop). */
  open(file?: File): void;
}

type Phase =
  | { name: 'pick' }
  | { name: 'reading'; fileName: string }
  | { name: 'preview'; prepared: PreparedUpload }
  | { name: 'uploading'; prepared: PreparedUpload; loaded: number; total: number }
  | { name: 'opening'; prepared: PreparedUpload; id: string };

const UPLOAD_ICON = <AnimatedIcon name="upload" />;

function kindLabel(prepared: PreparedUpload) {
  if (prepared.kind === 'rrweb') return 'rrweb recording';
  return prepared.bundle?.meta.source === 'human' ? 'Replay bundle · human session' : 'Replay bundle · agent run';
}

function percent(loaded: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
}

/**
 * "Upload" button plus a modal dialog: choose or drop a .json / .json.gz file, preview what
 * was detected (bundle or plain rrweb), edit the title and start URL, upload with progress,
 * then open the stored replay.
 */
export function UploadReplay({
  ref,
  label = 'Upload',
  compact = false,
}: {
  ref?: Ref<UploadReplayHandle>;
  label?: string;
  /** Icon-only trigger with a tooltip, for dense toolbars. */
  compact?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const chooseButton = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const tagsInput = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController | undefined>(undefined);
  const readToken = useRef(0);
  const [phase, setPhase] = useState<Phase>({ name: 'pick' });
  const [error, setError] = useState<UploadError>();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [tags, setTags] = useState('');
  /** The picked purpose id, `''` for none; the picker only exists when the deployment defines purposes. */
  const [purpose, setPurpose] = useState('');
  const purposes = pagePurposes();
  const [status, setStatus] = useState('');
  const [zoneActive, setZoneActive] = useState(false);

  const reset = useCallback(() => {
    upload.current?.abort();
    upload.current = undefined;
    readToken.current += 1;
    setPhase({ name: 'pick' });
    setError(undefined);
    setStatus('');
    setTitle('');
    setUrl('');
    setTags('');
    setPurpose('');
  }, []);

  const loadFile = useCallback(async (file: File) => {
    const token = ++readToken.current;
    setError(undefined);
    setPhase({ name: 'reading', fileName: file.name });
    setStatus(`Reading ${file.name}…`);
    try {
      const prepared = await prepareUpload(file);
      if (token !== readToken.current) return;
      setTitle(prepared.title);
      setUrl('');
      setTags(prepared.bundle?.meta.tags?.join(', ') ?? '');
      const own = prepared.bundle?.meta.purpose;
      setPurpose(own && pagePurposes().some((item) => item.id === own) ? own : '');
      setPhase({ name: 'preview', prepared });
      setStatus(
        `${prepared.kind === 'bundle' ? 'Replay bundle' : 'rrweb recording'} ready: ${plural(prepared.eventCount, 'event')}, ${formatClock(prepared.duration)} long.`,
      );
    } catch (reason) {
      if (token !== readToken.current) return;
      setPhase({ name: 'pick' });
      setStatus('');
      setError(reason instanceof UploadError ? reason : new UploadError('This file could not be read.'));
    }
  }, []);

  const open = useCallback(
    (file?: File) => {
      if (phase.name === 'uploading' || phase.name === 'opening') return;
      if (!isOpen) {
        reset();
        setIsOpen(true);
      }
      if (file) void loadFile(file);
    },
    [isOpen, loadFile, phase.name, reset],
  );

  useImperativeHandle(ref, () => ({ open }), [open]);

  // The cursor follows the step: the file picker first, then the title once a file is read.
  useEffect(() => {
    if (!isOpen) return;
    // After the dialog has finished placing the cursor (the file button just unmounted).
    const frame = requestAnimationFrame(() => {
      if (phase.name === 'pick') chooseButton.current?.focus();
      if (phase.name === 'preview') titleInput.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, phase.name]);

  useEffect(() => () => upload.current?.abort(), []);

  function close() {
    reset();
    setIsOpen(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (phase.name !== 'preview') return;
    const prepared = phase.prepared;
    if (!title.trim()) {
      setError(new UploadError('Give the replay a title.'));
      titleInput.current?.focus();
      return;
    }
    const parsedTags = parseTags(tags);
    if (parsedTags.invalid.length > 0 || parsedTags.tooMany) {
      setError(
        new UploadError(
          parsedTags.tooMany
            ? `Use at most ${MAX_TAGS} tags.`
            : `Tags use lower-case letters, digits and . _ : - (up to 40 characters): ${parsedTags.invalid.join(', ')}.`,
        ),
      );
      tagsInput.current?.focus();
      return;
    }
    const controller = new AbortController();
    upload.current = controller;
    setError(undefined);
    setPhase({ name: 'uploading', prepared, loaded: 0, total: prepared.size });
    setStatus('Uploading…');
    let announced = 0;
    try {
      const { id, suiteId } = await sendUpload(
        prepared,
        { title, url, tags: parsedTags.tags, ...(purposes.length ? { purpose } : {}) },
        ({ loaded, total }) => {
          setPhase((current) => (current.name === 'uploading' ? { ...current, loaded, total } : current));
          const quarter = Math.floor(percent(loaded, total) / 25) * 25;
          if (quarter > announced && quarter < 100) {
            announced = quarter;
            setStatus(`Uploading, ${quarter}%`);
          }
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setPhase({ name: 'opening', prepared, id });
      setStatus('Uploaded. Opening the replay…');
      location.assign(suiteId ? replayInSuiteHref(id, suiteId) : replayHref(id));
    } catch (reason) {
      if (controller.signal.aborted || (reason as Error).name === 'AbortError') return;
      setPhase({ name: 'preview', prepared });
      setStatus('');
      setError(reason instanceof UploadError ? reason : new UploadError('The upload failed. Try again.'));
    } finally {
      if (upload.current === controller) upload.current = undefined;
    }
  }

  function cancelUpload() {
    upload.current?.abort();
    upload.current = undefined;
    if (phase.name === 'uploading') setPhase({ name: 'preview', prepared: phase.prepared });
    setStatus('Upload cancelled.');
  }

  const prepared = phase.name === 'preview' || phase.name === 'uploading' || phase.name === 'opening' ? phase.prepared : undefined;
  const busy = phase.name === 'uploading' || phase.name === 'opening';
  const progress = phase.name === 'uploading' ? percent(phase.loaded, phase.total) : phase.name === 'opening' ? 100 : 0;

  return (
    <>
      {compact ? (
        <IconButton ref={trigger} label={label} hint="Upload a replay" tooltipSide="bottom" onClick={() => open()} aria-haspopup="dialog">
          {UPLOAD_ICON}
        </IconButton>
      ) : (
        <Button ref={trigger} variant="outline" className="upload-trigger" aria-label={label} onClick={() => open()} aria-haspopup="dialog">
          {UPLOAD_ICON}
          <span className="upload-label">{label}</span>
        </Button>
      )}
      <Dialog
        open={isOpen}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent
          className="upload-dialog gap-3 sm:max-w-lg"
          data-testid="upload-dialog"
          initialFocus={chooseButton}
          finalFocus={trigger}
          showCloseButton
        >
          <DialogHeader>
            <DialogTitle className="text-[length:var(--text-md)] font-semibold">Upload a replay</DialogTitle>
            <DialogDescription className="sr-only">
              Upload a replay.json bundle or a plain rrweb export, as .json or .json.gz, up to 25 MB.
            </DialogDescription>
          </DialogHeader>

          {!prepared ? (
            <div
              className="upload-zone"
              data-active={zoneActive || undefined}
              aria-busy={phase.name === 'reading'}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('Files')) return;
                event.preventDefault();
                event.stopPropagation();
                setZoneActive(true);
              }}
              onDragLeave={() => setZoneActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setZoneActive(false);
                const file = event.dataTransfer.files[0];
                if (file) void loadFile(file);
              }}
            >
              {phase.name === 'reading' ? (
                <p className="upload-zone-title">Reading {phase.fileName}…</p>
              ) : (
                <>
                  <p className="upload-zone-title">Drop a replay.json or rrweb export</p>
                  <p className="upload-zone-hint">.json or .json.gz, up to 25 MB. Inputs are masked and URL secrets redacted on upload.</p>
                  <Button ref={chooseButton} variant="outline" onClick={() => input.current?.click()}>
                    Choose file…
                  </Button>
                </>
              )}
              <input
                ref={input}
                type="file"
                accept={ACCEPTED_FILES}
                hidden
                data-testid="upload-input"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void loadFile(file);
                }}
              />
            </div>
          ) : (
            <form id="upload-form" className="upload-form" onSubmit={(event) => void submit(event)} noValidate>
              <dl className="upload-facts" aria-label="Detected recording">
                <div className="upload-fact-wide">
                  <dt>File</dt>
                  <dd title={prepared.fileName}>
                    {prepared.fileName} <span className="upload-muted">· {formatSize(prepared.size)}</span>
                  </dd>
                </div>
                <div>
                  <dt>Kind</dt>
                  <dd>{kindLabel(prepared)}</dd>
                </div>
                <div>
                  <dt>Events</dt>
                  <dd className="mono">{prepared.eventCount.toLocaleString('en')}</dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd className="mono">{formatClock(prepared.duration)}</dd>
                </div>
                <div>
                  <dt>Viewport</dt>
                  <dd className="mono">
                    {prepared.viewport.width} × {prepared.viewport.height}
                  </dd>
                </div>
                <div className="upload-fact-wide">
                  <dt>Start URL</dt>
                  <dd className="mono" title={prepared.startUrl}>
                    {prepared.startUrl ?? <span className="upload-muted">Not in the file</span>}
                  </dd>
                </div>
              </dl>
              <label className="upload-field" htmlFor="upload-title-input">
                <span>Title</span>
                <Input
                  id="upload-title-input"
                  ref={titleInput}
                  value={title}
                  maxLength={200}
                  required
                  disabled={busy}
                  aria-invalid={error?.message === 'Give the replay a title.' || undefined}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
              </label>
              <label className="upload-field" htmlFor="upload-url-input">
                <span>
                  Start URL <span className="upload-muted">optional</span>
                </span>
                <Input
                  id="upload-url-input"
                  value={url}
                  inputMode="url"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={prepared.startUrl ?? 'https://…'}
                  disabled={busy}
                  aria-describedby="upload-url-hint"
                  onChange={(event) => setUrl(event.currentTarget.value)}
                />
                <small id="upload-url-hint">
                  {prepared.startUrl ? 'Leave empty to keep the URL from the file.' : 'Needed when the recording has no Meta event.'}
                </small>
              </label>
              <label className="upload-field" htmlFor="upload-tags-input">
                <span>
                  Tags <span className="upload-muted">optional</span>
                </span>
                <Input
                  id="upload-tags-input"
                  ref={tagsInput}
                  value={tags}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="smoke, checkout"
                  disabled={busy}
                  data-testid="upload-tags"
                  onChange={(event) => setTags(event.currentTarget.value)}
                />
              </label>
              {purposes.length ? (
                <div className="upload-field">
                  <span id="upload-purpose-label">
                    Purpose <span className="upload-muted">optional</span>
                  </span>
                  <Select
                    items={[{ value: '', label: 'None' }, ...purposes.map((item) => ({ value: item.id, label: item.label }))]}
                    value={purpose}
                    disabled={busy}
                    onValueChange={(next) => setPurpose(String(next ?? ''))}
                  >
                    <SelectTrigger aria-labelledby="upload-purpose-label" data-testid="upload-purpose" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectItem value="">None</SelectItem>
                      {purposes.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {busy ? (
                <div className="upload-progress">
                  <Progress value={progress} aria-label="Upload progress" className="flex-1" />
                  <span className="upload-progress-label mono">
                    {phase.name === 'opening' ? (
                      <span className="text-swap inline-flex items-center gap-1">
                        <CheckIcon className="success-check size-3.5 text-[var(--success)]" aria-hidden="true" />
                        Opening…
                      </span>
                    ) : (
                      `${progress}%`
                    )}
                  </span>
                </div>
              ) : null}
            </form>
          )}

          {error ? (
            <p key={error.message} className="upload-error shake" role="alert">
              {error.message}
              {error.existingId ? (
                <>
                  {' '}
                  <a href={replayHref(error.existingId)}>Open the stored replay</a>
                </>
              ) : null}
            </p>
          ) : null}
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {status}
          </p>

          <DialogFooter>
            {prepared ? (
              <>
                {phase.name === 'uploading' ? (
                  <Button variant="outline" onClick={cancelUpload}>
                    Cancel upload
                  </Button>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={reset}>
                    Choose another file
                  </Button>
                )}
                <Button type="submit" form="upload-form" disabled={busy}>
                  {busy ? 'Uploading…' : 'Upload'}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
