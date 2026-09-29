import { story } from 'executable-stories-vitest';
import { describe, expect, it } from 'vitest';
import {
  clip,
  clusterByMessage,
  failedStepNumbers,
  htmlToText,
  normaliseMessage,
  stepsTable,
  table,
  toUnix,
  truncate,
} from './format';
import { parseSteps } from './schemas';

/**
 * Presentation is not cosmetic here. A TestRail case carries kilobytes of HTML
 * per field; a 250-row page of raw JSON evicts everything else from a model's
 * context window. Every function in this file exists to make the data cheap
 * enough to actually read.
 */

describe('Converting TestRail rich text to readable plain text', () => {
  it('turns block-level HTML into line breaks', ({ task }) => {
    story.init(task, { tags: ['formatting'], covers: ['src/format.ts'] });

    story.given('rich text stored as HTML fragments');
    story.when('it is converted');
    story.then('paragraphs are separated by a blank line, as markdown expects');
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one\n\ntwo');

    story.and('list items become markdown bullets');
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('- a\n- b');

    story.and('unclosed <p> still breaks — valid HTML that TestRail really emits');
    expect(htmlToText('<p>one<p>two')).toBe('one\ntwo');

    story.but('nesting never produces more than one blank line');
    expect(htmlToText('<div><p>a</p></div><div><p>b</p></div>')).toBe('a\n\nb');
  });

  it('keeps the line breaks in content pasted from Jira', ({ task }) => {
    story.init(task, { tags: ['formatting'], covers: ['src/format.ts'] });

    story.given('a Gherkin scenario pasted from Jira, one <span> per line');
    story.note('Jira code blocks carry no block-level tag at all — each line is a styled span.');

    const html =
      '<p><span data-ds--code--row="" style="white-space: pre;"><strong>Given</strong> a publisher</span>' +
      '<span data-ds--code--row="" style="white-space: pre;"><strong>When</strong> I import</span>' +
      '<span data-ds--code--row="" style="white-space: pre;"><strong>Then</strong> it is skipped</span></p>';

    story.code({ label: 'Stored HTML', content: html, lang: 'html' });

    story.when('it is converted');
    const text = htmlToText(html);
    story.code({ label: 'Result', content: text });

    story.then('each Gherkin line survives on its own line');
    story.note('Before this was handled the whole scenario collapsed onto one unreadable line.');
    expect(text).toBe('Given a publisher\nWhen I import\nThen it is skipped');
  });

  it('decodes HTML entities exactly once', ({ task }) => {
    story.init(task, { tags: ['formatting'], covers: ['src/format.ts'] });

    story.given('text containing the entities TestRail emits');
    story.when('it is converted');
    story.then('named and numeric entities both decode');
    expect(htmlToText('a&nbsp;b')).toBe('a b');
    expect(htmlToText('&quot;x&quot; &#39;y&#39;')).toBe('"x" \'y\'');
    expect(htmlToText('&#8594; &#x2192;')).toBe('→ →');

    story.but('a double-encoded tag must not decode into a real one');
    story.note('Decoding &amp; last is what prevents &amp;lt;script&amp;gt; becoming markup.');
    expect(htmlToText('&amp;lt;script&amp;gt;')).toBe('&lt;script&gt;');
  });

  it('drops inline styling but never the content', ({ task }) => {
    story.init(task, { tags: ['formatting'] });

    story.given("a paragraph carrying TestRail's editor styling");
    const html = '<p style="margin: 12px 0px; font-family: sans-serif; color: rgb(65,65,65);">Hello</p>';
    story.when('it is converted');
    story.then('only the words remain');
    expect(htmlToText(html)).toBe('Hello');
  });

  it('is safe on empty and missing values', ({ task }) => {
    story.init(task, { tags: ['formatting', 'edge-case'] });
    story.given('a field that is null, undefined or empty');
    story.when('it is converted');
    story.then('an empty string comes back rather than a crash');
    expect(htmlToText(null)).toBe('');
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText('')).toBe('');
  });
});

