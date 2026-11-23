import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: node ASTER-WING-무기-버프-도감.bundle.mjs <compiled.html> <standalone.html>');
}

const html = await readFile(inputPath, 'utf8');
const stylesheet = html.match(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/i)?.[0];
const stylesheetUrl = stylesheet?.match(/\bhref=["']([^"']+)["']/i)?.[1];
const runtime = html.match(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*><\/script\s*>/i)?.[0];
const runtimeUrl = runtime?.match(/\bsrc=["']([^"']+)["']/i)?.[1];

function assertKitUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://static.devin.ai' || !url.pathname.startsWith('/artifact-kit/')) {
    throw new Error(`Unexpected artifact-kit asset URL: ${value}`);
  }
}

if (!stylesheet || !stylesheetUrl || !runtime || !runtimeUrl) {
  throw new Error('Compiled artifact is missing its expected kit CSS or JS asset.');
}
assertKitUrl(stylesheetUrl);
assertKitUrl(runtimeUrl);

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

const [css, js] = await Promise.all([fetchText(stylesheetUrl), fetchText(runtimeUrl)]);
if (/@import\b|url\(\s*["']?https?:\/\//i.test(css)) {
  throw new Error('Artifact-kit CSS contains another external asset.');
}
if (/\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(|new\s+(?:Shared)?Worker|new\s+WebSocket|sendBeacon/i.test(js)) {
  throw new Error('Artifact-kit JS contains a network dependency.');
}

let standalone = html
  .replace(stylesheet, () => `<style>\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`)
  .replace(runtime, () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`)
  .replace(/<html\b[^>]*lang=["'][^"']+["'][^>]*>/i, '<html lang="ko">')
  .replace(/<title>[^<]*<\/title>/i, '<title>ASTER WING | 무기·버프·격납고 도감</title>');

const markup = standalone.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
const externalAssets = [...markup.matchAll(/<(?:script|img|link)\b[^>]*\b(?:src|href)=["']https?:\/\/[^"']+["'][^>]*>/gi)];
if (externalAssets.length) throw new Error(`Standalone artifact still has external assets: ${externalAssets.map(x => x[0]).join(' | ')}`);
if (!standalone.includes('data:font/woff2;base64,')) throw new Error('Embedded Hangul font supplement is missing.');

await writeFile(outputPath, standalone);
console.log(`Wrote ${outputPath} (${Buffer.byteLength(standalone)} bytes); kit CSS and JS are inline, external runtime assets: 0.`);
