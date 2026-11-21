import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { systemSettingsSql } from '../src/utils/systemSettingsSql';
const settings = [
  {id: 'landing_page', ar: {brandName: "عيادة O'Brien", heroSubtitle: 'سطر أول\nسطر ثانٍ'}, plans: [{id: 'p1', price: '199', ar: {features: ['حجز', 'تقارير']}}], empty: null},
  {id: 'support', phoneNumbers: [{phone: '01000000000'}], links: ['https://example.invalid/?q=a&b=1']},
  {id: "custom'key", enabled: false, count: 0, nested: {path: 'a\\b', emoji: '🦷'}},
  {id: 'auth_secret', secret: 'DO_NOT_EXPORT_SENTINEL'},
];
const sql = systemSettingsSql(settings);
assert(!sql.includes('auth_secret'));
assert(!sql.includes('DO_NOT_EXPORT_SENTINEL'));
const parsed = spawnSync('python3', ['-c', 'import sys,sqlite3,json; c=sqlite3.connect(":memory:"); c.executescript(sys.stdin.read()); print(json.dumps([json.loads(row[0]) for row in c.execute("SELECT data FROM system_settings ORDER BY id")]))'], {input: sql, encoding: 'utf8'});
assert.equal(parsed.status, 0, parsed.stderr);
assert.deepEqual(JSON.parse(parsed.stdout), settings.filter(s => s.id !== 'auth_secret').sort((a,b) => a.id.localeCompare(b.id)));
const empty = spawnSync('python3', ['-c', 'import sys,sqlite3; c=sqlite3.connect(":memory:"); c.executescript(sys.stdin.read()); assert c.execute("SELECT count(*) FROM system_settings").fetchone()[0]==0'], {input: systemSettingsSql([]), encoding: 'utf8'});
assert.equal(empty.status, 0, empty.stderr);
console.log('PASS SQL settings round-trip: Arabic, apostrophes, nested arrays/objects, newlines, backslashes, null/false/zero, custom IDs, empty settings, auth_secret excluded');