describe('Truncating without lying', () => {
  it('marks a cut in prose and stays inline in table cells', ({ task }) => {
    story.init(task, { tags: ['formatting'] });

    story.given('text longer than the budget');
    story.when('it is truncated for prose');
    story.then('the reader is told how much was removed');
    story.note('A silent cut reads as fact; a marked one reads as a cut.');
    expect(truncate('a'.repeat(20), 5)).toMatch(/^aaaaa\n…\[truncated, 15 more chars]$/);

    story.and('short text is left alone');
    expect(truncate('abc', 10)).toBe('abc');

    story.when('the same text is clipped for a table cell');
    story.then('it ends in an ellipsis and contains no newline');
    expect(clip('abcdefghij', 5)).toBe('abcd…');
    expect(clip('x'.repeat(200), 20)).not.toContain('\n');
  });
});

describe('Grouping failures by cause', () => {
  it('collapses the same bug reported with different numbers', ({ task }) => {
    story.init(task, { tags: ['clustering'], covers: ['src/format.ts'] });

    story.given('two failures that are the same bug with different timings');
    const first = 'Timeout after 30000ms at foo.ts:12:5 (trace 0xAB12)';
    const second = 'Timeout after 45000ms at foo.ts:98:2 (trace 0xFF99)';
    story.table({ label: 'Messages', columns: ['Message'], rows: [[first], [second]] });

    story.when('their messages are normalised');
    story.json({ label: 'Normalised', value: normaliseMessage(first) });

    story.then('they reduce to the same signature');
    story.note('Digit runs are replaced wholesale — `30000ms` and `45000ms` must not split one bug in two.');
    expect(normaliseMessage(first)).toBe(normaliseMessage(second));

    story.but('a genuinely different failure keeps its own signature');
    expect(normaliseMessage(first)).not.toBe(normaliseMessage('Element not found: #submit'));
  });

  it('collapses uuids and timestamps too', ({ task }) => {
    story.init(task, { tags: ['clustering'] });
    story.given('two runs of the same failure with different ids and times');
    story.when('their messages are normalised');
    story.then('the run-specific parts do not keep them apart');
    expect(normaliseMessage('run 3f2504e0-4f89-11d3-9a0c-0305e82c3301 at 2026-05-01T10:00:00Z')).toBe(
      normaliseMessage('run 8a1b2c3d-4f89-11d3-9a0c-0305e82c3301 at 2026-06-02T11:30:00Z'),
    );
  });

  it('groups a mixed set of failures into distinct clusters', ({ task }) => {
    story.init(task, { tags: ['clustering'] });

    story.given('three failures, two of which share a cause');

    const failures = [
      { id: 1, comment: 'Timeout after 100ms' },
      { id: 2, comment: 'Timeout after 200ms' },
      { id: 3, comment: 'Element not found' },
    ];

    story.when('they are clustered');
    const clusters = clusterByMessage(failures, (row) => row.comment);

    story.then('two clusters come back, not three');
    expect(clusters.size).toBe(2);

    story.and('the shared cause holds both of its failures');
    expect([...clusters.values()].find((group) => group.length === 2)).toHaveLength(2);
  });

  it('labels an empty message rather than clustering on nothing', ({ task }) => {
    story.init(task, { tags: ['clustering', 'edge-case'] });
    story.given('a failure with no comment');
    story.when('its message is normalised');
    story.then('it is labelled explicitly');
    expect(normaliseMessage('')).toBe('(no message)');
  });
});

describe('Rendering tables', () => {
  it('escapes content that would otherwise break the layout', ({ task }) => {
    story.init(task, { tags: ['formatting'] });

    story.given('a cell containing a pipe and a newline');
    story.when('the table is rendered');
    const rendered = table(['a', 'b'], [['x|y', 'line1\nline2']]);
    story.code({ label: 'Rendered', content: rendered, lang: 'markdown' });

    story.then('the table is still exactly three lines');
    expect(rendered.split('\n')).toHaveLength(3);

    story.and('the pipe is escaped so it does not create a column');
    expect(rendered).toContain('x\\|y');
  });

  it('says "none" instead of rendering an empty table', ({ task }) => {
    story.init(task, { tags: ['formatting', 'edge-case'] });
    story.given('no rows');
    story.when('the table is rendered');
    story.then('a readable placeholder appears');
    expect(table(['a'], [])).toBe('_(none)_');
  });
});

