// Isolated staging build: Netlify production remains untouched.
import { build } from 'esbuild';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const tmp = path.join(root, '.cloudflare-generated');
const functions = path.join(root, 'functions', '.netlify', 'functions');
const assets = ['index.html', 'styles.css', 'app.js', 'preanalysis.js',
  'prediction-ui.js', 'scorers-ui.js', 'lineup-ui.js'];
const routes = ['fixtures', 'history', 'modelhistory', 'prediction',
  'scorers', 'lineup-check'];

await Promise.all([dist, tmp, path.join(root, 'functions')].map(
  dir => rm(dir, {recursive:true,force:true})));
for(const dir of [dist,tmp,functions]) await mkdir(dir,{recursive:true});
for(const asset of assets)
  await copyFile(path.join(root,asset),path.join(dist,asset));

await writeFile(path.join(dist,'_routes.json'),JSON.stringify({
  version:1,include:['/.netlify/functions/*'],exclude:[]
},null,2)+'\n');

const entryPoints = [];
for(const name of routes){
  const file = path.join(tmp,name+'.mjs');
  const code = [
    "import { handler } from '../netlify/functions/"+name+".js';",
    "export async function onRequest({request,env}) {",
    "  const url = new URL(request.url);",
    "  const queryStringParameters = Object.fromEntries(url.searchParams);",
    "  const body = ['GET','HEAD'].includes(request.method) ? null : await request.text();",
    "  try {",
    "    const result = await handler({httpMethod:request.method,queryStringParameters,body,headers:Object.fromEntries(request.headers),isBase64Encoded:false},{env});",
    "    const headers = new Headers(result?.headers||{});",
    "    if(!headers.has('content-type')) headers.set('content-type','application/json; charset=utf-8');",
    "    headers.set('cache-control','no-store');",
    "    return new Response(result?.body??'',{status:Number(result?.statusCode)||200,headers});",
    "  } catch(error) {",
    "    console.error('MatchScope handler error:',"+JSON.stringify(name)+",error?.name);",
    "    return new Response(JSON.stringify({error:'Analyse momentanément indisponible'}),{status:502,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});",
    "  }",
    "}"
  ].join('\n')+'\n';
  await writeFile(file,code);entryPoints.push(file);
}
// Status endpoint never discloses secret values. Protected by Cloudflare Access.
const health = path.join(tmp, 'health.mjs');
await writeFile(health, [
  "export function onRequest({env}) {",
  "  return new Response(JSON.stringify({",
  "    app:'MatchScope AI Cloudflare staging',",
  "    checkedAt:new Date().toISOString(),",
  "    configured:{",
  "      sportmonks:Boolean(env.SPORTMONKS_API_TOKEN),",
  "      supabaseUrl:Boolean(env.SUPABASE_URL),",
  "      supabaseSecret:Boolean(env.SUPABASE_SECRET_KEY)",
  "    }",
  "  }),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});",
  "}"
].join('\n') + '\n');
entryPoints.push(health);

await build({entryPoints,outdir:functions,outbase:tmp,entryNames:'[name]',
  bundle:true,platform:'neutral',format:'esm',target:['es2022'],
  splitting:false,logLevel:'info'});
console.log('Cloudflare Pages staging:',routes.length,'API routes prepared');
