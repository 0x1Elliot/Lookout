import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startWorkspace} from './startup.js';
import {connectBackend} from './secure-client.js';

class Element {
  children=[]; handlers={}; hidden=false; disabled=false; inert=false; textContent=''; value='';
  addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  remove(){this.removed=true;}
  contains(node){return node===this || this.children.some(child=>child.contains?.(node));}
  setAttribute(){}
}
function setup(t){
  const ids=Object.fromEntries(['workspace-controls','startup-panel','startup-message','startup-retry','agent-mode','agent-description','agent-persistence','agent-reviewer'].map(id=>[id,new Element()]));
  const main=new Element(),footer=new Element(),pill=new Element(),body=new Element();
  main.append(ids['workspace-controls']);
  const document={body,querySelector:selector=>({'main':main,'footer':footer,'.status-pill':pill})[selector],
    getElementById:id=>ids[id],createElement:()=>new Element(),handlers:[],addEventListener(type,fn,capture){this.handlers.push({type,fn,capture});}};
  const previous={document:globalThis.document,location:globalThis.location};
  globalThis.document=document;globalThis.location={hash:''};
  t.after(()=>{globalThis.document=previous.document;globalThis.location=previous.location;});
  const submit=target=>{
    const event={target,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    document.handlers.filter(h=>h.type==='submit').forEach(h=>h.fn(event));return event;
  };
  return {document,ids,main,footer,submit};
}

test('workspace remains locked while authentication is pending; mounts and unlocks once ready',async t=>{
  const ui=setup(t);let resolve,mounts=0;
  const auth=new Promise(done=>{resolve=done;});
  const backend={initial:{identity:{role:'worker'}}};
  const boot=startWorkspace({document:ui.document,connect:()=>auth,mount:actual=>{assert.strictEqual(actual,backend);mounts++;}});
  assert.equal(ui.ids['workspace-controls'].disabled,true);assert.equal(ui.main.hidden,true);assert.equal(ui.main.inert,true);
  assert.equal(ui.submit(ui.ids['workspace-controls']).stopped,true);
  resolve(backend);await boot.started;
  assert.equal(ui.ids['workspace-controls'].disabled,false);assert.equal(ui.main.hidden,false);assert.equal(ui.main.inert,false);
  assert.equal(ui.ids['startup-panel'].hidden,true);
  const event=ui.submit(ui.ids['workspace-controls']);assert.equal(event.prevented,true);assert.equal(event.stopped,undefined);
  await boot.attempt();assert.equal(mounts,1);
});

test('HTTP 503 shows sanitized error, prevents form navigation, and Retry recovers without duplicate mount',async t=>{
  const ui=setup(t);let configCalls=0,mounts=0;
  t.mock.method(globalThis,'fetch',async()=>++configCalls===1
    ? new Response('{"error":"private server details"}',{status:503})
    : Response.json({mode:'demo'}));
  const boot=startWorkspace({document:ui.document,connect:connectBackend,mount:backend=>{assert.equal(backend,null);mounts++;}});
  await boot.started;
  assert.match(ui.ids['startup-message'].textContent,/could not connect/);
  assert.ok(!ui.ids['startup-message'].textContent.includes('private'));
  assert.equal(ui.ids['startup-retry'].disabled,false);assert.equal(ui.ids['workspace-controls'].disabled,true);
  const event=ui.submit(ui.ids['workspace-controls']);assert.equal(event.prevented,true);assert.equal(event.stopped,true);
  await boot.attempt();assert.equal(configCalls,2);assert.equal(mounts,1);assert.equal(ui.main.hidden,false);
  assert.equal(ui.document.handlers.filter(h=>h.type==='submit').length,1);
});

test('network and malformed configuration failures never unlock inventory or enable demo fallback',async t=>{
  const ui=setup(t);let calls=0,mounts=0;
  t.mock.method(globalThis,'fetch',async()=>{
    if(++calls===1)throw Error('private network address');
    return new Response('not JSON');
  });
  const boot=startWorkspace({document:ui.document,connect:connectBackend,mount:()=>{mounts++;}});
  await boot.started;await boot.attempt();
  assert.equal(mounts,0);assert.equal(ui.ids['workspace-controls'].disabled,true);assert.equal(ui.main.hidden,true);
  assert.equal(ui.ids['startup-retry'].disabled,false);assert.ok(!ui.ids['startup-message'].textContent.includes('private'));
});

test('secure backend only unlocks workspace after authenticated inventory load',async t=>{
  const ui=setup(t);let release,mounts=0;
  const inventory=new Promise(done=>{release=done;});
  t.mock.method(globalThis,'fetch',async path=>path==='/api/config'?Response.json({mode:'secure',authProvider:'supabase'}):inventory);
  const boot=startWorkspace({document:ui.document,connect:connectBackend,mount:backend=>{assert.equal(backend.initial.identity.name,'Test worker');mounts++;}});
  await new Promise(done=>setImmediate(done));
  assert.equal(mounts,0);assert.equal(ui.ids['workspace-controls'].disabled,true);
  release(Response.json({identity:{role:'worker',name:'Test worker'},revision:0,inventory:{}}));
  await boot.started;assert.equal(mounts,1);assert.equal(ui.ids['workspace-controls'].disabled,false);
});

test('static markup starts with hidden inert workspace and disabled controls even before scripts execute',async()=>{
  const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.match(html,/<main[^>]* hidden inert>/);
  assert.match(html,/<fieldset id="workspace-controls" disabled/);
  assert.match(html,/<button id="startup-retry"[^>]*type="button" disabled hidden>/);
});

test('unauthenticated startup stays locked until password login and authenticated inventory read complete',async t=>{
  const ui=setup(t);let reads=0,mounts=0,loginCalls=0;
  t.mock.method(globalThis,'fetch',async(path,options)=>{
    if(path==='/api/config')return Response.json({mode:'secure',authProvider:'supabase'});
    if(path==='/api/auth/login'){loginCalls++;assert.equal(options.method,'POST');return Response.json({message:'Signed in.'});}
    assert.equal(path,'/api/inventory');
    return ++reads===1?Response.json({error:'Sign in required.'},{status:401})
      :Response.json({identity:{role:'worker',name:'Test worker'},revision:0,inventory:{}});
  });
  const boot=startWorkspace({document:ui.document,connect:connectBackend,mount:()=>{mounts++;}});
  await new Promise(done=>setImmediate(done));
  assert.equal(ui.ids['workspace-controls'].disabled,true);assert.equal(mounts,0);assert.equal(ui.ids['startup-panel'].hidden,true);
  const section=ui.document.body.children[0],form=section.children[2];
  form.children[1].children[1].value='worker@example.test';
  form.children[2].children[1].value='Synthetic-test-password';
  let prevented=false;await form.handlers.submit[0]({preventDefault(){prevented=true;}});await boot.started;
  assert.equal(prevented,true);assert.equal(loginCalls,1);assert.equal(reads,2);assert.equal(mounts,1);
  assert.equal(section.removed,true);assert.equal(ui.ids['workspace-controls'].disabled,false);
});

test('initial inventory failure removes incomplete sign-in UI and permits a clean retry',async t=>{
  const ui=setup(t);let reads=0,mounts=0;
  t.mock.method(globalThis,'fetch',async path=>path==='/api/config'?Response.json({mode:'secure',authProvider:'supabase'})
    :++reads===1?Response.json({error:'private initialization details'},{status:503})
      :Response.json({identity:{role:'worker',name:'Test worker'},revision:0,inventory:{}}));
  const boot=startWorkspace({document:ui.document,connect:connectBackend,mount:()=>{mounts++;}});
  await boot.started;
  assert.equal(ui.document.body.children[0].removed,true);assert.equal(ui.ids['startup-retry'].disabled,false);
  assert.equal(ui.ids['workspace-controls'].disabled,true);assert.ok(!ui.ids['startup-message'].textContent.includes('private'));
  await boot.attempt();assert.equal(mounts,1);assert.equal(ui.main.hidden,false);
});

test('retry after a rendering failure reloads instead of duplicating partial workspace handlers',async t=>{
  const ui=setup(t);let mounts=0,reloads=0;
  ui.document.defaultView={location:{reload(){reloads++;}}};
  const boot=startWorkspace({document:ui.document,connect:async()=>({}),mount:()=>{mounts++;throw Error('render failed');}});
  await boot.started;assert.equal(ui.ids['workspace-controls'].disabled,true);
  await boot.attempt();assert.equal(reloads,1);assert.equal(mounts,1);
});
