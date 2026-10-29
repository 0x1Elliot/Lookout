const tenant=document.querySelector('#tenant');
function cell(row,text){const c=document.createElement('td');c.textContent=text;row.append(c);}
async function update(action='read',id){
 try{const response=await fetch('/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenant:tenant.value,action,id})});const s=await response.json();if(!response.ok)throw Error(s.error);
 const table=document.createElement('table');const head=document.createElement('tr');for(const t of ['SKU / product','Location','On hand','Confirmed inbound','Projected stock','Threshold / target','Unit cost','Authorization'])cell(head,t);table.append(head);
 for(const i of s.items){const row=document.createElement('tr');for(const v of [i.sku+' · '+i.name,i.location,i.onHand,i.inbound,i.projected,i.threshold+' / '+i.target,'$'+(i.unitCents/100).toFixed(2),i.mode])cell(row,v);table.append(row);}document.querySelector('#inventory').replaceChildren(table);
 const cards=s.proposals.map(r=>{const card=document.createElement('p');card.textContent=`${r.id} · ${r.sku} · ${r.units} units · $${(r.cents/100).toFixed(2)} · ${r.status} · ${r.authorization??'awaiting authorization'} `;
 for(const [action,label] of [['approve','Human: approve once'],['reject','Human: reject'],['execute','Agent: simulate order'],['receive','Operator: synthetic receipt']]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>update(action,r.id);card.append(b);}return card;});document.querySelector('#proposals').replaceChildren(...cards);document.querySelector('#audit').textContent=JSON.stringify({policies:s.policies,audit:s.audit},null,2);document.querySelector('#notice').textContent='Simulation updated. No external order sent.';
 }catch(e){document.querySelector('#notice').textContent=e.message;}
}
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>update(b.dataset.action));tenant.onchange=()=>update();update();
