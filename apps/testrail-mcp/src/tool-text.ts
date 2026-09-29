import { z } from 'zod';

const PartsSchema = z.array(z.looseObject({ text: z.string().optional() }));

/**
 * The text of a tool result or a resource read, parts joined by newlines.
 * Non-text parts (images, embedded resources) contribute nothing.
 */
export function textOf(result: { content?: unknown; contents?: unknown }): string {
  return PartsSchema.parse(result.content ?? result.contents)
    .map((part) => part.text ?? '')
    .join('\n');
}