describe('Reading dates the way people write them', () => {
  it('accepts ISO dates and relative offsets', ({ task }) => {
    story.init(task, { tags: ['input'], covers: ['src/format.ts'] });

    story.given("TestRail's filters, which take unix seconds");
    story.when('an ISO date is supplied');
    story.then('it converts');
    expect(toUnix('2026-05-01')).toBe(Math.floor(Date.parse('2026-05-01') / 1000));

    story.when("a relative offset like '7d' is supplied");
    story.then('it resolves to seven days ago');
    expect(Math.abs(toUnix('7d')! - Math.floor((Date.now() - 7 * 86_400_000) / 1000))).toBeLessThan(5);

    story.and('no value means no filter, not epoch zero');
    expect(toUnix(undefined)).toBeUndefined();
  });

  it('rejects prose loudly rather than silently returning everything', ({ task }) => {
    story.init(task, { tags: ['input', 'safety'] });

    story.given("an unparseable value like 'last month'");
    story.when('it is converted');
    story.then('it throws with guidance on the accepted formats');
    story.note('Silently dropping the filter would return the whole project and look like a valid answer.');
    expect(() => toUnix('last month')).toThrow(/Could not read/);
  });
});

describe('Structured test steps', () => {
  it('shows only the columns the instance actually populates', ({ task }) => {
    story.init(task, { tags: ['steps'], covers: ['src/format.ts'] });

    story.given('a case with steps but no recorded outcomes');
    const plain = stepsTable([{ content: 'Click login', expected: 'Form appears' }]);
    story.code({ label: 'Rendered', content: plain ?? '', lang: 'markdown' });

    story.then('only step and expected are shown');
    expect(plain).toContain('| # | step | expected |');

    story.when('the same steps carry actual results and statuses');

    const executed = stepsTable(
      [{ content: 'Click login', expected: 'Form appears', actual: 'Blank page', status_id: 5 }],
      (id) => (id === 5 ? 'failed' : String(id)),
    );

    story.code({ label: 'Rendered', content: executed ?? '', lang: 'markdown' });

    story.then('the actual and status columns appear');
    expect(executed).toContain('actual');
    expect(executed).toContain('failed');
  });

  it('strips HTML inside steps and ignores anything that is not a list', ({ task }) => {
    story.init(task, { tags: ['steps', 'edge-case'] });

    story.given('a step whose content is HTML');
    story.when('the table is rendered');
    const rendered = stepsTable([{ content: '<p>Go to <strong>login</strong></p>', expected: '' }]);
    story.then('the markup is gone but the words remain');
    expect(rendered).toContain('Go to login');
    expect(rendered).not.toContain('<strong>');

    story.but('a missing or empty step list renders nothing at all');
    expect(stepsTable(undefined)).toBeUndefined();
    expect(stepsTable([])).toBeUndefined();

    story.and('anything that is not a list decodes to no steps, and a cell that is not text to blank');
    expect(parseSteps('not an array')).toBeUndefined();
    expect(parseSteps([{ content: { html: '<p>x</p>' }, expected: 'Shown', status_id: 'five' }])).toEqual([
      { content: undefined, expected: 'Shown', actual: undefined, status_id: undefined },
    ]);
  });

  it('reports which step numbers failed', ({ task }) => {
    story.init(task, { tags: ['steps'] });

    story.given('a four-step test where step 2 failed and step 4 was blocked');

    const steps = [
      { content: 'a', status_id: 1 },
      { content: 'b', status_id: 5 },
      { content: 'c', status_id: 3 },
      { content: 'd', status_id: 2 },
    ];

    story.when('the failing steps are identified');
    story.then('they are reported 1-indexed, as a human counts them');
    expect(failedStepNumbers(steps)).toEqual([2, 4]);

    story.but('an untested step is not a failure');
    story.note('Step 3 was untested and is deliberately absent.');
    expect(failedStepNumbers([{ content: 'a', status_id: 3 }])).toEqual([]);
  });
});
