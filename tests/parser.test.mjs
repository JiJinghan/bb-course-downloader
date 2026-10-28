import test from 'node:test';import assert from 'node:assert/strict';import {DOMParser} from 'linkedom';
import {parsePage} from '../extension/parser.mjs';globalThis.DOMParser=DOMParser;
const origin='https://bb.cuhk.edu.cn',course='_17806_1';
test('Classic content parser distinguishes real folders, item headings and external references',()=>{
  const html=`<html><head><title>W7</title></head><body><a href="/webapps/blackboard/execute/courseMain?course_id=${course}">ENG2001</a><a href="/bbcswebdav/sidebar.pdf">Sidebar</a><ul id="content_listContainer"><li><h3><a href="/webapps/blackboard/content/listContent.jsp?course_id=${course}&content_id=_s1">S1</a></h3></li><li><h3>Non-verbal communication</h3><a href="/bbcswebdav/pid-1-rid-42_1/xid-42_1">Eye contact.mp4</a><video src="/bbcswebdav/pid-1-rid-42_1/xid-42_1"></video><a href="https://evil.test/movie.mp4">external</a></li></ul></body></html>`;
  const p=parsePage(html,origin,course);assert(p.contentList);assert.equal(p.folders[0].name,'S1');assert.equal(p.files.length,1);assert.equal(p.items[1].links.length,1);assert.equal(p.items[1].title,'Non-verbal communication');assert.equal(p.files[0].label,'Eye contact.mp4');assert.equal(p.courses[0].id,course);assert(p.files.every(f=>!f.url.includes('sidebar')));
});
test('login pages are detected even when the HTTP status is 200',()=>{
  assert(parsePage('<html><input type="password"></html>',origin,course).login);
});
test('root navigation and same-origin frames can be discovered without executing page scripts',()=>{
  const p=parsePage(`<a href="/webapps/blackboard/content/listContent.jsp?course_id=${course}&content_id=_root">Content</a><iframe src="/webapps/blackboard/content/listContent.jsp?course_id=${course}&content_id=_root"></iframe><iframe src="https://evil.test/"></iframe>`,origin,course);
  assert.equal(p.roots.length,1);assert.equal(p.frames.length,1);
});
