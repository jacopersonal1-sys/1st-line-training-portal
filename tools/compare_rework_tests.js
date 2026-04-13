const fs = require('fs');
const path = require('path');

function loadJSON(fp){
  let s = fs.readFileSync(fp,'utf8');
  if(s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  try{
    return JSON.parse(s);
  }catch(e){
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if(first !== -1 && last !== -1){
      const sub = s.substring(first,last+1);
      return JSON.parse(sub);
    }
    throw e;
  }
}

function norm(v){
  if(v === undefined || v === null) return '';
  if(typeof v !== 'string') return JSON.stringify(v);
  return v.replace(/\s+/g,' ').trim();
}

const recoveredPath = path.resolve('c:/BuildZone/recovered_tests_from_backup_20260410.json');
const backupPath = path.resolve('c:/BuildZone/recovery_cache/tests_restore_rework_from_cache_20260410.json');

if(!fs.existsSync(recoveredPath)){
  console.error('Recovered file not found:', recoveredPath);
  process.exit(2);
}
if(!fs.existsSync(backupPath)){
  console.error('Backup tests file not found:', backupPath);
  process.exit(2);
}

const rec = loadJSON(recoveredPath);
const bak = loadJSON(backupPath);

const recovered = rec.recovered || rec.tests || rec;
const tests = bak.tests || bak;

const report = [];

for(const r of recovered){
  const stripped = r.title.replace(/\s*\(Rework\)\s*$/i,'').trim();
  const match = (tests || []).find(t => (t.title || '') === stripped);
  const entry = {recoveredTitle: r.title, recoveredId: r.id, counterpartTitle: match ? match.title : null, counterpartId: match ? match.id : null, identical: false, diffs: []};
  if(!match){
    entry.diffs.push(`No counterpart found with title "${stripped}"`);
    report.push(entry);
    continue;
  }

  const rQs = r.questions || [];
  const mQs = match.questions || [];
  if(rQs.length !== mQs.length) entry.diffs.push(`question count differs: recovered ${rQs.length} vs counterpart ${mQs.length}`);

  const mMap = new Map((mQs || []).map(q=>[q.id,q]));
  for(const rq of rQs){
    const mq = mMap.get(rq.id);
    if(!mq){
      entry.diffs.push(`question id ${rq.id} present in recovered but missing in counterpart`);
      continue;
    }
    const fields = ['text','type','points','imageLink','adminNotes','modelAnswer','linkedToPrevious'];
    for(const f of fields){
      const a = norm(rq[f]);
      const b = norm(mq[f]);
      if(a !== b) entry.diffs.push(`question ${rq.id} field ${f} differs`);
    }
    if(JSON.stringify(rq.options || []) !== JSON.stringify(mq.options || [])) entry.diffs.push(`question ${rq.id} options differ`);
    if(JSON.stringify(rq.correct || null) !== JSON.stringify(mq.correct || null)) entry.diffs.push(`question ${rq.id} correct field differs`);
  }

  const rMap = new Map((rQs || []).map(q=>[q.id,q]));
  for(const mq of mQs){
    if(!rMap.has(mq.id)) entry.diffs.push(`question id ${mq.id} present in counterpart but missing in recovered`);
  }

  entry.identical = entry.diffs.length === 0;
  report.push(entry);
}

const outPath = path.resolve('c:/BuildZone/rework_comparison_report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log('Wrote report to', outPath);
for(const e of report){
  console.log('-', e.recoveredTitle, '->', e.identical ? 'IDENTICAL' : `DIFFS(${e.diffs.length})`);
  if(e.diffs.length) console.log('   ', e.diffs.slice(0,10));
}
