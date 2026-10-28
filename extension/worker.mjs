import {scanCourse} from './scanner.mjs';
import {ORIGIN,HOST,parseCommand,safeName,allowedURL,filenameFromHeaders,scopeMatch,isVideo,describeError,ignoredSection,contentAreaURL} from './core.mjs';
let state={phase:'idle',items:[],courses:[],warnings:[],mapping:{},log:[]};
const loaded=chrome.storage.local.get('state').then(data=>{
  if(data.state)state={...state,...data.state};
  for(const item of state.items)delete item.finishing;
  if(['scanning','discovering','confirming'].includes(state.phase)||state.phase==='preview'&&state.structure?.version!==2){
    state.phase='choose';state.error='上次预览已过期或扫描中断，请重新扫描。';
  }
});
let port,requestCounter=0,parserCreation,pumping=false,scanRunning=false;
const requests=new Map();
async function save() {await chrome.storage.local.set({state}); chrome.runtime.sendMessage({target:'ui',type:'changed'}).catch(()=>{});}
function note(text) {state.log.push({time:new Date().toLocaleTimeString('zh-CN'),text});state.log=state.log.slice(-80);}
function native(action,data={}) {
  if(!port) {
    port=chrome.runtime.connectNative(HOST);
    port.onMessage.addListener(m=>{const request=requests.get(m.requestId);if(!request)return;requests.delete(m.requestId);clearTimeout(request.timer);m.ok?request.resolve(m.result):request.reject(new Error(m.error));});
    port.onDisconnect.addListener(()=>{const error=chrome.runtime.lastError?.message||'本地助手连接已断开';port=null;for(const request of requests.values()){clearTimeout(request.timer);request.reject(new Error(error));}requests.clear();});
  }
  return new Promise((resolve,reject)=>{const requestId=++requestCounter;const timer=setTimeout(()=>{requests.delete(requestId);reject(new Error('本地助手响应超时，请重试'));},action==='choose_root'?330000:120000);requests.set(requestId,{resolve,reject,timer});port.postMessage({...data,action,requestId});});
}
async function parser(html,url,courseId='') {
  if(!await chrome.offscreen.hasDocument()) {
    parserCreation??=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['DOM_PARSER'],justification:'解析用户已登录 BB 课程目录的 HTML，提取目录和附件链接。'}).finally(()=>{parserCreation=null;});
    await parserCreation;
  }
  const reply=await chrome.runtime.sendMessage({target:'parser',html,url,courseId});
  if(!reply?.ok) throw new Error(reply?.error||'页面解析失败');
  return reply.result;
}
async function getPage(url,courseId) {
  if(!allowedURL(url)) throw new Error('只支持学校 BB 域名');
  const r=await fetch(url,{credentials:'include',signal:AbortSignal.timeout(25000)});
  if(!r.ok) throw new Error(`BB 返回 ${r.status}`);
  if(!allowedURL(r.url)||/\/login(?:\/|\?|$)/i.test(new URL(r.url).pathname)) throw new Error('登录已过期，请先在 Chrome 中登录学校 BB');
  const result=await parser(await r.text(),r.url,courseId);
  if(result.login) throw new Error('登录已过期，请先在 Chrome 中登录学校 BB');
  return {...result,url:r.url};
}
function scanCurrentPage() {
  const links=[...document.querySelectorAll('a[href]')].map(a=>({url:a.href,title:a.textContent.trim().replace(/\s+/g,' ')}));
  const menuLinks=new Set([...document.querySelectorAll('#courseMenuPalette_contents a[href], #courseMenu a[href], .courseMenu a[href]')].map(a=>a.href));
  for(const link of links)link.menu=menuLinks.has(link.url);
  return {url:location.href,title:document.title,links};
}
async function discover(command) {
  const scope=parseCommand(command);state.command=command;state.scope=scope;state.error='';state.course=null;state.rootId=null;state.rootPath='';state.items=[];state.courses=[];state.structure=null;state.records=null;state.recordsError='';state.discoveryWarning='';state.phase='discovering';await save();
  const found=new Map();const rootMap={};
  const add=(item)=>{if(!allowedURL(item.url))return;const u=new URL(item.url);const id=u.searchParams.get('course_id');if(!id||!item.title)return;if(/courseMain/.test(u.pathname)||item.current) {const previous=found.get(id);if(!previous||item.title.includes(scope.code))found.set(id,{id,title:item.title,url:`${ORIGIN}/webapps/blackboard/execute/courseMain?course_id=${encodeURIComponent(id)}`});}if(id&&!ignoredSection(item.title)&&(item.menu||/^(Content|Course Content|Course Materials|Learning Materials|课程内容|课程资料|教学资料)$/i.test(item.title))&&contentAreaURL(item.url))rootMap[id]??={url:item.url,title:item.title};};
  const tabs=await chrome.tabs.query({url:`${ORIGIN}/*`});
  for(const tab of tabs) {
    try {for(const frame of await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:scanCurrentPage})) {if(!frame.result)continue;add({...frame.result,current:true});for(const a of frame.result.links)add(a);}}catch{}
  }
  // My Courses may be rendered server-side; current-tab discovery remains the fallback.
  for(const group of ['_25_1','_2_1']) {
    if([...found.values()].some(c=>new RegExp(`\\b${scope.code}\\b`,'i').test(c.title)))break;
    try {const page=await getPage(`${ORIGIN}/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=${group}`);page.courses.forEach(add);}catch(error){state.discoveryWarning=describeError(error);}
  }
  state.courses=[...found.values()].filter(c=>new RegExp(`\\b${scope.code}\\b`,'i').test(c.title)).map(c=>({...c,rootURL:rootMap[c.id]?.url||null,rootTitle:rootMap[c.id]?.title||null}));
  state.phase='choose';
  if(!state.courses.length) throw new Error(`未找到 ${scope.code}。请在 BB 打开这门课的任一资料页面，再点击“查找课程”。之后可切换或关闭 BB 页面。${state.discoveryWarning||''}`);
  if(state.courses.length===1) selectCourse(state.courses[0].id);
  note(`找到 ${state.courses.length} 门匹配课程`);await save();return state.courses;
}
function selectCourse(id) {
  const course=state.courses.find(c=>c.id===id);if(!course)throw new Error('请选择匹配的课程');
  state.course=course;const root=state.mapping[id];state.rootId=root?.rootId||null;state.rootPath=root?.path||'';
  state.items=[];state.structure=null;state.records=null;state.recordsError='';state.warnings=[];state.error='';state.phase='choose';
}
async function metadata(file) {
  try {
    let r=await fetch(file.url,{method:'HEAD',credentials:'include',signal:AbortSignal.timeout(15000)});
    if(r.status===405) {r=await fetch(file.url,{headers:{Range:'bytes=0-0'},credentials:'include',signal:AbortSignal.timeout(15000)});await r.body?.cancel();}
    if(!r.ok)throw new Error(`附件返回 ${r.status}`);
    if(!allowedURL(r.url)||/\/login/.test(r.url))throw new Error('请重新登录 BB');
    const type=r.headers.get('content-type')||'';
    const disposition=r.headers.get('content-disposition')||'';
    let name=filenameFromHeaders(disposition,r.url,file.label);
    const extensions={'application/pdf':'.pdf','application/vnd.openxmlformats-officedocument.presentationml.presentation':'.pptx','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'.docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'.xlsx','video/mp4':'.mp4'};
    if(!/\.[a-z0-9]{1,10}$/i.test(name)&&extensions[type.split(';')[0]])name+=extensions[type.split(';')[0]];
    if(type.includes('text/html')&&!disposition)throw new Error('附件返回网页，可能需要重新登录');
    const length=r.headers.get('content-range')?.match(/\/(\d+)$/)?.[1]||r.headers.get('content-length');
    return {...file,name,size:length?Number(length):null,mime:type,metadataError:null};
  }catch(error){return {...file,name:safeName(file.label),size:null,metadataError:describeError(error)};}
}
async function mapLimit(values,limit,fn) {let next=0;const result=new Array(values.length);await Promise.all(Array.from({length:Math.min(limit,values.length)},async()=>{while(next<values.length){const index=next++;result[index]=await fn(values[index]);}}));return result;}
async function scan() {
  if(scanRunning)throw new Error('正在扫描，请稍候');
  if(!state.course||!state.rootId)throw new Error('请先选择课程和保存目录');
  scanRunning=true;state.phase='scanning';state.items=[];state.structure=null;state.records=null;state.warnings=[];state.error='';state.scannedPages=0;await save();
  try {
    await native('ping');
    const result=await scanCourse(state.course,state.scope,getPage,async progress=>{
      state.scannedPages=progress.pages;state.scanLabel=progress.label;await save();
    });
    state.structure={version:2,nodes:result.nodes,areas:result.areas,ignored:result.ignored};
    state.warnings=result.warnings;
    state.scanId=crypto.randomUUID();state.scannedAt=new Date().toISOString();state.recordsError='';
    state.scanLabel='核对文件名与本地下载历史';await save();
    let items=await mapLimit(result.files,4,metadata);
    state.excludedItems=state.scope.videos?[]:items.filter(f=>isVideo(f.name)).map(f=>({...f,choice:'skip',status:'skipped'}));
    if(!state.scope.videos)items=items.filter(f=>!isVideo(f.name));
    const preview=await native('preview',{rootId:state.rootId,items});
    const statuses=new Map(preview.items.map(i=>[i.id,i]));
    state.items=items.map(i=>({...i,local:statuses.get(i.id),choice:statuses.get(i.id).status==='history'?'skip':statuses.get(i.id).status==='review'?'review':'download',status:'ready'}));
    state.localCount=preview.localCount;state.phase='preview';state.scanLabel='';note(`扫描完成：${result.areas.length} 个栏目，${items.length} 个唯一附件，${result.nodes.reduce((n,x)=>n+x.links.length,0)} 条链接；本地 ${preview.localCount} 个文件`);await save();
  }finally {scanRunning=false;}
}
/** Generated Markdown is separate from downloaded files and download history. */
async function writeRecords() {
  if(!state.structure)return;
  const result=await native('write_records',{
    rootId:state.rootId,course:state.course,scope:state.scope,scanId:state.scanId,scannedAt:state.scannedAt,
    nodes:state.structure.nodes,items:[...state.items,...(state.excludedItems||[])],warnings:state.warnings
  });
  state.recordsError='';state.records=result;
  note(`目录记录已更新：${result.indexPath}；${result.backups.length} 份用户修改备份`);
}
async function start(choices) {
  if(state.structure?.version!==2)throw new Error('扩展已更新，请重新扫描以生成栏目和条目结构');
  if(state.phase!=='preview')throw new Error('请先完成扫描预览');
  const byId=new Map(choices.map(c=>[c.id,c.choice]));
  for(const item of state.items){const choice=byId.get(item.id);if(!['download','remember','skip'].includes(choice))throw new Error('请先核实所有“可能已存在”的资料');item.choice=choice;}
  const decisions=new Map(choices.map(c=>[c.id,c]));
  const remembered=state.items.filter(i=>i.choice==='remember').map(i=>{
    const candidates=i.local.candidates||[],decision=decisions.get(i.id);
    const candidatePath=decision.candidatePath||(candidates.length===1?candidates[0].path:null);
    if(candidates.length>1&&!candidatePath&&!decision.unknownPath)throw new Error('多个本地同名文件，请选择对应文件或明确仅记历史');
    if(candidatePath&&!candidates.some(c=>c.path===candidatePath))throw new Error('候选文件已变化，请重新扫描核实');
    return {...i,candidatePath};
  });
  state.phase='confirming';await save();
  try{if(remembered.length)await native('remember',{rootId:state.rootId,items:remembered});await writeRecords();}
  catch(error){state.phase='preview';await save();throw error;}
  state.jobId=crypto.randomUUID();state.phase='downloading';state.error='';
  for(const item of state.items){item.status=item.choice==='download'?'queued':'skipped';delete item.error;delete item.downloadId;delete item.token;}
  note(`开始下载 ${state.items.filter(i=>i.status==='queued').length} 个文件`);await save();void pump();
}
async function launch(item) {
  item.status='preparing';await save();
  try {
    // Re-read attachment metadata when it was unavailable at scan time; never mark a login page complete.
    if(item.metadataError){const fresh=await metadata(item);Object.assign(item,fresh);if(fresh.metadataError)throw new Error(fresh.metadataError);}
    const task=await native('prepare',{rootId:state.rootId,item});item.token=task.token;item.status='starting';await save();
    item.downloadId=await chrome.downloads.download({url:item.url,filename:task.staging,saveAs:false,conflictAction:'uniquify'});
    item.status='active';if(state.phase==='paused')await chrome.downloads.pause(item.downloadId).catch(()=>{});await save();
    const [download]=await chrome.downloads.search({id:item.downloadId});if(download?.state==='complete')void finish(item,download);
  }catch(error){item.status='failed';item.error=describeError(error);await save();}
}
async function finish(item,download) {
  if(item.finishing||item.status==='done')return;item.finishing=true;
  try {
    if(download.state!=='complete')return;
    if(!['safe','accepted','allowlistedByPolicy','deepScannedSafe'].includes(download.danger))throw new Error('Chrome 要求人工核实此下载，请在 Chrome 下载列表中处理');
    item.status='filing';await save();
    const result=await native('finalize',{token:item.token,source:download.filename});
    item.status='done';item.savedPath=result.savedPath;item.bytesReceived=result.size;note(`已保存 ${result.savedPath}`);
    // The source staging file was moved; retain Chrome's history rather than erasing user records.
  }catch(error){item.status='failed';item.error=describeError(error);note(`${item.name}：${item.error}`);}
  finally{delete item.finishing;await save();void pump();}
}
async function pump() {
  await loaded;if(pumping||state.phase!=='downloading')return;pumping=true;
  try {
    let active=state.items.filter(i=>['active','starting','preparing','filing'].includes(i.status)).length;
    const launchers=[];
    for(const item of state.items){if(active>=3)break;if(item.status==='queued'){active++;launchers.push(launch(item));}}
    await Promise.all(launchers);
    const unfinished=state.items.some(i=>['queued','active','starting','preparing','filing'].includes(i.status));
    if(!unfinished){try{await writeRecords();}catch(error){state.recordsError=describeError(error);note(`目录记录更新失败：${state.recordsError}`);}state.phase='complete';note('本轮下载结束');await save();}
  }finally{pumping=false;}
  if(state.phase==='downloading'&&state.items.some(i=>i.status==='queued')&&state.items.filter(i=>['active','starting','preparing','filing'].includes(i.status)).length<3)void pump();
}
async function recover() {
  await loaded;if(pumping)return;
  if(['scanning','discovering'].includes(state.phase)){if(scanRunning||state.phase==='discovering')return;state.phase='choose';state.error='上次扫描中断，请重新扫描';await save();return;}
  if(!['downloading','paused','complete'].includes(state.phase))return;
  for(const item of state.items){
    if(item.finishing)continue;
    if(!['active','starting','preparing','filing'].includes(item.status))continue;
    if(!item.downloadId&&item.token){const list=await chrome.downloads.search({filenameRegex:`_BB_Downloads[/\\\\]${item.token}[/\\\\]`});item.downloadId=list[0]?.id;}
    if(item.downloadId!=null){const [download]=await chrome.downloads.search({id:item.downloadId});if(download?.state==='complete'){void finish(item,download);continue;}if(download?.state==='in_progress'){item.status='active';continue;}}
    item.status='failed';item.error='上次下载中断，可点击重试';
  }
  await save();void pump();
}
chrome.downloads.onChanged.addListener(delta=>{void(async()=>{await loaded;const item=state.items.find(i=>i.downloadId===delta.id);if(!item)return;if(delta.state?.current==='complete'){const[d]=await chrome.downloads.search({id:delta.id});if(d)await finish(item,d);}else if(delta.state?.current==='interrupted'){item.status='failed';item.error=delta.error?.current||'下载中断';await save();void pump();}})();});
chrome.action.onClicked.addListener(()=>{void(async()=>{const url=chrome.runtime.getURL('app.html');const tabs=await chrome.tabs.query({url});if(tabs.length)await chrome.tabs.update(tabs[0].id,{active:true});else await chrome.tabs.create({url});})();});
chrome.runtime.onStartup.addListener(()=>{void recover();});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='bb-recover')void recover();});
chrome.alarms.create('bb-recover',{periodInMinutes:1});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||message.target!=='worker')return;
  (async()=>{await loaded;const action=message.action;
    if(action==='state')return state;
    if(action==='helper')return native('ping');
    if(['discover','select','choose_root','scan'].includes(action)&&['downloading','paused','scanning','discovering','confirming'].includes(state.phase))throw new Error('请先完成当前任务；下载时可关闭面板，稍后返回');
    if(action==='discover')return discover(message.command);
    if(action==='select'){selectCourse(message.id);await save();return state;}
    if(action==='choose_root'){const root=await native('choose_root',{rootId:state.rootId});if(!root.cancelled){state.rootId=root.rootId;state.rootPath=root.path;if(state.course)state.mapping[state.course.id]=root;await save();}return root;}
    if(action==='scan'){void scan().catch(async error=>{state.error=describeError(error);state.phase='choose';await save();});return {started:true};}
    if(action==='start'){await start(message.choices);return {started:true};}
    if(action==='pause'){state.phase='paused';await save();await Promise.all(state.items.filter(i=>i.status==='active').map(i=>chrome.downloads.pause(i.downloadId).catch(()=>{})));return state;}
    if(action==='resume'){state.phase='downloading';await Promise.all(state.items.filter(i=>i.status==='active').map(i=>chrome.downloads.resume(i.downloadId).catch(()=>{})));await save();void pump();return state;}
    if(action==='records'){await writeRecords();await save();return state;}
    if(action==='retry'){for(const item of state.items.filter(i=>i.status==='failed')){if(item.downloadId!=null){const[d]=await chrome.downloads.search({id:item.downloadId});if(d?.state==='complete'){void finish(item,d);continue;}}item.status='queued';delete item.error;delete item.downloadId;}state.phase='downloading';await save();void pump();return state;}
    throw new Error('未知操作');
  })().then(result=>respond({ok:true,result})).catch(async error=>{if(message.action==='discover'){state.phase='choose';state.error=describeError(error);await save();}respond({ok:false,error:describeError(error)});});return true;
});
void loaded.then(()=>{if(state.phase==='downloading')void recover();});
