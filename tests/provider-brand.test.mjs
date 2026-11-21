import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {getProviderBrand,listProviderBrands}=require('../src/providers/brand');
test('all registered providers have stable terminal-safe short marks and real labels',()=>{
 const {MODELS}=require('../src/config');
 const names=[...new Set(Object.values(MODELS).map(x=>x.provider))];
 for(const name of names){const brand=getProviderBrand(name);assert.ok(brand.label);assert.match(brand.mark,/^[A-Z0-9]{1,3}$/);assert.match(brand.color,/^#[0-9a-f]{6}$/i)}
 assert.ok(listProviderBrands().length>=25);
});
test('provider logo URLs are safe and separate from text-mode marks',()=>{
 const b=getProviderBrand('openai');assert.match(b.logo,/^https:\/\//);
 assert.equal(getProviderBrand('unknown/custom').logo,null);
});
