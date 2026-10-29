// Isolated synthetic simulator. Never imported by production handlers.
export function createDemo({ now = () => Date.now() } = {}) {
  const principals = new Map();
  const tenants = new Map();
  const copy = value => structuredClone(value);
  const rows = [
    ['OAT-1L','Oat drink, 1 L','Backroom A / ambient',8,12,48,249,'request-per-order'],
    ['TOM-400','Chopped tomatoes, 400 g','Backroom A / ambient',18,24,72,129,'standing-policy'],
    ['RICE-1K','Long grain rice, 1 kg','Backroom B / dry',80,20,60,189,'request-per-order'],
    ['MILK-2L','Whole milk, 2 L','Cold room / bay 2',4,10,24,319,'request-per-order'],
  ];
  for (const tenant of ['market-east','market-west']) {
    tenants.set(tenant, { items: rows.map(([sku,name,location,onHand,threshold,target,unitCents,mode]) => ({sku,name,location,onHand,threshold,target,unitCents,mode,supplier:'Synthetic Pantry Supply',inbound:sku==='MILK-2L'?24:0})), proposals:[], policies:{}, audit:[] });
  }
  function principal(token) { const p=principals.get(token); if(!p) throw Error('Unknown demo capability'); return p; }
  function record(s,p,event,detail) { s.audit.push({at:new Date(now()).toISOString(),actor:p.id,event,...detail}); }
  function access(token, role) { const p=principal(token); if(role && p.role!==role) throw Error('Role denied'); return [p,tenants.get(p.tenant)]; }
  // Harness-issued opaque capabilities, not request-supplied role/tenant claims.
  function issue(tenant,role) { if(!tenants.has(tenant)||!['agent','reviewer','operator'].includes(role)) throw Error('Invalid fixture identity'); const token=Symbol(); principals.set(token,{tenant,role,id:`${tenant}:${role}`}); return token; }
  function snapshot(token) { const [,s]=access(token); return copy({...s, items:s.items.map(i=>({...i, projected:i.onHand+i.inbound+s.proposals.filter(r=>r.sku===i.sku&&r.status==='simulated').reduce((n,r)=>n+r.units,0)}))}); }
  function policy(token,sku,enabled) {
    const [p,s]=access(token,'reviewer'); const item=s.items.find(i=>i.sku===sku);
    if(!item || item.mode!=='standing-policy' || typeof enabled!=='boolean') throw Error('Unsupported policy');
    s.policies[sku]={enabled,version:(s.policies[sku]?.version??0)+1,grantedBy:p.id,expires:now()+3600000,maxUnits:60,maxCents:10000,supplier:item.supplier};
    record(s,p,enabled?'policy-granted':'policy-revoked',{sku,version:s.policies[sku].version});
    return snapshot(token);
  }
  function detect(token) {
    const [p,s]=access(token,'agent');
    for (const r of s.proposals) {
      if (['pending','approved'].includes(r.status) && now()-r.created>=900000) {
        r.status='expired'; record(s,p,'proposal-expired',{proposal:r.id});
      }
    }
    for(const i of s.items) {
      // Strictly below threshold; outstanding simulated orders and confirmed inbound
      // affect projections only. They never alter physical stock.
      const outstanding=s.proposals.filter(r=>r.sku===i.sku&&r.status==='simulated').reduce((n,r)=>n+r.units,0);
      const projected=i.onHand+i.inbound+outstanding;
      if(projected>=i.threshold || s.proposals.some(r=>r.sku===i.sku&&(['pending','approved'].includes(r.status) || (r.status==='rejected' && r.onHand===i.onHand)))) continue;
      const r={id:`${p.tenant}:${s.proposals.length+1}`,sku:i.sku,units:i.target-projected,cents:(i.target-projected)*i.unitCents,onHand:i.onHand,projected,supplier:i.supplier,status:'pending',created:now(),policyVersion:null};
      s.proposals.push(r); record(s,p,'low-stock-proposed',{proposal:r.id,stage:'Detection → Reconciliation',projected,threshold:i.threshold});
    }
    return snapshot(token);
  }
  function review(token,id,outcome) {
    const [p,s]=access(token,'reviewer'); const r=s.proposals.find(r=>r.id===id);
    if(!r || !['approve','reject'].includes(outcome)) throw Error('Invalid review');
    if(r.review===outcome) return snapshot(token);
    if(r.status!=='pending') throw Error('Final decision already recorded');
    r.status=outcome==='approve'?'approved':'rejected'; r.review=outcome; r.reviewer=p.id;
    record(s,p,'human-review',{proposal:id,outcome,stage:'Review Coordination'}); return snapshot(token);
  }
  function execute(token,id) {
    const [p,s]=access(token,'agent'); const r=s.proposals.find(r=>r.id===id);
    if(!r) throw Error('Proposal not found in tenant');
    if(r.status==='simulated') return snapshot(token); // Natural-key retry, no duplicate order.
    const i=s.items.find(i=>i.sku===r.sku); const pol=s.policies[r.sku];
    const standing=i.mode==='standing-policy' && pol?.enabled && pol.expires>now() && pol.supplier===r.supplier && r.units<=pol.maxUnits && r.cents<=pol.maxCents;
    const outstanding=s.proposals.filter(q=>q.sku===r.sku&&q.status==='simulated').reduce((n,q)=>n+q.units,0);
    const fresh=now()-r.created<900000 && i.onHand===r.onHand && i.onHand+i.inbound+outstanding===r.projected;
    if(!fresh || !['pending','approved'].includes(r.status) || !(standing || r.status==='approved')) {
      record(s,p,'execution-blocked',{proposal:id,reason:!fresh?'stale inventory or proposal':'human approval or valid standing policy required'});
      throw Error('Held for human review; approval/policy or fresh inventory required');
    }
    r.status='simulated'; r.authorization=standing?'standing-policy':'request-per-order'; r.policyVersion=standing?pol.version:null;
    record(s,p,'simulated-order',{proposal:id,stage:'Inventory Action',authorization:r.authorization,policyVersion:r.policyVersion,units:r.units,cents:r.cents});
    return snapshot(token);
  }
  function receive(token,id) {
    const [p,s]=access(token,'operator'); const r=s.proposals.find(r=>r.id===id);
    if(r?.status==='received') return snapshot(token);
    if(r?.status!=='simulated') throw Error('No simulated shipment');
    s.items.find(i=>i.sku===r.sku).onHand+=r.units; r.status='received'; record(s,p,'synthetic-receipt',{proposal:id}); return snapshot(token);
  }
  return {issue,snapshot,policy,detect,review,execute,receive};
}
