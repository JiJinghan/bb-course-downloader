import {safeName, scopeMatch, ignoredSection, describeError} from './core.mjs';

export function pageKey(value) {
  const u = new URL(value); u.hash = ''; u.searchParams.delete('mode'); u.searchParams.sort(); return u.href;
}
function suffix(value) {
  let h = 2166136261;
  for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** Assign distinct, portable sibling names after sanitizing teacher titles. */
function namesFor(nodes, identity) {
  const groups = new Map();
  for (const n of nodes) { const key = safeName(n.title).toLowerCase(); groups.set(key, (groups.get(key) || 0) + 1); }
  return nodes.map(n => ({...n, segment: groups.get(safeName(n.title).toLowerCase()) > 1
    ? safeName(`${safeName(n.title)} [${suffix(identity(n))}]`) : safeName(n.title)}));
}

/** Crawl all content areas once per URL, but retain every appearance in the tree.
 * getPage and progress are injected so crawling can be tested without Chrome.
 */
export async function scanCourse(course, scope, getPage, progress = async () => {}) {
  const cache = new Map(), warnings = [], roots = new Map(), ignored = new Set();
  let pages = 0;
  const read = async url => {
    const key = pageKey(url);
    if (!cache.has(key)) {
      if (cache.size >= 1500) throw new Error('课程页面超过 1500 个，请缩小范围');
      cache.set(key, getPage(url, course.id));
      pages++;
    }
    return cache.get(key);
  };
  const boot = [course.rootURL || course.url], bootSeen = new Set();
  let fallback;
  while (boot.length && bootSeen.size < 20) {
    const url = boot.shift(), key = pageKey(url);
    if (bootSeen.has(key)) continue;
    bootSeen.add(key);
    const p = await read(url);
    for (const r of p.roots || []) if (!ignoredSection(r.title)) roots.set(pageKey(r.url), r);
    for (const r of p.ignoredRoots || []) ignored.add(r.title);
    if (p.contentList) fallback ||= {url, title: (course.rootTitle || p.title || '课程资料').split(/\s+[–—-]\s+/)[0]};
    // A Classic course home can be a frameset. Stop bootstrapping once its menu is found.
    if (!roots.size) boot.push(...(p.frames || []));
  }
  if (!roots.size && fallback && !ignoredSection(fallback.title) && !ignored.size) {
    roots.set(pageKey(fallback.url), fallback);
    warnings.push('未识别到左栏菜单，只扫描了当前资料入口；请确认栏目是否完整。');
  }
  if (!roots.size) throw new Error('未找到可扫描的资料栏目。请打开该课程任一资料页面后重新查找。');
  const areas = namesFor([...roots.values()], r => pageKey(r.url));
  const queue = areas.map(r => ({url:r.url, path:[r.segment], id:`${course.id}|${pageKey(r.url)}`, ancestors:[]}));
  const nodes = [], files = new Map(); let traversals = 0;
  for (const r of queue) nodes.push({id:r.id, path:r.path, title:areas.find(a=>a.url===r.url).title, kind:'area', url:r.url, fileIds:[], links:[]});
  while (queue.length) {
    if (++traversals > 3000) throw new Error('课程目录引用过多，扫描停止');
    const entry = queue.shift(), key = pageKey(entry.url);
    if (entry.ancestors.includes(key)) { warnings.push(`循环目录已跳过：${entry.path.join('/')}`); continue; }
    if (entry.path.length > 25) { warnings.push(`目录过深，已跳过：${entry.path.join('/')}`); continue; }
    let p;
    try { p = await read(entry.url); }
    catch (error) {
      if (/登录/.test(describeError(error))) throw error;
      warnings.push(`${entry.path.join('/')}：${describeError(error)}`); continue;
    }
    await progress({pages, label:entry.path.join('/')});
    if (!p.contentList) {
      // A content-area launcher can lead through a frame; no tools/forums are crawled.
      if (p.frames?.length) for (const url of p.frames) queue.push({...entry,url,ancestors:[...entry.ancestors,key]});
      else warnings.push(`未识别资料列表：${entry.path.join('/')}`);
      continue;
    }
    for (const item of namesFor(p.items || [], i => i.id)) {
      const path = [...entry.path, item.segment];
      const id = `${entry.id}/${item.id}`;
      const week = item.title.match(/^W(?:eek)?\s*(\d+)\b/i);
      if (scope.week != null && week && Number(week[1]) !== scope.week) continue;
      const selected = scopeMatch(path, scope);
      if (!item.folderURL && !selected) continue;
      const node = {id,path,title:item.title,kind:item.folderURL?'folder':'item',url:entry.url,fileIds:[],links:selected?item.links:[]};
      nodes.push(node);
      if (selected) for (const file of item.files) {
        node.fileIds.push(file.id);
        const occurrence = {nodeId:id,folders:path};
        if (files.has(file.id)) files.get(file.id).locations.push(occurrence);
        else files.set(file.id,{...file,folders:path,courseId:course.id,locations:[occurrence]});
      }
      if (item.folderURL) queue.push({url:item.folderURL,path,id,ancestors:[...entry.ancestors,key]});
    }
  }
  return {files:[...files.values()],nodes,areas:areas.map(a=>a.title),ignored:[...ignored],warnings,pages};
}
