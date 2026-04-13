const fs = require('fs');
const path = require('path');

const dir = path.resolve(__dirname, '..', 'recovery_cache');
const out = path.resolve(__dirname, '..', 'recovered_submissions_from_backup_20260410.json');

function tryRead(file) {
  const encs = ['utf8', 'utf16le'];
  for (const e of encs) {
    try {
      let raw = fs.readFileSync(file, e);
      if (raw.startsWith('\uFEFF')) raw = raw.replace(/^\uFEFF/, '');
      return raw;
    } catch (err) {}
  }
  return null;
}

function extractArrayFromTextAtKey(text, key) {
  const idx = text.indexOf('"' + key + '"');
  if (idx === -1) return [];
  const start = text.indexOf('[', idx);
  if (start === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return [];
  const snippet = text.slice(start, end + 1);
  try {
    return JSON.parse(snippet);
  } catch (e) {
    // If parse fails, try unescaping backslashes then parse
    try {
      const unescaped = snippet.replace(/\\"/g, '\"');
      return JSON.parse(unescaped);
    } catch (e2) {
      return [];
    }
  }
}

(async () => {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const all = [];
  for (const f of files) {
    const file = path.join(dir, f);
    const raw = tryRead(file);
    if (!raw) continue;

    // Try parse JSON fully and walk for 'submissions'
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) { parsed = null; }

    const addIfArray = (val) => {
      if (!val) return;
      if (Array.isArray(val)) all.push(...val);
      else if (typeof val === 'string') {
        try { const arr = JSON.parse(val); if (Array.isArray(arr)) all.push(...arr); } catch(e) {}
      }
    };

    if (parsed) {
      // recursive search
      const stack = [parsed];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== 'object') continue;
        if (Object.prototype.hasOwnProperty.call(node, 'submissions')) {
          addIfArray(node.submissions);
        }
        for (const k of Object.keys(node)) {
          const v = node[k];
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    }

    // Fallback: try to extract using text scanning
    try {
      const arr = extractArrayFromTextAtKey(raw, 'submissions');
      if (Array.isArray(arr) && arr.length) all.push(...arr);
    } catch (e) {}
  }

  // Dedupe by id
  const map = new Map();
  for (const s of all) {
    if (!s || !s.id) continue;
    if (!map.has(String(s.id))) map.set(String(s.id), s);
  }

  const recovered = Array.from(map.values());
  fs.writeFileSync(out, JSON.stringify({ recoveredCount: recovered.length, recovered }, null, 2), 'utf8');
  console.log('Wrote', recovered.length, 'submissions to', out);
})();
