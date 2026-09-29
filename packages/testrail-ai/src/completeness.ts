/**
 * What every report says about itself: whether it is the whole answer, and if
 * not, what is missing. A row cap, a skipped page or an optional lookup that
 * failed each become a warning, and `complete` is false exactly when there is one.
 */
export type Completeness = { complete: boolean; warnings: string[] };

export function completeness(...warnings: (string | false | null | undefined)[]): Completeness {
  const kept = warnings.filter((warning): warning is string => Boolean(warning));

  return { complete: kept.length === 0, warnings: kept };
}

/** Warnings as markdown quote lines, each after a blank line. */
export function warningLines(report: Completeness): string[] {
  return report.warnings.flatMap((warning) => ['', `> ⚠ ${warning}`]);
}
