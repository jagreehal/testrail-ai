import { isNotPassing, statusKind } from './status';
import type { StepResult } from './types';

/**
 * Turning TestRail rows into something worth spending context on.
 *
 * The single biggest failure of a naive TestRail MCP server is dumping raw JSON
 * at the model: one test case on a real instance carries several kilobytes of
 * HTML in `custom_steps` and `custom_preconds`, and a 250-row page of those will
 * evict everything else from the window. So: text over JSON, HTML stripped,
 * fields projected, and long prose truncated with a marker rather than silently.
 */

/**
 * TestRail stores rich-text fields as HTML fragments. Models read markdown-ish
 * plain text far more cheaply, and none of the markup carries meaning here.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';

  return (
    html
      // Content pasted from Jira — extremely common in TestRail — wraps each line
      // of a code block in its own <span>, with no block tag anywhere. Without
      // this, a Gherkin scenario or a stack trace collapses onto one line.
      .replace(/<span[^>]*(?:data-ds--code--row|white-space:\s*pre)[^>]*>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<hr\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|ul|ol|table|pre|blockquote|h[1-6])>/gi, '\n')
      // Opening block tags too: unclosed <p> is valid HTML and TestRail emits it.
      // A zero-width lookahead, so the tag itself is left intact for the strip below.
      .replace(/(?=<(?:p|div|tr|h[1-6])[\s>])/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      // Entities TestRail's editor actually emits.
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&#x?[0-9a-f]+;/gi, (entity) => {
        const code =
          entity.startsWith('&#x') || entity.startsWith('&#X')
            ? Number.parseInt(entity.slice(3, -1), 16)
            : Number.parseInt(entity.slice(2, -1), 10);

        return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
      })
      // Ampersand last, so `&amp;lt;` does not decode twice into a fake tag.
      .replace(/&amp;/g, '&')
      // Zero-width characters travel in pasted content and cost tokens for nothing.
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Truncate visibly. A silent cut reads as fact; a marked one reads as a cut. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated, ${text.length - max} more chars]`;
}

/** `1 run`, `2 runs`. The noun is singular; `plural` covers irregular forms. */
export function pluralize(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/**
 * Truncation for table cells and headings, where `truncate`'s newline and char
 * count would wreck the layout. Same honesty, one character.
 */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function unixToIso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

/** Just the date — the time of day is noise in almost every table we print. */
export function unixToDate(seconds: number | null | undefined): string {
  return seconds ? new Date(seconds * 1000).toISOString().slice(0, 10) : '';
}

/**
 * TestRail's date filters take unix seconds. Models produce `2026-05-01`, or
 * `7d`, or `last month`. Accepting the first two and rejecting the rest loudly
 * is what stops a mistyped filter from silently returning the whole project.
 */
const UNIT_MS = new Map([
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['w', 604_800_000],
]);

export function toUnix(value: string | undefined): number | undefined {
  if (!value) return undefined;

  // Relative: 7d, 12h, 3w. The form models reach for when asked "recently".
  const relative = /^(\d+)\s*([dhw])$/i.exec(value.trim());

  if (relative) {
    const amount = Number(relative[1]);
    // The pattern only matches d, h or w.
    const ms = UNIT_MS.get(relative[2]!.toLowerCase()) ?? 0;

    return Math.floor((Date.now() - amount * ms) / 1000);
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    throw new Error(
      `Could not read '${value}' as a date. Use an ISO date (2026-05-01), an ISO timestamp, or a relative offset like 7d / 24h / 2w.`,
    );
  }

  return Math.floor(parsed / 1000);
}

/**
 * A compact markdown table. Cheaper per row than JSON (no repeated keys) and
 * models read it reliably.
 */
export function table(headers: string[], rows: (string | number | null | undefined)[][]): string {
  if (rows.length === 0) return '_(none)_';

  const cell = (value: string | number | null | undefined) =>
    String(value ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');

  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

/**
 * Structured steps (`custom_steps_separated`, template 2) and their per-step
 * outcomes (`custom_step_results`).
 *
 * Worth handling separately from the plain-text fields: when a manual test fails
 * at step 4 of 7, the step results are where the actual evidence lives, and
 * dumping them as raw JSON — or worse, ignoring them — throws away the single
 * most useful thing in the record.
 */
export function stepsTable(
  steps: StepResult[] | undefined,
  statusName?: (id: number) => string,
): string | undefined {
  if (!steps || steps.length === 0) return undefined;

  const rows = steps;
  // Only show the columns this instance actually populates.
  const hasActual = rows.some((step) => step.actual?.trim());
  const hasStatus = rows.some((step) => step.status_id !== undefined);

  const headers = ['#', 'step', 'expected'];

  if (hasActual) headers.push('actual');

  if (hasStatus) headers.push('status');

  return table(
    headers,
    rows.map((step, index) => {
      const cells: (string | number)[] = [
        index + 1,
        clip(htmlToText(step.content ?? ''), 300),
        clip(htmlToText(step.expected ?? ''), 300),
      ];

      if (hasActual) cells.push(clip(htmlToText(step.actual ?? ''), 300));

      if (hasStatus) {
        const id = step.status_id;
        cells.push(id === undefined ? '' : (statusName?.(id) ?? String(id)));
      }

      return cells;
    }),
  );
}

const NO_CUSTOM = new Map<number, never>();

/** The step numbers that did not pass — the "it broke at step 4" answer. */
export function failedStepNumbers(steps: StepResult[] | undefined): number[] {
  return (steps ?? []).flatMap((step, index) =>
    step.status_id !== undefined && isNotPassing(statusKind(step.status_id, NO_CUSTOM)) ? [index + 1] : [],
  );
}

/**
 * Group failures by their message so triage sees "3 clusters", not "47 failures".
 * The normalisation strips the parts that differ between runs of the same bug —
 * ids, hex, timestamps, line/column numbers — so genuinely identical failures
 * collapse together and genuinely different ones do not.
 */
export function clusterByMessage<T>(items: T[], messageOf: (item: T) => string): Map<string, T[]> {
  const clusters = new Map<string, T[]>();

  for (const item of items) {
    const key = normaliseMessage(messageOf(item));
    const bucket = clusters.get(key);

    if (bucket) bucket.push(item);
    else clusters.set(key, [item]);
  }

  return clusters;
}

export function normaliseMessage(message: string): string {
  return (
    htmlToText(message)
      .toLowerCase()
      .replace(/0x[0-9a-f]+/g, '<hex>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
      .replace(/\d{4}-\d{2}-\d{2}[t ][\d:.]+z?/g, '<timestamp>')
      .replace(/:\d+:\d+/g, ':<line>:<col>')
      // Every digit run, not `\b\d+\b`: a word boundary needs a non-word char
      // after the digits, so `30000ms` would survive and `30000ms` vs `45000ms`
      // would split one bug across two clusters.
      .replace(/\d+/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || '(no message)'
  );
}

/** Every tool answers as text; this keeps the shape in one place. */
export function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * A tool-level failure is a RESULT with `isError`, not a thrown protocol error:
 * the model sees it and can recover, where a protocol error never reaches the
 * conversation at all.
 */
export function errorResult(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);

  return { isError: true as const, content: [{ type: 'text' as const, text: message }] };
}
