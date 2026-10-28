import test from 'node:test';import assert from 'node:assert/strict';
import {parseCommand,safeName,allowedURL,resourceId,filenameFromHeaders,scopeMatch} from '../extension/core.mjs';
test('Chinese commands support course, week and session without an AI service',()=>{
  assert.deepEqual(parseCommand('下载 ENG2001 的 W7，包含视频'),{code:'ENG2001',week:7,session:null,videos:true});
  assert.deepEqual(parseCommand('eng2001 第7周 S2 不要视频'),{code:'ENG2001',week:7,session:2,videos:false});
  assert.equal(parseCommand('MAT3007').week,null);assert.throws(()=>parseCommand('全部下载'));
});
test('scope respects full week number and session path',()=>{
  const s={week:7,session:1};assert(scopeMatch(['W7','S1'],s));assert(!scopeMatch(['W17','S1'],s));assert(!scopeMatch(['W7','S2'],s));assert(scopeMatch(['Week 7','Session 1'],s));
});
test('resource identity survives display-title changes and query strings',()=>{
  assert.equal(resourceId('https://bb.cuhk.edu.cn/bbcswebdav/pid-676400-dt-content-rid-12757046_1/xid-12757046_1?download=1','_17806_1'),'_17806_1:12757046_1');
});
test('network boundary excludes foreign origins and credentials',()=>{
  assert.equal(allowedURL('https://evil.test/bbcswebdav/file'),null);assert.equal(allowedURL('javascript:alert(1)'),null);assert.equal(allowedURL('https://user:pw@bb.cuhk.edu.cn/file'),null);assert.equal(allowedURL('/bbcswebdav/a'),'https://bb.cuhk.edu.cn/bbcswebdav/a');
});
test('attachment names use server filenames and cannot create nested paths',()=>{
  assert.equal(filenameFromHeaders('attachment; filename="Week7S2(1).pptx"','https://bb.cuhk.edu.cn/xid-1','W7S2 PPT'),'Week7S2(1).pptx');
  assert.equal(filenameFromHeaders("attachment; filename*=UTF-8''%E8%AF%BE%E4%BB%B6.pdf",'https://bb.cuhk.edu.cn/x','file'),'课件.pdf');
  assert(!safeName('../../bad\\path').includes('/'));assert(new TextEncoder().encode(safeName('很'.repeat(200)+'.pdf')).length<=200);
});
