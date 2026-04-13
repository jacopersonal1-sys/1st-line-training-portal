const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'recovery_cache', 'tests_restore_rework_from_cache_20260410.json');
const out = path.resolve(__dirname, '..', 'recovered_tests_from_backup_20260410.json');

const targetTitles = [
  'Course 5 - Fibre No Internet (Rework)',
  '1st Vetting - Course 1 - 3 1st Vetting Test (Rework)',
  'Course 2 - Programs & Websites - CHIP (Rework)'
];

try {
  let raw = fs.readFileSync(src, 'utf8');
  let data = null;
  try {
    raw = raw.replace(/^\uFEFF/, '');
    data = JSON.parse(raw);
  } catch (errUtf8) {
    // Fallback for UTF-16 / BOM encoded files
    try {
      raw = fs.readFileSync(src, 'utf16le');
      raw = raw.replace(/^\uFEFF/, '');
      data = JSON.parse(raw);
    } catch (errUtf16) {
      // rethrow original
      throw errUtf8;
    }
  }
  const tests = data.tests || [];
  const found = tests.filter(t => targetTitles.includes(t.title));
  fs.writeFileSync(out, JSON.stringify({ meta: data.meta || {}, recovered: found }, null, 2), 'utf8');
  console.log('Wrote', found.length, 'tests to', out);
} catch (err) {
  console.error('Error:', err && err.stack ? err.stack : err);
  process.exit(1);
}
