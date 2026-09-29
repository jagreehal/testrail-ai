import { defineConfig } from 'tsdown';

export default defineConfig({
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  tsconfig: 'tsconfig.build.json',
  entry: { index: 'src/index.ts', stdio: 'src/stdio.ts', http: 'src/http.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  target: false,
});
