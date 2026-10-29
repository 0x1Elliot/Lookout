import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const port=4181;
const child=spawn(process.execPath,['scripts/demo-replenishment.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});
try {
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Demo startup timed out')),5000);child.once('exit',code=>{clearTimeout(timeout);reject(Error(`Demo exited ${code}`));});child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});});
 const base=`http://127.0.0.1:${port}`;
 const call=async(action,id,tenant='market-east',extra={})=>{const response=await fetch(base+'/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id,tenant,...extra})});return {status:response.status,data:await response.json()};};
 assert.match(await (await fetch(base)).text(),/SIMULATION ONLY/);
 const {data:s}=await call('detect');assert.equal(s.proposals.length,2);const id=s.proposals[0].id;
 assert.equal((await call('execute',id,'market-east',{role:'reviewer',approved:true})).status,400);
 assert.equal((await call('execute',id,'market-west')).status,400);
 await call('approve',id);await call('execute',id);let result=await call('execute',id);assert.equal(result.data.items[0].onHand,8);assert.equal(result.data.items[0].projected,48);assert.equal(result.data.audit.filter(e=>e.event==='simulated-order').length,1);
 await call('grant');result=await call('execute',s.proposals[1].id);assert.equal(result.data.proposals[1].authorization,'standing-policy');
 await call('receive',id);result=await call('receive',id);assert.equal(result.data.items[0].onHand,48);
 assert.equal((await fetch(base+'/engine.js')).status,400);
 assert.equal((await fetch(base+'/state',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'})).status,400);
 assert.equal((await call('read',null,'__proto__')).status,400);
 console.log('Synthetic HTTP demo verified: page, detection, denied forged approval, tenant isolation, one-time review, standing policy, idempotent order/receipt, projection, private engine, origin and tenant validation.');
}finally{child.kill();await new Promise(resolve=>child.once('close',resolve));}
