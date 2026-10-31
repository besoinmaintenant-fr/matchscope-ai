import { build } from 'esbuild';
await build({
  entryPoints: ['cloudflare/collector.js'],
  outfile: 'cloudflare/dist/collector.mjs',
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: ['es2022'],
  logLevel: 'info'
});
console.log('Collector bundle prepared but NOT deployed.');
