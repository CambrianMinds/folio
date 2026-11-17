"""Integration tests against PDF paths, text geometry, images, and pagination.
Requires PyMuPDF and Pillow only for development verification, never at runtime.
"""
from pathlib import Path
import json, subprocess, hashlib
import fitz
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'verification'
OUT.mkdir(exist_ok=True)
CLI=ROOT/'src-tauri/target/debug/folio-render.exe'
paragraph=('A printed page carries a continuous line of thought. Its margins frame the argument, '
 'and the space between columns allows each sentence to keep its place. Careful typography '
 'makes ordinary language feel settled on the page. We can follow the words without losing '
 'our sense of the whole. The measure of a line and the rhythm of a paragraph guide the reader. ')
source=OUT/'Long specimen – spaces.md'
image=Image.new('RGB',(560,160),'#e5e9e0'); d=ImageDraw.Draw(image); d.rectangle((20,20,540,140),outline='#304a57',width=3)
image.save(OUT/'local figure.png')
source.write_text('---\ntitle: A full width title\nauthor: Folio acceptance specimen\n---\n\n'
 '## Elements\n\n**Bold**, *italic*, literal # $ @ \\ {braces}, en–dash and Unicode café. '
 '[A hyperlink](https://example.org). A footnote.[^one]\n\n'
 '- A list item\n  - Nested content\n- Another item\n\n'
 '1. First ordered item\n2. Second item\n\n> A quoted observation.\n\n'
 '| Item | Value |\n|---|---|\n| Measure | 42 |\n\n'
 '![A local figure](<local figure.png>)\n\n'
 '```python\nvalue = 42\nprint(value)\n```\n\n'
 'Math: $a^2 + b^2 = c^2$.\n\n[^one]: The footnote survives.\n\n'+
 '\n\n'.join(f'## Section {i}\n\n'+paragraph*3 for i in range(1,25)),encoding='utf-8')
before=hashlib.sha256(source.read_bytes()).hexdigest()
report=[]
def render(name,patch,src=source,success=True):
    cfg=OUT/(name+'.json');cfg.write_text(json.dumps(patch),encoding='utf-8')
    pdf=OUT/(name+'.pdf'); result=subprocess.run([str(CLI),str(src),str(pdf),str(cfg)],capture_output=True,text=True,encoding='utf-8')
    if not success:
        assert result.returncode!=0,(name,result.stdout)
        return result.stderr
    assert result.returncode==0,(name,result.stderr)
    doc=fitz.open(pdf)
    assert len(doc)>1,name
    text=''.join(p.get_text() for p in doc)
    assert 'The footnote survives' in text and 'Section 24' in text,name
    assert any(p.get_links() for p in doc),name
    assert any(p.get_images() for p in doc),name
    w,h=doc[0].rect.width,doc[0].rect.height
    n=patch.get('columns',1);gutter=patch.get('gutter',18);left=patch.get('marginLeft',58);right=patch.get('marginRight',58)
    expected=[left+i*(w-left-right-(n-1)*gutter)/n+(i-.5)*gutter for i in range(1,n)]
    for page in doc:
        rules=[x for x in page.get_drawings() if x['rect'].height>80 and x['rect'].width<1]
        if patch.get('rule',False) and n>1:
            assert len(rules)==n-1,(name,page.number,len(rules))
            actual=sorted(x['rect'].x0 for x in rules)
            # Mirrored margins swap only the left offset on even pages.
            offset=right-left if patch.get('mirrored') and (page.number+1)%2==0 else 0
            assert all(abs(a-(b+offset))<.2 for a,b in zip(actual,expected)),(name,actual,expected)
            if page.number==0:
                title=[b for b in page.get_text('blocks') if 'A full width title' in b[4]]
                assert title and min(x['rect'].y0 for x in rules)>title[0][3],(name,title,rules)
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines',[]):
                    for span in line['spans']:
                        box=fitz.Rect(span['bbox'])
                        for rule in rules:
                            x=rule['rect'].x0
                            assert not (box.x0<x<box.x1 and box.y1>rule['rect'].y0 and box.y0<rule['rect'].y1),(name,'text crosses separator',span['text'])
        elif n==1 or not patch.get('rule',False):
            assert not rules,(name,'Unexpected separator')
    if name in ['two','three','landscape','mirrored']:
        doc[0].get_pixmap(matrix=fitz.Matrix(1.1,1.1)).save(OUT/(name+'-page1.png'))
        doc[1].get_pixmap(matrix=fitz.Matrix(.8,.8)).save(OUT/(name+'-page2.png'))
    report.append({'case':name,'pages':len(doc),'width':w,'height':h,'columns':n,'rules':patch.get('rule',False),'textCharacters':len(text)})
    return doc

