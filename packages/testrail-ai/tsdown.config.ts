import { defineConfig } from 'tsdown';

export default defineConfig({
  // tsup-compatible filenames, so `exports` stays as written.
  outExtensions: ({ format }) =>
    format === 'es' ? { js: '.js', dts: '.d.ts' } : { js: '.cjs', dts: '.d.cts' },
  tsconfig: 'tsconfig.build.json',
  // `testing` is a real subpath export: anyone building on this package
  // should be able to test against a fake TestRail without a live instance.
  entry: { index: 'src/index.ts', advanced: 'src/advanced.ts', testing: 'src/testing.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: false,
  target: false,
});
