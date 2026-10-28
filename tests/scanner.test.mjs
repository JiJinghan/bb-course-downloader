import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from 'linkedom';
import {parsePage} from '../extension/parser.mjs';
import {scanCourse} from '../extension/scanner.mjs';
import {ignoredSection,referenceURL} from '../extension/core.mjs';
globalThis.DOMParser=DOMParser;
const origin='https://bb.cuhk.edu.cn',cid='_mat_1';
const page=id=>`${origin}/webapps/blackboard/content/listContent.jsp?course_id=${cid}&content_id=${id}`;
const attachment=id=>`${origin}/bbcswebdav/pid-10-rid-${id}_1/xid-${id}_1`;
const menu=`<ul id="courseMenuPalette_contents">${['Lecture Notes','Midterm','aNnOuNcEmEnTs','Discussions','GROUPS','Tools','help'].map((n,i)=>`<li><a href="${page(i)}">${n}</a></li>`).join('')}</ul>`;
const html=body=>`<title>Lecture Notes – MAT1001</title>${menu}<ul id="content_listContainer">${body}</ul>`;
const row=(id,title,body)=>`<li id="${id}"><h3>${title}</h3>${body}</li>`;
const course={id:cid,title:'MAT1001',url:page(0),rootURL:page(0)};
const scope={code:'MAT1001',week:null,session:null,videos:true};

test('MAT1001 scans all menu areas, preserves item hierarchy and links, skips excluded areas and deduplicates resources',async()=>{
 const pages=new Map([
  [page(0),html(row('w1','Week1-1, Lecture 1',`<a href="${attachment(1)}">notes.pdf</a><a href="https://example.edu/math?a=1&amp;b=2">Proof website</a>`)+row('text','Notice','Only text')+row('folder',`<a href="${page(9)}">Extra material</a>`,''))],
  [page(1),html(row('review','Review',`<a href="${attachment(1)}">same notes.pdf</a>`))],
  [page(9),html(row('link','Further reading','<a href="https://example.org/">Book</a>')+row('cycle',`<a href="${page(0)}">Back</a>`,''))]
 ]);
 const fetched=[];
 const r=await scanCourse(course,scope,async url=>{fetched.push(url);assert(pages.has(url),`unexpected visit ${url}`);return parsePage(pages.get(url),url,cid);});
 assert.deepEqual(r.areas,['Lecture Notes','Midterm']);assert.equal(r.ignored.length,5);
 assert.equal(r.files.length,1);assert.equal(r.files[0].locations.length,2);
 assert.deepEqual(r.files[0].folders,['Lecture Notes','Week1-1, Lecture 1']);
 assert(r.nodes.some(n=>n.path.join('/')==='Lecture Notes/Extra material/Further reading'&&n.links.length===1));
 assert(r.nodes.some(n=>n.title==='Notice'&&n.fileIds.length===0));
 assert.equal(r.nodes.find(n=>n.title==='Week1-1, Lecture 1').links[0].url,'https://example.edu/math?a=1&b=2');
 assert.equal(fetched.length,3);assert(r.warnings.some(w=>w.includes('循环')));
});

test('exclusions are case insensitive exact menu labels, links never expand network permissions',()=>{
 for(const name of ['Announcements','DISCUSSIONS',' groups ','Tools','help'])assert(ignoredSection(name));
 assert(!ignoredSection('Helpful readings'));assert(!referenceURL('javascript:alert(1)'));assert(!referenceURL('https://user:secret@example.org/'));
 const p=parsePage(html(row('1','Links','<a href="#top">top</a><a href="javascript:foo()">action</a><a href="https://example.org/" role="button">control</a><a href="https://example.org/book.pdf">Book</a>')),page(0),cid);
 assert.deepEqual(p.items[0].links,[{title:'Book',url:'https://example.org/book.pdf'}]);
});

test('week scope matches content item headings; same sanitized titles get separate paths',async()=>{
 const p=html(row('a','Week1: Notes',`<a href="${attachment(1)}">a.pdf</a>`)+row('b','Week1/ Notes',`<a href="${attachment(2)}">b.pdf</a>`)+row('c','Week10: Notes',`<a href="${attachment(3)}">c.pdf</a>`));
 const r=await scanCourse(course,{...scope,week:1},async url=>parsePage(url===page(0)?p:html(''),url,cid));
 assert.equal(r.files.length,2);assert.notDeepEqual(r.files[0].folders,r.files[1].folders);
});

test('a failed sibling area is visible as a warning, not silently reported as empty',async()=>{
 const r=await scanCourse(course,scope,async url=>{if(url===page(1))throw new Error('BB 返回 503');return parsePage(html(''),url,cid);});
 assert(r.warnings.some(w=>w.includes('Midterm')&&w.includes('503')));
});
