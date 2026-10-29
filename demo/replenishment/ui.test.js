import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createDemo} from './engine.js';
const source=await readFile(new URL('./ui.js',import.meta.url),'utf8');
function harness(){
 const nodes=new Map();const make=()=>({textContent:'',children:[],append(n){this.children.push(n);},replaceChildren(...n){this.children=n;this.textContent='';}});
 for(const id of ['tenant','inventory','proposals','audit','environment','profile','notice'])nodes.set('#'+id,make());nodes.get('#tenant').value='fulfillment';
 const buttons=['detect','grant','revoke'].map(action=>Object.assign(make(),{dataset:{action}}));nodes.set('[data-action=grant]',buttons[1]);
 const requests=[];vm.runInNewContext(source,{document:{querySelector:s=>nodes.get(s),querySelectorAll:()=>buttons,createElement:make},fetch:(_,opts)=>new Promise(resolve=>requests.push({body:JSON.parse(opts.body),resolve}))});
 const d=createDemo({now:()=>0});const state=t=>d.snapshot(d.issue(t,'agent'));
 const reply=async(index,tenant)=>{requests[index].resolve({ok:true,json:async()=>state(tenant)});await new Promise(resolve=>setImmediate(resolve));};
 return {nodes,buttons,requests,reply,d};
}
test('UI switching clears old state and ignores delayed responses from an earlier environment',async()=>{
 const h=harness();await h.reply(0,'fulfillment');assert.match(h.nodes.get('#environment').textContent,/fulfillment/);
 h.buttons[0].onclick();h.nodes.get('#tenant').value='supercenter';h.nodes.get('#tenant').onchange();assert.equal(h.nodes.get('#inventory').children.length,0);assert.equal(h.nodes.get('#audit').textContent,'');
 await h.reply(2,'supercenter');await h.reply(1,'fulfillment');assert.match(h.nodes.get('#environment').textContent,/supercenter/);assert.doesNotMatch(h.nodes.get('#audit').textContent,/fulfillment/);assert.equal(h.requests[2].body.tenant,'supercenter');
 h.buttons[1].onclick();assert.equal(h.requests[3].body.tenant,'supercenter');
});
test('proposal controls retain their source scope and cannot mutate a newly selected environment',async()=>{
 const h=harness();const a=h.d.issue('fulfillment','agent');h.d.detect(a);await h.reply(0,'fulfillment');const oldButton=h.nodes.get('#proposals').children[0].children[0];
 h.nodes.get('#tenant').value='wholesale';h.nodes.get('#tenant').onchange();await h.reply(1,'wholesale');const count=h.requests.length;oldButton.onclick();assert.equal(h.requests.length,count);assert.match(h.nodes.get('#environment').textContent,/wholesale/);
});
