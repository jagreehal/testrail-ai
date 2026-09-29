/**
 * Copies every ```ts block from the READMEs into readme/, one file per block, so
 * `tsc` checks the documented examples against the built packages exactly as it
 * checks src/consumer.ts. Names a snippet leaves to the reader (`config`,
 * `principal`, …) are declared in src/readme-placeholders.d.ts.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dirname, '../../..');

const out = join(import.meta.dirname, '../readme');

const readmes = [
  join(root, 'README.md'),
  ...['packages', 'apps'].flatMap((dir) =>
    readdirSync(join(root, dir)).map((name) => join(root, dir, name, 'README.md')),
  ),
].filter((file) => {
  try {
    return readFileSync(file, 'utf8').length > 0;
  } catch {
    return false;
  }
});

rmSync(out, { recursive: true, force: true });

mkdirSync(out);

let count = 0;

for (const file of readmes) {
  const source = relative(root, file);
  const blocks = [...readFileSync(file, 'utf8').matchAll(/^```ts\n([\s\S]*?)^```$/gm)];

  for (const [index, block] of blocks.entries()) {
    const name = `${source.replaceAll(/[/.]/g, '-')}-${index + 1}.ts`;
    writeFileSync(join(out, name), `// From ${source}, block ${index + 1}.\n${block[1]}\nexport {};\n`);
    count++;
  }
}

console.log(`${count} README snippets from ${readmes.length} files.`);
