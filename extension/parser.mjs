import {allowedURL, resourceId, safeName, ignoredSection, referenceURL, contentAreaURL} from './core.mjs';

const MENU = '#courseMenuPalette_contents, #courseMenu, .courseMenu';
const CONTENT = '#content_listContainer, #contentList, .contentList';
const text = node => node?.textContent.trim().replace(/\s+/g, ' ') || '';
const isArea = u => contentAreaURL(u.href);

/** Parse HTML only: never execute BB scripts or visit a teacher's external links. */
export function parsePage(html, url, courseId = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const login = !!doc.querySelector('input[type=password],form[action*="login"] input[name="user_id"]');
  const courses = [], roots = [], ignoredRoots = [], folders = [], files = [], items = [];
  const menu = [...doc.querySelectorAll(`${MENU.split(', ').map(s => s + ' a[href]').join(', ')}`)];
  // Minimal Classic themes may lack the menu wrapper. Only the legacy Content
  // label is a safe fallback; arbitrary links in posts must never become roots.
  const rootLinks = menu.length ? menu : [...doc.querySelectorAll('a[href]')].filter(a =>
    /^(Content|Course Content|Course Materials|Learning Materials|课程内容|课程资料|教学资料)$/i.test(text(a)));
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = allowedURL(a.getAttribute('href'), url);
    if (!href) continue;
    const u = new URL(href), id = u.searchParams.get('course_id');
    if (id && text(a) && /courseMain/.test(u.pathname)) courses.push({id, title: text(a), url: href});
  }
  const seenRoots = new Set();
  for (const a of rootLinks) {
    const title = text(a), href = allowedURL(a.getAttribute('href'), url);
    if (!title || !href) continue;
    const u = new URL(href);
    if (ignoredSection(title)) { ignoredRoots.push({title, url: href}); continue; }
    if (u.searchParams.get('course_id') !== courseId || !isArea(u)) continue;
    if (!seenRoots.has(href)) { roots.push({url: href, title}); seenRoots.add(href); }
  }
  const containers = [...doc.querySelectorAll(CONTENT)];
  const rows = [...new Set(containers.flatMap(c => [...c.children].filter(n => n.tagName === 'LI')))];
  for (const [index, row] of rows.entries()) {
    const heading = row.querySelector('h3') || row.querySelector('.item h2');
    const title = text(heading) || '未命名条目';
    const id = row.id || row.getAttribute('data-content-id') || `row-${index + 1}`;
    const item = {id, title, name: safeName(title), files: [], links: [], folderURL: null};
    const seenLinks = new Set(), seenFiles = new Set();
    for (const a of row.querySelectorAll('a[href],video[src],video source[src],audio[src],audio source[src]')) {
      // Blackboard action menus are controls, not links shared by the teacher.
      if (a.closest('.contextMenuContainer, .contextMenu, .cmdiv, .itemActions') || a.getAttribute('role') === 'button') continue;
      const raw = a.getAttribute('href') || a.getAttribute('src');
      if (!raw || raw.startsWith('#')) continue;
      const href = referenceURL(raw, url);
      if (!href) continue;
      const u = new URL(href), label = text(a).replace(/^File\s+/, '') || title;
      if (allowedURL(href) && isArea(u) && u.searchParams.get('course_id') === courseId && heading?.contains(a)) {
        item.folderURL = href;
      } else if (allowedURL(href) && u.pathname.startsWith('/bbcswebdav/')) {
        const file = {id: resourceId(href, courseId), url: href, label, section: title, sectionId: id};
        if (!seenFiles.has(file.id)) { item.files.push(file); files.push(file); seenFiles.add(file.id); }
      } else if (!allowedURL(href) || !u.pathname.startsWith('/webapps/')) {
        if (!seenLinks.has(href)) { item.links.push({title: label, url: href}); seenLinks.add(href); }
      }
    }
    if (item.folderURL) folders.push({url: item.folderURL, name: item.name, id});
    items.push(item);
  }
  const frames = [...doc.querySelectorAll('iframe[src],frame[src]')]
    .map(f => allowedURL(f.getAttribute('src'), url)).filter(Boolean)
    .filter(u => /webapps\/blackboard\//.test(new URL(u).pathname));
  return {title: doc.title || '', login, courses, roots, ignoredRoots, folders, files, items, frames, contentList: containers.length > 0};
}
