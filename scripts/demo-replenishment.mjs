import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createDemo} from '../demo/replenishment/engine.js';
import {environments} from '../demo/replenishment/environments.js';
const demo=createDemo();
const identities=Object.fromEntries(['market-east','market-west',...environments.map(e=>e.id)].map(t=>[t,Object.fromEntries(['agent','reviewer','operator'].map(r=>[r,demo.issue(t,r)]))]));
const port=Number(process.env.PORT??4180);
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
 try{
 if(req.method==='GET' && ['/', '/ui.js'].includes(req.url)){res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');return res.end(await readFile(new URL(req.url==='/'?'../demo/replenishment/index.html':'../demo/replenishment/ui.js',import.meta.url)));}
 if(req.method!=='POST'||req.url!=='/state')throw Error('Unknown route');
 if(req.headers.origin && req.headers.origin!==`http://127.0.0.1:${port}`)throw Error('Origin denied');
 if(req.headers.host!==`127.0.0.1:${port}` || req.headers['content-type']!=='application/json')throw Error('Invalid local request');
 let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)throw Error('Request too large');}
 const {tenant,action,id}=JSON.parse(body); const p=Object.hasOwn(identities,tenant)?identities[tenant]:null;if(!p)throw Error('Unknown tenant');
 const actions={read:()=>demo.snapshot(p.agent),detect:()=>demo.detect(p.agent),grant:()=>demo.policy(p.reviewer,demo.snapshot(p.agent).items.find(i=>i.mode==='standing-policy').sku,true),revoke:()=>demo.policy(p.reviewer,demo.snapshot(p.agent).items.find(i=>i.mode==='standing-policy').sku,false),approve:()=>demo.review(p.reviewer,id,'approve'),reject:()=>demo.review(p.reviewer,id,'reject'),execute:()=>demo.execute(p.agent,id),receive:()=>demo.receive(p.operator,id)};
 if(!Object.hasOwn(actions,action))throw Error('Unknown action');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(actions[action]()));
 }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic demo only: http://127.0.0.1:${port}`));