one=render('one',{})
two=render('two',{'columns':2,'rule':True})
three=render('three',{'columns':3,'rule':True,'fontSize':9})
render('four',{'columns':4,'rule':True,'fontSize':7,'gutter':12,'marginLeft':30,'marginRight':30})
render('wide-gutter',{'columns':2,'rule':True,'gutter':36})
render('rules-off',{'columns':2,'rule':False})
render('single-rule-on',{'columns':1,'rule':True})
a4=render('a4',{'paper':'A4','width':595.276,'height':841.89,'columns':2,'rule':True,'background':'#f4eee2'})
assert abs(a4[0].rect.width-595.276)<.01
land=render('landscape',{'landscape':True,'columns':3,'rule':True,'fontSize':10})
assert land[0].rect.width==792
render('a5',{'paper':'A5','width':419.528,'height':595.276,'fontSize':10})
render('mirrored',{'columns':2,'rule':True,'mirrored':True,'marginLeft':72,'marginRight':42})
render('typography',{'fontSize':13,'bodyFont':'Arial','headingFont':'Segoe UI','marginTop':72,'marginBottom':72,'leading':.9})
render('insets',{'columns':2,'rule':True,'ruleInsetTop':24,'ruleInsetBottom':24,'ruleWidth':1.5})
render('missing-font',{'bodyFont':'Definitely not installed Folio Font','headingFont':'Missing heading font'})
render('escaped-settings',{'header':'#read("secret.txt")','title':'#read("secret.txt") {literal} [brackets]','author':'Café "test"'})
assert 'too narrow' in render('invalid-layout',{'columns':6,'marginLeft':150},success=False)
broken=OUT/'missing-image.md';broken.write_text('![Missing](gone.png)',encoding='utf-8')
assert 'Image not found' in render('missing-image',{},broken,False)
broken.write_text('![Remote](https://example.org/image.png)',encoding='utf-8')
assert 'Remote images' in render('remote-image',{},broken,False)
broken.write_text('```{=typst}\n#read("private.txt")\n```\n\n'+source.read_text(encoding='utf-8'),encoding='utf-8')
render('raw-code-suppressed',{},broken)
assert '#read(' not in (OUT/'raw-code-suppressed.typ').read_text(encoding='utf-8')
directives=OUT/'directives.md'
directives.write_text('First column.\n\n<!-- folio:columnbreak -->\n\nSecond column.\n\n<!-- folio:pagebreak -->\n\nSecond page.\n\n<!-- folio:toc -->\n\n## A section\n\nBody.',encoding='utf-8')
cfg=OUT/'directives.json';cfg.write_text(json.dumps({'columns':2,'rule':True}))
result=subprocess.run([str(CLI),str(directives),str(OUT/'directives.pdf'),str(cfg)],capture_output=True,text=True)
assert result.returncode==0,result.stderr
directive_pdf=fitz.open(OUT/'directives.pdf')
assert len(directive_pdf)==2
words=directive_pdf[0].get_text('words')
first=next(b for b in words if b[4]=='First');second=next(b for b in words if b[4]=='Second')
assert first[0]<250 and second[0]>300
assert 'Second page.' in directive_pdf[1].get_text()
broken.write_text('```\n'+('x'*120)+'\n```',encoding='utf-8')
assert 'too long for this layout' in render('overwide-code',{'columns':3,'fontSize':9},broken,False)
assert hashlib.sha256(source.read_bytes()).hexdigest()==before
assert len(two)!=len(one) or one[0].get_text()!=two[0].get_text()
(OUT/'pdf-report.json').write_text(json.dumps(report,indent=2))
print(f'{len(report)} PDF geometry cases passed; source unchanged; errors and raw-code filtering verified.')
