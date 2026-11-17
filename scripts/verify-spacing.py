"""Measure real ink clearance at paragraph, list, and heading boundaries."""
from pathlib import Path
import json,subprocess
import fitz
root=Path(__file__).resolve().parents[1];out=root/'verification'
presets=json.loads((out/'preset-definitions.json').read_text(encoding='utf-8'))
boundaries=[('shared.','Folio brings'),('export your PDF.','The source remains'),('been read.','The same principle'),('A small working method','Open a Markdown document.'),('Space between things','White space gives')]
report=[]
for name,config in presets.items():
 cfg=out/(name.lower()+'-spacing.json');cfg.write_text(json.dumps(config))
 pdf=out/(name.lower()+'-spacing.pdf')
 r=subprocess.run([str(root/'src-tauri/target/debug/folio-render.exe'),str(root/'samples/Welcome.md'),str(pdf),str(cfg)],capture_output=True,text=True)
 assert r.returncode==0,(name,r.stderr)
 doc=fitz.open(pdf);checked=[]
 for end,start in boundaries:
  rows=[(i,fitz.Rect(line['bbox']),''.join(span['text'] for span in line['spans']))for i,p in enumerate(doc)for block in p.get_text('dict')['blocks']for line in block.get('lines',[])]
  ends=[(i,rect)for i,rect,text in rows if end in text];starts=[(i,rect)for i,rect,text in rows if start in text]
  assert ends and starts,(name,end,start)
  ep,eb=ends[-1];sp,sb=starts[0]
  if ep==sp and min(eb.x1,sb.x1)-max(eb.x0,sb.x0)>2:
   clearance=sb.y0-eb.y1
   assert clearance>=.25,(name,end,start,'overlapping ink',clearance)
   checked.append({'after':end,'before':start,'clearancePt':round(clearance,3)})
 doc[0].get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(out/(name.lower()+'-spacing.png'))
 report.append({'preset':name,'pages':len(doc),'boundaries':checked})
(out/'spacing-report.json').write_text(json.dumps(report,indent=2))
print('Paragraph, heading, and list-boundary ink clearance passed for all four presets.')
