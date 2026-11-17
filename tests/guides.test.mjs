import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertContracts, validateModel } from '../sdk/harness/contracts.mjs'
import { guideDate, guideSearchUrl, normalizeGuide, accessibilityArticle, isGuideDetail, runGuide } from '../src/guides.mjs'
import { apply } from '../server.mjs'
const contract = assertContracts(JSON.parse(readFileSync(new URL('../contracts/plugin.json', import.meta.url))))
const snapshot = overrides => ({ url: guideSearchUrl('mafengwo','杭州'), title: '杭州搜索', readyState: 'complete', gate: '', excerpt: '杭州攻略', empty: false, inputValues: ['杭州'], detailKind: '', rows: [], article: {title:'',text:'',method:'none',dateRaw:'',publishedMeta:'',modifiedMeta:'',images:[],truncated:false}, ...overrides })
test('dates retain uncertainty and validate calendar rather than inventing publication year',()=>{
 assert.deepEqual(guideDate('编辑于 08-30','visible'),{raw:'编辑于 08-30',evidence:'visible'})
 assert.equal(guideDate('发表于 2024-02-29','visible').date,'2024-02-29')
 assert.equal(guideDate('2025-02-29','metadata').date,undefined)
 assert.equal(guideDate('昨天','visible').date,undefined)
})
test('source URLs encode query text and reject external/authenticated detail navigation',()=>{
 for(const source of ['mafengwo','xiaohongshu','ctrip-guide']) assert.equal(new URL(guideSearchUrl(source,'杭州 & 西湖')).searchParams.get(source==='mafengwo'?'q':'keyword'),'杭州 & 西湖')
 assert.equal(isGuideDetail('https://you.ctrip.com/travels/hangzhou14/123.html','ctrip-guide'),true)
 for(const url of ['https://evil.test/i/123.html','https://www.mafengwo.cn.evil.test/i/123.html','https://user:secret@www.mafengwo.cn/i/123.html','http://www.mafengwo.cn/i/123.html','https://www.mafengwo.cn/search/q.php?q=杭州']) assert.equal(isGuideDetail(url,'mafengwo'),false)
})
test('layout changes, real empty and query mismatch never collapse into same result',()=>{
 const drift=normalizeGuide(snapshot(), 'mafengwo','tab','杭州');assert.equal(drift.status,'layout_changed');assert.match(drift.nextAction,/Agent.*浏览器/)
 assert.equal(normalizeGuide(snapshot({empty:true}),'mafengwo','tab','杭州').status,'empty')
 assert.equal(normalizeGuide(snapshot({empty:true,inputValues:['北京']}),'mafengwo','tab','杭州').status,'query_mismatch')
 assert.equal(normalizeGuide(snapshot({empty:true}),'mafengwo','tab').status,'layout_changed')
 for(const gate of ['login_required','verification_required','blocked','unavailable']) assert.equal(normalizeGuide(snapshot({gate,empty:true}),'mafengwo','tab','杭州').status,gate)
 validateModel(contract,'guide-result',drift)
})
test('AX fallback requires an article with matching heading and does not ingest navigation',()=>{
 const nodes=[{nodeId:'1',role:{value:'article'},childIds:['2','3','4']},{nodeId:'2',role:{value:'heading'},name:{value:'杭州两日游'}},{nodeId:'3',role:{value:'StaticText'},name:{value:'游西湖步行到断桥。'.repeat(30)}},{nodeId:'4',role:{value:'navigation'},childIds:['5']},{nodeId:'5',role:{value:'StaticText'},name:{value:'账号资料'}}]
 assert.ok(accessibilityArticle(nodes,'杭州两日游 - 马蜂窝').text.length>160)
 assert.doesNotMatch(accessibilityArticle(nodes,'杭州两日游').text,/账号资料/)
 assert.equal(accessibilityArticle(nodes,'其他标题'),undefined)
 assert.equal(accessibilityArticle(nodes.slice(1),'杭州两日游'),undefined)
})
test('abort releases acquired browser and never overwrites stored success',async()=>{
 const controller=new AbortController(),calls=[],storage=new Map([['last-guide-v1',{old:true}]])
 const run={signal:controller.signal,host:{browser:{tabs:{list:async()=>({tabs:[{id:'t',url:'https://www.mafengwo.cn/i/123.html'}]})},cdp:{attach:async()=>calls.push('attach'),send:async()=>{controller.abort();return {result:{value:snapshot()}}},release:async()=>calls.push('release')}}},state:{profile:{set:async(k,v)=>storage.set(k,v)}}}
 const r=await runGuide('read_guide',{tabId:'t'},run,contract)
 assert.equal(r.status,'cancelled');assert.deepEqual(calls,['attach','release']);assert.deepEqual(storage.get('last-guide-v1'),{old:true})
})
test('registered guide tools validate schema before accessing browser',async()=>{
 const tools=new Map();apply({extensions:{tools:{register:t=>tools.set(t.name,t)},rpc:{register(){}}}})
 const r=await tools.get('search_guides').execute({source:'mafengwo',query:'杭州',javascript:'attack'}, {})
 assert.equal(r.ok,false);assert.match(r.error,/契约/)
})
test('search accepts canonical trailing slash without weakening keyword verification',()=>{
 const s=snapshot({url:'https://www.xiaohongshu.com/search_result/?keyword=杭州',empty:true})
 assert.equal(normalizeGuide(s,'xiaohongshu','t','杭州').status,'empty')
 assert.equal(normalizeGuide(s,'xiaohongshu','t','北京').status,'query_mismatch')
})
