// Fictional reviewer fixtures; no company data or integrations.
const make = (id, label, profile, policy, rows) => ({id,label,profile,policy,items:rows.map(([sku,name,location,onHand,threshold,target,unitCents,mode,leadDays,minOrder,packSize,maxOrder,inbound,demand])=>({sku,name,location,onHand,threshold,target,unitCents,mode,leadDays,minOrder,packSize,maxOrder,inbound,demand,supplier:`Fictional ${id} Supply`}))});
export const environments = [
 make('fulfillment','Fictional fulfillment center · Amazon-inspired','High velocity parcel picking; peak-season packaging demand.',{maxUnits:1200,maxCents:180000},[
 ['FC-BOX','Shipping carton','Sample FC / pack mezzanine',240,800,2400,85,'request-per-order',3,600,120,3000,0,'720/day; evening dispatch peak'],
 ['FC-TAPE','Packing tape roll','Sample FC / pack zone B',80,160,800,210,'standing-policy',2,120,60,1200,0,'110/day; campaign surge'],
 ['FC-SCAN','Handheld scanner','Sample FC / secure cage',80,30,90,18500,'request-per-order',14,5,5,100,0,'2/day; replacement demand'],
 ['FC-LABEL','Label roll','Sample FC / outbound',60,100,500,490,'request-per-order',4,100,50,1000,100,'90/day; confirmed inbound covers threshold']]),
 make('supercenter','Fictional supercenter · Walmart-inspired','Mixed grocery and general merchandise; weekend promotions.',{maxUnits:360,maxCents:60000},[
 ['SC-CEREAL','Cereal box','Sample store / grocery backroom',35,90,300,280,'request-per-order',2,48,24,480,0,'60/day; weekend promotion'],
 ['SC-WATER','Water six-pack','Sample store / beverage bay',60,120,360,175,'standing-policy',1,120,60,600,0,'95/day; weather-sensitive'],
 ['SC-TV','Display television','Sample store / locked electronics',25,10,30,22000,'request-per-order',7,5,5,40,0,'3/day; seasonal'],
 ['SC-YOG','Yogurt tray','Sample store / chilled bay',12,30,72,650,'request-per-order',1,12,12,96,24,'20/day; short shelf life']]),
 make('wholesale','Fictional wholesale club · Costco-inspired','Bulk pallet replenishment; business-member weekend demand.',{maxUnits:96,maxCents:90000},[
 ['WC-RICE','Bulk rice sack','Sample club / pallet aisle 4',10,40,130,1890,'request-per-order',6,48,24,192,0,'18/day; restaurant buyers'],
 ['WC-TOWEL','Paper towel case','Sample club / reserve rack',12,36,108,2400,'standing-policy',5,48,24,192,0,'24/day; weekend bulk trips'],
 ['WC-FREEZER','Chest freezer','Sample club / appliance reserve',18,6,24,31000,'request-per-order',21,6,6,30,0,'1/day; seasonal'],
 ['WC-COFFEE','Coffee bulk case','Sample club / food pallet',8,24,72,4200,'request-per-order',7,24,12,120,24,'12/day; inbound coverage']])
];
