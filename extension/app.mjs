const $=id=>document.getElementById(id);let current,selection=new Map(),candidateSelection=new Map(),selectionKey='',commandDirty=false;
async function rpc(action,extra={}){const reply=await chrome.runtime.sendMessage({target:'worker',action,...extra});if(!reply?.ok)throw new Error(reply?.error||'无法连接扩展后台');return reply.result;}
function error(message){$('error').textContent=message||'';$('error').hidden=!message;}
function size(n){if(n==null)return'—';return n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${(n/1024).toFixed(0)} KB`;}
function el(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;}
const statusText={ready:'待确认',queued:'等待下载',preparing:'准备下载',starting:'正在连接',active:'下载中',filing:'正在归档',done:'已保存',failed:'需要处理',skipped:'已跳过'};
function render(state){
  current=state;
  if(!commandDirty&&document.activeElement!==$('command')&&state.command)$('command').value=state.command;
  const locked=['discovering','scanning','downloading','paused','confirming'].includes(state.phase);
  $('discover').disabled=locked;$('command').disabled=locked;$('chooseRoot').disabled=locked||commandDirty||!state.course;
  $('scan').disabled=locked||commandDirty||!state.course||!state.rootId;
  $('commandHint').hidden=!commandDirty;
  $('rootPath').textContent=state.rootPath||'选择已有课程文件夹，或在选择窗口中新建';
  $('courseWrap').hidden=!state.courses?.length;
  const courseKey=JSON.stringify(state.courses);
  if($('course').dataset.key!==courseKey){const placeholder=el('option','请选择正确的学期 / 班级');placeholder.value='';placeholder.disabled=true;$('course').replaceChildren(placeholder,...(state.courses||[]).map(c=>{const o=el('option',c.title);o.value=c.id;return o;}));$('course').dataset.key=courseKey;}
  $('course').value=state.course?.id||'';$('course').disabled=locked;
  error(state.error);
  $('recordsError').textContent=state.recordsError?`附件处理结果已保留，但目录记录更新失败：${state.recordsError}`:'';
  $('recordsError').hidden=!state.recordsError;$('records').hidden=!state.recordsError||state.phase!=='complete';
  $('results').hidden=!['scanning','preview','downloading','paused','complete'].includes(state.phase);
  const headings={scanning:'正在扫描课程资料…',preview:'下载前，再核实一次。',downloading:'正在后台下载',paused:'下载已暂停',complete:'本轮处理完成'};
  $('phaseTitle').textContent=headings[state.phase]||'下载预览';
  $('phaseDetail').textContent=state.phase==='scanning'?`已读取 ${state.scannedPages||0} 个页面 · ${state.scanLabel||''}`:state.course?.title||'';
  const items=state.items||[];const count=kind=>items.filter(i=>i.local?.status===kind).length;
  $('total').textContent=items.length;$('newCount').textContent=count('new');$('historyCount').textContent=count('history');$('reviewCount').textContent=count('review');
  const done=items.filter(i=>i.status==='done').length,failed=items.filter(i=>i.status==='failed').length;
  $('progressBadge').textContent=state.phase==='preview'?'已对照本地目录':`${done} 已保存 · ${failed} 失败`;
  $('warnings').textContent=(state.warnings||[]).join('\n');$('warnings').hidden=!state.warnings?.length;
  $('start').hidden=state.phase!=='preview';$('pause').hidden=state.phase!=='downloading';$('resume').hidden=state.phase!=='paused';$('retry').hidden=!failed||state.phase!=='complete';
  const key=`${state.course?.id}:${state.rootId}:${items.map(i=>i.id).join('|')}`;
  if(selectionKey!==key){selectionKey=key;selection=new Map(items.map(i=>[i.id,i.choice]));candidateSelection=new Map();}
  $('start').disabled=items.some(i=>(selection.get(i.id)||i.choice)==='review');
  const structure=state.structure;
  $('structureSummary').hidden=!structure;$('structurePreview').hidden=!structure;
  if(structure){
    const linkCount=structure.nodes.reduce((n,x)=>n+x.links.length,0);
    $('structureSummary').textContent=`扫描栏目：${structure.areas.join('、')}。发现 ${linkCount} 条老师链接。忽略：Announcements、Discussions、Groups、Tools、Help。点击开始后才保存文件、链接和课程目录。${state.records?.indexPath?' 目录记录：'+state.records.indexPath:''}`;
    $('structureList').replaceChildren(...structure.nodes.map(n=>{
      const row=el('li');row.append(el('strong',n.path.join(' / ')));
      row.append(el('span',` — ${n.fileIds.length} 个附件，${n.links.length} 条链接${n.kind==='item'&&!n.fileIds.length&&!n.links.length?'；只记录标题':''}`));
      if(n.links.length){const list=el('ul');for(const link of n.links)list.append(el('li',`${link.title} — ${link.url}`));row.append(list);}return row;
    }));
  }
  const rows=[];
  for(const item of items){
    if($('onlyActionable').checked&&item.local?.status==='history'&&item.status!=='failed')continue;
    const row=el('tr'),name=el('td');name.append(el('span',item.name,'filename'),el('span',item.folders.join(' / ')||'课程根目录','filepath'));if(item.locations?.length>1)name.append(el('span',`另有 ${item.locations.length-1} 处引用，只保存一份`,'detail'));row.append(name,el('td',size(item.size)));
    const info=el('td');
    if(state.phase==='preview'){
      const local=item.local;const labels={new:'新增资料',history:'历史已下载',review:'本地可能已存在'};
      info.append(el('span',labels[local.status],`status ${local.status}`));
      if(local.status==='history')info.append(el('span',local.exists?`已保存过：${local.savedPath}，默认跳过`:'曾下载；原路径已变动或未记录，默认仍跳过','detail'));
      if(local.status==='review')info.append(el('span',local.candidates.map(c=>`${c.path} · ${size(c.size)}`).join('\n'),'detail'));
      if(item.metadataError)info.append(el('span',`待重试：${item.metadataError}`,'detail'));
    }else{info.append(el('span',statusText[item.status]||item.status,`status ${item.status}`));if(item.error)info.append(el('span',item.error,'detail'));if(item.savedPath)info.append(el('span',item.savedPath,'detail'));}
    row.append(info);const action=el('td');
    if(state.phase==='preview'){
      const select=el('select');select.setAttribute('aria-label',`${item.name} 的操作`);
      const options=item.local.status==='review'?[['review','请选择核实结果'],['remember','已有，记入历史'],['download','下载一份'],['skip','本次跳过']]:item.local.status==='history'?[['skip','跳过已下载'],['download','重新下载一份']]:[['download','下载'],['skip','本次跳过'],['remember','已手动下载，记入历史']];
      for(const[value,text]of options){const option=el('option',text);option.value=value;select.append(option);}select.value=selection.get(item.id)||item.choice;
      select.addEventListener('change',()=>{selection.set(item.id,select.value);updateStart();});action.append(select);
      if(item.local.candidates?.length>1){
        const candidate=el('select');candidate.setAttribute('aria-label',`${item.name} 对应的本地文件`);
        const placeholder=el('option','记入历史时请选择对应文件');placeholder.value='';candidate.append(placeholder);
        for(const c of item.local.candidates){const option=el('option',`${c.path} · ${size(c.size)}`);option.value=c.path;candidate.append(option);}
        const unknown=el('option','位置不确定，只记录曾经下载');unknown.value='__unknown__';candidate.append(unknown);
        candidate.value=candidateSelection.get(item.id)||'';candidate.addEventListener('change',()=>{candidateSelection.set(item.id,candidate.value);updateStart();});action.append(candidate);
      }
    }else action.textContent=item.status==='done'?'✓':item.status==='skipped'?'—':'';
    row.append(action);rows.push(row);
  }
  $('files').replaceChildren(...rows);$('empty').hidden=items.length>0||state.phase==='scanning';
  $('log').replaceChildren(...(state.log||[]).slice().reverse().map(l=>el('li',`${l.time}　${l.text}`)));updateStart();
}
function updateStart(){
  const items=current?.items||[];
  const n=items.filter(i=>(selection.get(i.id)||i.choice)==='download').length;
  $('start').textContent=n?`开始下载 ${n} 个文件，并保存目录与链接`:'保存目录、链接和核实结果';
  $('start').disabled=commandDirty||items.some(i=>{const choice=selection.get(i.id)||i.choice;return choice==='review'||(choice==='remember'&&i.local.candidates?.length>1&&!candidateSelection.get(i.id));});
}
async function refresh(){try{render(await rpc('state'));}catch(e){error(e.message);}}
async function run(action,extra={}){try{error('');await rpc(action,extra);if(action==='discover')commandDirty=false;await refresh();}catch(e){error(e.message);}}
$('command').addEventListener('input',()=>{commandDirty=$('command').value.trim()!==(current?.command||'').trim();if(current)render(current);});
$('commandForm').addEventListener('submit',e=>{e.preventDefault();void run('discover',{command:$('command').value});});
$('course').addEventListener('change',()=>{selectionKey='';void run('select',{id:$('course').value});});
$('chooseRoot').addEventListener('click',()=>void run('choose_root'));
$('scan').addEventListener('click',()=>{selectionKey='';void run('scan');});
$('start').addEventListener('click',()=>void run('start',{choices:current.items.map(i=>({id:i.id,choice:selection.get(i.id)||i.choice,candidatePath:candidateSelection.get(i.id)==='__unknown__'?null:candidateSelection.get(i.id),unknownPath:candidateSelection.get(i.id)==='__unknown__'}))}));
for(const action of ['pause','resume','retry','records'])$(action).addEventListener('click',()=>void run(action));
$('onlyActionable').addEventListener('change',()=>render(current));
chrome.runtime.onMessage.addListener(m=>{if(m.target==='ui'&&m.type==='changed')void refresh();});
await refresh();
try{const helper=await rpc('helper');$('helperStatus').textContent=helper.version==='1.1.0'?'本地助手已连接':'本地助手版本较旧，请重新运行安装助手';}catch{$('helperStatus').textContent='请先运行安装助手.command';$('helperStatus').classList.add('bad');}
