import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadLatestBrowserCollection} from '../src/lib/collection-store.js';

test('browser cache sorts by full timestamp, not old MMDD filename',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'collections-'));
 await writeFile(path.join(dir,'browser_collection_1231.json'),JSON.stringify({generatedAt:'2025-12-31T00:00:00Z',results:[{name:'Old'}]}));
 await writeFile(path.join(dir,'browser_collection_0101.json'),JSON.stringify({generatedAt:'2026-01-01T00:00:00Z',results:[{name:'New'}]}));
 const result=await loadLatestBrowserCollection({directory:dir}); assert.ok(result.byName.has('New'));
});
test('corrupt browser cache is a visible warning, not silent empty success',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'collections-'));
 await writeFile(path.join(dir,'browser_collection_bad.json'),'{bad');
 const result=await loadLatestBrowserCollection({directory:dir}); assert.equal(result.byName.size,0); assert.ok(result.warnings.some(w=>w.includes('bad')));
});
