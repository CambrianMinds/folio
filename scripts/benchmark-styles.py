from pathlib import Path
import subprocess,json,time
root=Path(__file__).resolve().parents[1]
model=root/'verification/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
cli=root/'src-tauri/target/debug/folio-render.exe'
cases=[
 ('A spacious draft that I can send to a copy editor.','Manuscript'),
 ('Prepare a traditional submission draft for editorial review.','Manuscript'),
 ('I want room for a reviewer to mark up my draft.','Manuscript'),
 ('A conventional draft for an editor before publication.','Manuscript'),
 ('An elegant personal reflection for comfortable sustained reading.','Essay'),
 ('A readable literary nonfiction piece with generous breathing room.','Essay'),
 ('Give this personal narrative a considered bookish presentation.','Essay'),
 ('A graceful composition for an autobiographical reflection.','Essay'),
 ('Style this as an article in a scientific periodical.','Journal'),
 ('A compact academic research paper for publication.','Journal'),
 ('Compose this like a scholarly periodical article.','Journal'),
 ('A restrained scientific publication layout.','Journal'),
 ('A dense practical lookup handbook for a technician.','Reference'),
 ('A compact cheatsheet for quick consultation at a workbench.','Reference'),
 ('A practical technical desk guide with efficient use of space.','Reference'),
 ('A dense collection of reference notes for looking things up.','Reference'),
 ('Make it nice.',None),
 ('Improve this.',None),
 ('Something better please.',None),
 ('What is the weather tomorrow?',None),
]
results=[]
for request,expected in cases:
 start=time.perf_counter();r=subprocess.run([str(cli),'--interpret',str(model),request],capture_output=True,text=True,encoding='utf-8',timeout=100)
 try:answer=json.loads(r.stdout);passed=r.returncode==0 and answer.get('style')==expected and (bool(answer.get('clarification')) if expected is None else not answer.get('clarification'))
 except Exception:answer=None;passed=False
 item={'request':request,'expected':expected,'answer':answer,'passed':passed,'seconds':round(time.perf_counter()-start,2)};results.append(item);print(item,flush=True)
report={'model':model.stem,'runtime':'llama.cpp b12445','threads':4,'cpuOnly':True,'task':'style classification; models cannot calculate measurements','passed':sum(r['passed'] for r in results),'total':len(results),'cases':results}
(root/'verification/style-benchmark.json').write_text(json.dumps(report,indent=2))
