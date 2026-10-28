"""Local visual QA only: serves the production UI with a clearly labelled mock state."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json

root=Path(__file__).resolve().parents[1]/'extension'
names=['W7S1.pptx','W7S1 worksheet.docx','the_4_public_speaking_gestures_and_how_to_use_them.mp4','Eye contact.mp4','Steve Vs Stan (Trim).mp4','Week7S2(1).pptx']
state={'phase':'preview','command':'下载 ENG2001 的 W7，包含视频','course':{'id':'demo','title':'ENG2001: English for Academic Purposes II'},'courses':[{'id':'demo','title':'ENG2001: English for Academic Purposes II'}],'rootId':'demo','rootPath':'/Users/student/Desktop/ENG2001','warnings':[],'log':[{'time':'14:30:00','text':'界面预览：使用模拟数据，不会下载学校资料'}], 'items':[]}
for i,name in enumerate(names):
    local={'status':'review' if i==5 else 'history' if i==1 else 'new','exists':True,'savedPath':'W7/S1/W7S1 worksheet.docx','candidates':[{'path':'W7/S2/Week7S2(1).pptx','size':25285391}]}
    state['items'].append({'id':str(i),'name':name,'folders':['Content','W7','S2' if i==5 else 'S1',name],'size':25285391 if i==5 else 2083901,'local':local,'choice':'review' if i==5 else 'skip' if i==1 else 'download','status':'ready'})
state['structure']={'version':2,'areas':['Content','Midterm'],'ignored':['Announcements','Discussions','Groups','Tools','Help'],'nodes':[
    {'id':x['id'],'path':x['folders'],'title':x['name'],'kind':'item','fileIds':[x['id']],
     'links':[{'title':'老师分享的参考网站','url':'https://example.edu/proof'}] if i==0 else []}
    for i,x in enumerate(state['items'])]}
state['structure']['nodes'].append({'id':'text','path':['Midterm','考试说明'],'title':'考试说明','kind':'item','fileIds':[],'links':[]})
state['items'][0]['locations']=[{'folders':['Content','W7','S1','W7S1.pptx']},{'folders':['Midterm','Review']}]
state['items'][5]['local']['candidates'].append({'path':'我的整理/Week7S2(1).pptx','size':25285000})
mock='globalThis.chrome={runtime:{sendMessage:async m=>({ok:true,result:m.action==="state"?'+json.dumps(state,ensure_ascii=False)+':{version:"1.1.0"}}),onMessage:{addListener:()=>{}}}};'
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(root),**kwargs)
    def do_GET(self):
        if self.path in ('/','/app.html'):
            html=(root/'app.html').read_text().replace('<script type="module" src="app.mjs">','<script src="/mock.js"></script><script type="module" src="app.mjs">')
            body=html.encode();mime='text/html; charset=utf-8'
        elif self.path=='/mock.js':body=mock.encode();mime='application/javascript; charset=utf-8'
        else:return super().do_GET()
        self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
ThreadingHTTPServer(('127.0.0.1',8765),Handler).serve_forever()
