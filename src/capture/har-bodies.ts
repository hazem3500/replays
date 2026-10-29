import type { NetworkBodyLimits } from '../shared/capture-profile.ts';
import { captureBody, type ReplayNetworkBody } from '../shared/network-bodies.ts';
import type { CompiledRedaction } from '../shared/redaction.ts';
import { isRecord } from '../shared/validate.ts';

/** The fields of a raw HAR entry that carry bodies (Playwright's `recordHar` with `content: 'embed'`). */
interface HarBodies {
  request?: { headers?: Array<{ name?: string; value?: string }>; postData?: { mimeType?: string; text?: string }; bodySize?: number };
  response?: { content?: { mimeType?: string; text?: string; encoding?: string; size?: number } };
}

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
const size = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined);

function requestType(request: NonNullable<HarBodies['request']>) {
  return request.postData?.mimeType ?? request.headers?.find((header) => header.name?.toLowerCase() === 'content-type')?.value;
}

/**
 * The request and response bodies of one raw HAR entry, as a replay keeps them (src/shared/network-bodies.ts). A
 * request without a body gets none; a response always gets a record, so "left out" and "empty" stay distinct.
 */
export function harEntryBodies(
  entry: unknown,
  limits: NetworkBodyLimits,
  rules: CompiledRedaction,
): { requestBody?: ReplayNetworkBody; responseBody: ReplayNetworkBody } {
  const raw: HarBodies = isRecord(entry) ? entry : {};
  const request = isRecord(raw.request) ? raw.request : {};
  const content = isRecord(raw.response) && isRecord(raw.response.content) ? raw.response.content : {};
  const redaction = { rules };
  const posted = request.postData === undefined ? undefined : text(request.postData.text);
  const requestBody =
    posted === undefined && !(size(request.bodySize) ?? 0)
      ? undefined
      : captureBody({ text: posted, mimeType: requestType(request), size: size(request.bodySize) }, limits, redaction);
  const responseBody = captureBody(
    { text: text(content.text), encoding: text(content.encoding), mimeType: text(content.mimeType), size: size(content.size) },
    limits,
    redaction,
  );
  return { ...(requestBody ? { requestBody } : {}), responseBody };
}
