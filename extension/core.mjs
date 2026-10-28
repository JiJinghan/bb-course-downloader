export const ORIGIN = 'https://bb.cuhk.edu.cn';
export const HOST = 'cn.cuhk.bb_downloader';
export function parseCommand(text) {
  const course = text.toUpperCase().match(/\b([A-Z]{2,8}\s*\d{3,5})\b/);
  if (!course) throw new Error('请输入课程号，例如：下载 ENG2001 的 W7，包含视频');
  const week = text.match(/(?:\bW(?:EEK)?\s*|第\s*)(\d{1,2})(?:\s*周)?\b/i);
  const session = text.match(/\bS(?:ESSION)?\s*([12])\b/i);
  return {code:course[1].replace(/\s/g,''), week:week?Number(week[1]):null,
    session:session?Number(session[1]):null, videos:!/(不含|不要|不下|排除|跳过)视频/.test(text)};
}
export function safeName(value) {
  let name=String(value||'未命名').normalize('NFC').replace(/[\x00-\x1f\x7f/\\:]/g,'_').trim().replace(/^\.+/,'_');
  if (!name) name='未命名';
  // Keep paths portable; preserve extension when compacting long names.
  const ext=name.match(/\.[a-z0-9]{1,10}$/i)?.[0]||'';
  while(new TextEncoder().encode(name).length>200) name=name.slice(0,-ext.length-2)+ext;
  return name;
}
export function allowedURL(value, base=ORIGIN) {
  try { const u=new URL(value,base); return u.origin===ORIGIN && !u.username && !u.password ? u.href : null; } catch {return null;}
}
export function resourceId(url, courseId) {
  const u=new URL(url); const rid=u.pathname.match(/(?:xid-|rid-)(\d+_\d+)/)?.[1];
  return `${courseId}:${rid||u.pathname}`;
}
export function filenameFromHeaders(disposition, url, fallback) {
  let name='';
  const extended=disposition?.match(/filename\*\s*=\s*(?:UTF-8)?''([^;]+)/i);
  if(extended) {try{name=decodeURIComponent(extended[1].trim().replace(/^"|"$/g,''));}catch{}}
  if(!name) name=disposition?.match(/filename\s*=\s*"([^"]+)"/i)?.[1] || disposition?.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim() || '';
  if(!name) {try {const leaf=decodeURIComponent(new URL(url).pathname.split('/').pop()); if(/\.[a-z0-9]{1,10}$/i.test(leaf)) name=leaf;}catch{}}
  return safeName(name||fallback);
}
export function scopeMatch(path, scope) {
  const value=path.join('/');
  const week=scope.week==null || new RegExp(`(?:^|/)(?:W(?:eek)?\\s*0?${scope.week})(?:\\D|$)`,'i').test(value);
  const session=scope.session==null || new RegExp(`(?:^|/)S(?:ession)?\\s*${scope.session}(?:\\D|$)`,'i').test(value);
  return week && session;
}
export function isVideo(name) {return /\.(mp4|m4v|mov|webm|mkv|avi|wmv)$/i.test(name);}
export function describeError(error) {return error?.message||String(error);}

// Product rule: exact sidebar labels, whitespace trimmed, case-insensitive.
export const IGNORED_SECTIONS = ['announcements', 'discussions', 'groups', 'tools', 'help'];
export function ignoredSection(title) {
  return IGNORED_SECTIONS.includes(String(title).trim().toLowerCase());
}
// A URL may be saved as a reference without being permitted as a network target.
export function referenceURL(value, base=ORIGIN) {
  try { const u=new URL(value,base); return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password ? u.href : null; } catch { return null; }
}

export function contentAreaURL(value) {
  const href=allowedURL(value);if(!href)return false;
  const u=new URL(href);
  return /\/listContent\.jsp$/.test(u.pathname) ||
    (/\/launchLink\.jsp$/.test(u.pathname) && u.searchParams.has('content_id') && u.searchParams.get('tool_type')!=='TOOL');
}
