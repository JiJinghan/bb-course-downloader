import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,readdir,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,execFileSync} from 'node:child_process';
import {DOMParser} from 'linkedom';import {parsePage} from '../extension/parser.mjs';
globalThis.DOMParser=DOMParser;
const origin='https://bb.cuhk.edu.cn',cid='_17806_1';
const page=id=>`${origin}/webapps/blackboard/content/listContent.jsp?course_id=${cid}&content_id=${id}`;
const attachment=(id)=>`${origin}/bbcswebdav/pid-1-dt-content-rid-${id}_1/xid-${id}_1`;
const fileRow=(id,label)=>`<li id="row-${id}"><h3><a href="${attachment(id)}">${label}</a></h3>${id===12757113?'<a href="https://example.edu/worksheet-help">Worksheet help</a>':''}</li>`;
const folderRow=(id,name)=>`<li><h3><a href="${page(id)}">${name}</a></h3></li>`;
const documentOf=body=>`<html><head><title>ENG2001</title></head><body><ul id="content_listContainer">${body}</ul></body></html>`;
test('full scan → manual duplicate confirmation → background downloads → renamed-file history → new attachment',async t=>{
  const base=resolve(execFileSync('python3',['-c','import tempfile;from pathlib import Path;print(Path(tempfile.mkdtemp(prefix="bb-test-")).resolve())'],{encoding:'utf8'}).trim());
  const course=join(base,'ENG2001'),stateDir=join(base,'native-state');await mkdir(join(course,'W7','S2'),{recursive:true});
  const existing=Buffer.from('PK\x03\x04existing-ppt');await writeFile(join(course,'W7','S2','Week7S2(1).pptx'),existing);
  await mkdir(join(course,'我的整理'),{recursive:true});await writeFile(join(course,'我的整理','Week7S2(1).pptx'),Buffer.from('PKolder annotated file'));
  const init=`import sys,json;sys.path.insert(0,${JSON.stringify(resolve('native'))});from host import Host;print(json.dumps(Host(${JSON.stringify(stateDir)}).register_root(${JSON.stringify(course)})))`;
  const root=JSON.parse(execFileSync('python3',['-c',init],{encoding:'utf8'}));
  let buffer=Buffer.alloc(0),nativeListener,disconnectListener;
  const nativeCode=`import sys;sys.path.insert(0,${JSON.stringify(resolve('native'))});import host;Original=host.Host;host.Host=lambda:Original(${JSON.stringify(stateDir)});host.main()`;
  const child=spawn('python3',['-u','-c',nativeCode],{stdio:['pipe','pipe','pipe']});
  child.stdout.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)){const n=buffer.readUInt32LE(0);const m=JSON.parse(buffer.subarray(4,4+n));buffer=buffer.subarray(4+n);nativeListener(m);}});
  t.after(async()=>{child.kill();await rm(base,{recursive:true,force:true});});
  const ids=[12757066,12757113,12757046,12757047,12757048,12757049,12757050,12757051,12757044,12757053,12757038,12781425,12781421,12757040,12757039,12757041];
  const names=['W7S1.pptx','W7S1 worksheet.docx','gestures.mp4','blunders.mp4','Eye contact.mp4','Intonation.mp4','pause.mp4','Stress.mp4','Steve Vs Stan (Trim).mp4','201 Gestures.pdf','Accent.mp4','Week7S2(1).pptx','W7S2 Worksheet.docx','Transcript.docx','3MT winner.mp4','Fallacies.pdf'];
  const bytes=name=>name.endsWith('.mp4')?Buffer.from('\x00\x00\x00\x18ftypmp42video-data'):name.endsWith('.pdf')?Buffer.from('%PDF-1.7\nfixture'):Buffer.from('PK\x03\x04document-data');
  const resources=new Map(ids.map((id,i)=>[attachment(id),{name:names[i],data:id===12781425?existing:bytes(names[i])}]));let failOnce=false;
  const pages=new Map([[page('_root'),documentOf(folderRow('_w6','W6')+folderRow('_w7','W7'))],[page('_w7'),documentOf(folderRow('_s1','S1')+folderRow('_s2','S2'))],[page('_s1'),documentOf(ids.slice(0,11).map((id,i)=>fileRow(id,names[i])).join(''))],[page('_s2'),documentOf(ids.slice(11).map((id,i)=>fileRow(id,names[i+11])).join(''))]]);
  const fetched=[];globalThis.fetch=async(url,options={})=>{fetched.push([url,options.method||'GET']);if(resources.has(url)){const r=resources.get(url);const response=new Response(options.method==='HEAD'?null:r.data,{status:200,headers:{'content-type':r.name.endsWith('.mp4')?'video/mp4':'application/octet-stream','content-length':String(r.data.length),'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.name)}`}});Object.defineProperty(response,'url',{value:url});return response;}if(!pages.has(url))throw new Error(`Unexpected URL ${url}`);const response=new Response(pages.get(url));Object.defineProperty(response,'url',{value:url});return response;};
  const listeners=[];let onDownload;let stored={state:{phase:'idle',mapping:{[cid]:root},items:[],courses:[],warnings:[],log:[]}},downloadId=0,inflight=0,maxInflight=0,tabCreates=0;
  const downloads=new Map();
  globalThis.chrome={
    storage:{local:{get:async()=>structuredClone(stored),set:async value=>{stored=structuredClone(value);}}},
    runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onMessage:{addListener:fn=>listeners.push(fn)},onStartup:{addListener:()=>{}},sendMessage:async m=>m.target==='parser'?{ok:true,result:parsePage(m.html,m.url,m.courseId)}:undefined,
      connectNative:()=>({onMessage:{addListener:fn=>nativeListener=fn},onDisconnect:{addListener:fn=>disconnectListener=fn},postMessage:m=>{const data=Buffer.from(JSON.stringify(m)),header=Buffer.alloc(4);header.writeUInt32LE(data.length);child.stdin.write(Buffer.concat([header,data]));}})},
    offscreen:{hasDocument:async()=>true},
    tabs:{query:async()=>[{id:1}],create:async()=>{tabCreates++;},update:async()=>{}},
    scripting:{executeScript:async()=>[{result:{url:page('_s2'),title:'S2 – ENG2001',links:[{url:`${origin}/webapps/blackboard/execute/courseMain?course_id=${cid}`,title:'ENG2001: English for Academic Purposes II'},{url:page('_root'),title:'Content'}]}}]},
    action:{onClicked:{addListener:()=>{}}},alarms:{onAlarm:{addListener:()=>{}},create:()=>{}},
    downloads:{onChanged:{addListener:fn=>onDownload=fn},download:async options=>{if(failOnce){failOnce=false;throw new Error('NETWORK_FAILED');}const id=++downloadId,r=resources.get(options.url),filename=join(base,'downloads',options.filename);await mkdir(resolve(filename,'..'),{recursive:true});await writeFile(filename,r.data);downloads.set(id,{id,filename,state:'in_progress',danger:'safe'});inflight++;maxInflight=Math.max(maxInflight,inflight);setTimeout(()=>{inflight--;downloads.get(id).state='complete';onDownload({id,state:{current:'complete'}});},50);return id;},search:async query=>query.id!=null?[downloads.get(query.id)].filter(Boolean):[...downloads.values()],pause:async()=>{},resume:async()=>{}}
  };
  await import('../extension/worker.mjs');
  const rpc=(action,data={})=>new Promise((resolve,reject)=>{const accepted=listeners[0]({target:'worker',action,...data},{id:'test'},response=>response.ok?resolve(response.result):reject(new Error(response.error)));assert.equal(accepted,true);});
  const until=async(predicate)=>{const deadline=Date.now()+15000;while(Date.now()<deadline){const s=await rpc('state');if(predicate(s))return s;await new Promise(r=>setTimeout(r,10));}throw new Error('workflow timed out: '+JSON.stringify(stored.state));};
  await rpc('discover',{command:'下载 ENG2001 的 W7，包含视频'});await rpc('scan');
  let preview=await until(s=>s.phase==='preview');assert.equal(preview.items.length,16);assert.equal(preview.items.filter(i=>i.local.status==='review').length,1);assert(!fetched.some(([url])=>url===page('_w6')));
  await assert.rejects(()=>rpc('start',{choices:preview.items.map(i=>({id:i.id,choice:i.choice}))}),/核实/);
  await assert.rejects(()=>rpc('start',{choices:preview.items.map(i=>({id:i.id,choice:i.local.status==='review'?'remember':'download'}))}),/多个本地同名/);
  await rpc('start',{choices:preview.items.map(i=>({id:i.id,choice:i.local.status==='review'?'remember':'download',candidatePath:i.local.status==='review'?'W7/S2/Week7S2(1).pptx':null}))});
  const completed=await until(s=>s.phase==='complete');assert.equal(completed.items.filter(i=>i.status==='done').length,15,JSON.stringify(completed.items.filter(i=>i.status==='failed')));assert.equal(maxInflight,3);assert.equal(tabCreates,0);
  const history=JSON.parse(await readFile(join(course,'.bb-downloads','history.json'),'utf8'));assert.equal(Object.keys(history.items).length,16);assert.equal(await readFile(join(course,'W7','S2','Week7S2(1).pptx'),'utf8'),existing.toString());
  assert((await readFile(join(course,'课程目录.md'),'utf8')).includes('W7S1'));
  assert((await readFile(join(course,'Content','W7','S1','W7S1 worksheet.docx','链接.md'),'utf8')).includes('https://example.edu/worksheet-help'));
  assert(!fetched.some(([url])=>url.includes('example.edu')));
  await rename(join(course,'Content','W7','S1','W7S1 worksheet.docx','W7S1 worksheet.docx'),join(course,'我的批注.docx'));
  const newId=99999;resources.set(attachment(newId),{name:'新增材料.pdf',data:bytes('新增材料.pdf')});pages.set(page('_s2'),documentOf(ids.slice(11).map((id,i)=>fileRow(id,names[i+11])).join('')+fileRow(newId,'新增材料')));
  await rpc('scan');preview=await until(s=>s.phase==='preview');assert.equal(preview.items.length,17);assert.equal(preview.items.filter(i=>i.local.status==='history').length,16);assert.equal(preview.items.filter(i=>i.choice==='download').length,1);
  failOnce=true;await rpc('start',{choices:preview.items.map(i=>({id:i.id,choice:i.choice}))});
  const failure=await until(s=>s.phase==='complete');assert.equal(failure.items.filter(i=>i.status==='failed').length,1);assert.equal(Object.keys(JSON.parse(await readFile(join(course,'.bb-downloads','history.json'),'utf8')).items).length,16);
  await rpc('retry');const retried=await until(s=>s.phase==='complete'&&s.items.some(i=>i.id.includes('99999')&&i.status==='done'));assert.equal(retried.items.filter(i=>i.status==='failed').length,0);assert.equal(Object.keys(JSON.parse(await readFile(join(course,'.bb-downloads','history.json'),'utf8')).items).length,17);
});
