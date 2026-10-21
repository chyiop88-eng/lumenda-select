import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir=join(root,'public');
const markets = JSON.parse(readFileSync(join(root,'config/markets.json'),'utf8'));
const products = JSON.parse(readFileSync(join(root,'config/products.json'),'utf8'));
let source=readFileSync(join(dir,'app.template.js'),'utf8');
if(!source.includes('__MARKETS_JSON__')||!source.includes('__PRODUCTS_JSON__'))
  throw new Error('Unknown app template');
source=source.replace('__MARKETS_JSON__',JSON.stringify(markets)).replace('__PRODUCTS_JSON__',JSON.stringify(products));
writeFileSync(join(dir,'app.js'),source,'utf8');

// Version HTML references to CSS/JS for safe long-lived browser caching.
// A deployment changes the version if any frontend asset changes, so returning
// customers never get mixed stale JS and new page markup.
const resources=['app.js','i18n.js','styles.css','bot.js','admin.js','order.js'];
const hash=createHash('sha256');
for(const name of resources)hash.update(readFileSync(join(dir,name)));
const fingerprint=hash.digest('hex').slice(0,12);
for(const page of ['index.html','admin.html','order.html']){
  const file=join(dir,page);
  const old=readFileSync(file,'utf8');
  const stamped=old.replace(
    /((?:src|href)="\/(?:styles\.css|app\.js|admin\.js|i18n\.js|bot\.js|order\.js))(?:\?v=[a-f0-9]{12})?"/g,
    (_full,start)=>start+'?v='+fingerprint+'"');
  writeFileSync(file,stamped,'utf8');
}
console.log('Browser app generated with',products.length,'products and',
  Object.keys(markets).length,'markets; asset version',fingerprint);
