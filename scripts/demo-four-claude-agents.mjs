// Four real Claude-powered agents. Isolated synthetic presentation lab.
// Read-only investigation: no imports of Lookout's database, server or inventory writers.
// Run: node --env-file=.env scripts/demo-four-claude-agents.mjs
import { randomUUID } from 'node:crypto';
const apiKey=process.env.ANTHROPIC_API_KEY, model=process.env.CLAUDE_MODEL;
if(!apiKey || !model){console.error('Set ANTHROPIC_API_KEY and CLAUDE_MODEL locally.');process.exit(1);}
const runId=randomUUID(), history=[];
const fixture=Object.freeze({
  sku:'OAT-01', location:'Demo Supermarket / Aisle 2',
  recordedOnHand:8, observedPhysicalCount:5, revision:7,
  evidence:[{type:'manual_count',reference:'synthetic-count-001',count:5}],
  caveat:'Synthetic observation. No camera, barcode device, ERP or live inventory connection.'
});
const definitions=[
  {name:'Detection',objective:'Investigate the reported count. Validate evidence and distinguish observations from inferred causes.'},
  {name:'Reconciliation',objective:'Independently compare recorded and observed counts. Identify variance, uncertainty, and further evidence needed.'},
  {name:'Review Coordination',objective:'Decide what information a human reviewer should see. Organize a review request, never impersonate a reviewer.'},
  {name:'Inventory Action',objective:'Assess whether any stock adjustment may proceed. There is no human approval in this lab, so do not execute an inventory mutation; document the blocked action and safe next step.'}
];
const tools=[
 {name:'read_inventory_snapshot',description:'Read fictional inventory and observations. Does not infer shrink or theft.',input_schema:{type:'object',properties:{sku:{type:'string'}},required:['sku']}},
 {name:'read_previous_handoffs',description:'Read recorded agent handoffs from this synthetic run.',input_schema:{type:'object',properties:{},required:[]}},
 {name:'record_handoff',description:'Save an agent finding and next step. This has no inventory side effects.',input_schema:{type:'object',properties:{finding:{type:'string'},uncertainty:{type:'string'},recommended_next_step:{type:'string'}},required:['finding','uncertainty','recommended_next_step']}}
];
function executeTool(actor,block){
 let result;
 if(block.name==='read_inventory_snapshot') result=block.input?.sku===fixture.sku?fixture:{error:'SKU not found'};
 else if(block.name==='read_previous_handoffs') result=history;
 else if(block.name==='record_handoff'){
   const args=block.input??{};
   if(['finding','uncertainty','recommended_next_step'].some(k=>typeof args[k]!=='string'||!args[k].trim()))result={error:'Required handoff fields missing'};
   else {const entry={agent:actor,step:history.length+1,finding:args.finding,uncertainty:args.uncertainty,recommended_next_step:args.recommended_next_step};history.push(entry);result={saved:true,entry};}
 } else result={error:'Tool not permitted'};
 return result;
}
async function claude(messages,system){
 const signal=AbortSignal.timeout(30000);
 const response=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal,headers:{'x-api-key':apiKey,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model,max_tokens:750,temperature:0,system,tools,messages})});
 const body=await response.json();
 if(!response.ok)throw Error('Claude API returned HTTP '+response.status+' ('+(body.error?.type??'unknown')+').');
 return body;
}
async function runAgent(agent){
 const before=history.length;
 const messages=[{role:'user',content:'Case '+runId+': Investigate SKU OAT-01. Here are the prior agent handoffs: '+JSON.stringify(history)+'. Use available tools to inspect facts and record ONE evidence-grounded handoff. Your specific responsibility: '+agent.objective}];
 for(let turn=0;turn<5;turn++){
   const result=await claude(messages,'You are Lookout '+agent.name+', a tool-using AI agent. Make your own investigative choices using tools. Your tools are scoped to a fictional presentation fixture. Never claim theft. A shelf count is not necessarily total stock. Do not invent approvals or assert that you changed inventory. Use record_handoff once with clear uncertainty and next step. Stop after recording your handoff.');
   messages.push({role:'assistant',content:result.content});
   const requests=result.content.filter(x=>x.type==='tool_use');
   if(!requests.length)break;
   const outputs=requests.map(call=>{
     const value=executeTool(agent.name,call);
     console.log(JSON.stringify({agent:agent.name,tool:call.name,result:value.error?'rejected':'ok'}));
     return {type:'tool_result',tool_use_id:call.id,content:JSON.stringify(value)};
   });
   messages.push({role:'user',content:outputs});
   if(history.length>before)break;
 }
 if(history.length===before)throw Error(agent.name+' did not record a structured handoff.');
}
console.log('Lookout four-agent Claude demo | run '+runId+' | synthetic fixture | no inventory writes');
for(const agent of definitions){await runAgent(agent);console.log('Handoff completed:',agent.name);}
if(history.length!==4)throw Error('Incomplete run: expected four handoffs.');
console.log(JSON.stringify({runId,mode:'synthetic-read-only',realLLMCalls:true,agents:history,inventoryBefore:fixture.recordedOnHand,inventoryAfter:fixture.recordedOnHand,inventoryChanged:false,humanApproval:false},null,2));
