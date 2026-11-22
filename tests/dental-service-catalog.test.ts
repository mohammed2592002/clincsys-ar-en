import assert from 'node:assert/strict';
import { seedOrthodonticCatalog, orthodonticServices, orthodonticCategory } from '../src/utils/dentalServiceCatalog';

for (const isEn of [false, true]) {
  const fresh = seedOrthodonticCatalog({}, isEn);
  const presets = orthodonticServices(isEn);
  for (const preset of presets) {
    assert.equal(fresh.customDentalServices.filter(s => s.name === preset.name).length, 1);
    const actual = fresh.customDentalServices.find(s => s.name === preset.name)!;
    assert.deepEqual({ ...actual, id: preset.id }, preset);
  }
  assert.ok(fresh.dentalServiceCategories.includes(orthodonticCategory(isEn)));
  assert.equal(fresh.customDentalServices.filter(s => s.category === orthodonticCategory(isEn)).length, 6);
  const legacyFull = { id: 'old-full', name: isEn ? 'Full Braces (Both Arches)' : 'تركيب تقويم أسنان (كامل/فكين)', price: 8765, condition: 'ortho' as const, category: orthodonticCategory(isEn) };
  const legacyCatalog = seedOrthodonticCatalog({ customDentalServices: [legacyFull], dentalServiceCategories: [orthodonticCategory(isEn)] }, isEn);
  assert.equal(legacyCatalog.customDentalServices.length, 6);
  assert.deepEqual(legacyCatalog.customDentalServices[0], legacyFull);
  assert(!legacyCatalog.customDentalServices.some(s => s.name === presets[1].name));
  const crossLanguage = seedOrthodonticCatalog({ customDentalServices: orthodonticServices(!isEn) }, isEn);
  assert.equal(crossLanguage.customDentalServices.length, 6, 'switching language does not double-seed recognized services');
  const renamed = { ...fresh, customDentalServices: fresh.customDentalServices.map(s => s.id === 'ortho-def-0' ? { ...s, name: 'Custom clinic name', price: 321 } : s).filter(s => s.id !== 'ortho-def-5') };
  assert.deepEqual(seedOrthodonticCatalog(renamed, !isEn), renamed, 'rename/delete survives reload and language change');
  assert.deepEqual(seedOrthodonticCatalog({ orthodonticCatalogVersion: 1, customDentalServices: [], dentalServiceCategories: [] }, isEn), { orthodonticCatalogVersion: 1, customDentalServices: [], dentalServiceCategories: [] }, 'empty saved catalogs remain empty');
  const override = { ...presets[0], id: 'clinic-owned-id', price: 246, condition: 'crown' as const, category: 'My category' };
  const old = { customDentalServices: [override], dentalServiceCategories: ['My category'] };
  const upgraded = seedOrthodonticCatalog(old, isEn);
  assert.equal(upgraded.customDentalServices.length, 6);
  assert.deepEqual(upgraded.customDentalServices[0], override, 'exact name preserves price, category, condition and ID');
  assert.equal(old.customDentalServices.length, 1, 'input is not mutated');
  const collision = seedOrthodonticCatalog({ customDentalServices: [{ ...override, id: 'ortho-def-1' }] }, isEn);
  assert.equal(new Set(collision.customDentalServices.map(s => s.id)).size, collision.customDentalServices.length, 'seed IDs do not collide');
}
const oldEnglish = seedOrthodonticCatalog({ customDentalServices: [{ id: 'x', name: 'Custom', price: 77, condition: 'ortho', category: 'Orthodontics & Cosmetic' }], dentalServiceCategories: ['Orthodontics & Cosmetic', 'Orthodontics & Aesthetics'] }, true);
assert.equal(oldEnglish.customDentalServices[0].category, 'Orthodontics & Aesthetics');
assert.equal(oldEnglish.dentalServiceCategories.filter(c => c === 'Orthodontics & Aesthetics').length, 1);
console.log('Orthodontic catalog migration: Arabic/English defaults, overrides, permanent edits/deletions, empty lists, ID collisions and category normalization passed.');
