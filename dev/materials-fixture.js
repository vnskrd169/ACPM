/* Isolated sample database for Materials UI QA. Never loaded by the live app. */
(function (root) {
  function createMaterialsFixture() {
    const items = [
      ['Gypsum', '9mm', 2, 500], ['Metal Furring', '', 10, 165], ['Rivets', '1/8', 100, 1],
      ['Wall Angle', '', 8, 75], ['Drill Bit', '1/8', 100, 1], ['Cutter Blade', '', 5, 15],
      ['Cutter', '', 1, 85], ['Black Screw', '1 1/2', 500, 1]
    ].map(([desc, size, qty, cost], index) => ({ itemId: 'item_' + String(index + 1).padStart(3, '0'), itemKey: (desc + '||' + size).toLowerCase(), desc, size, qty, qtyOrdered: qty, qtyAccepted: desc === 'Wall Angle' ? 5 : qty, qtyRemaining: desc === 'Wall Angle' ? 3 : 0, cost, unitCost: cost, total: qty * cost, unit: 'pcs' }));
    const po = { id: 'demo-po', seq: 1, poNo: 'PO-001', supplier: 'Sample Hardware', supplierName: 'Sample Hardware', supplierId: 'hardware-a', date: '2026-09-10', total: 4110, createdAt: 1789090000000, status: 'partially_delivered', deliveryStatus: 'partially_delivered', receivedCost: 3885, items };
    const delivery = { poId: 'demo-po', receivedAt: 1789180000000, date: '2026-09-11', status: 'received', items: items.map(item => ({ ...item, poItemId: item.itemId, qtyReceived: item.qtyAccepted, qtyRejected: 0 })) };
    let data = { users: { 'demo-user': { name: 'Alex Santos', status: 'active', role: 'boss' } }, suppliers: { 'hardware-a': { name: 'Sample Hardware', status: 'active' }, 'hardware-b': { name: 'Second Hardware', status: 'active' } }, projects: { 'materials-demo': { name: 'Materials preview — sample project', status: 'active', createdAt: 1789090000000, materialBudget: 26400, materialSpent: 3885, materialReceivedCost: 3885, poCounter: 1, materialGroups: { framing: { name: 'Ceiling framing', items: items.filter(i => ['Wall Angle', 'Metal Furring'].includes(i.desc)).map(({ desc,size,qty,unit })=>({desc,size,qty,unit})) }, consumables: { name: 'Consumables', items: items.filter(i=>['Cutter Blade','Cutter'].includes(i.desc)).map(({desc,size,qty,unit})=>({desc,size,qty,unit})) } }, purchaseOrders: { 'demo-po': po }, deliveries: { 'demo-batch': delivery }, ledger: {}, inventory: {}, materialMovements: {} } } };
    const listeners = new Set(); let sequence = 0;
    const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
    const read = path => path.split('/').filter(Boolean).reduce((node, key) => node?.[key], data);
    function put(path, value) { const parts=path.split('/').filter(Boolean); const last=parts.pop(); let node=data; parts.forEach(key=>{node[key] ||= {};node=node[key]}); if(value===null) delete node[last];else node[last]=clone(value); }
    items.forEach((item,index)=>{
      put('projects/materials-demo/inventory/'+item.itemKey, {item:item.desc, description:item.desc,size:item.size,unit:item.unit,qtyOnHand:item.qtyAccepted,avgCost:item.cost,totalValue:item.qtyAccepted*item.cost,reorderPoint:0,lastReceived:'2026-09-11'});
      data.projects['materials-demo'].ledger['row-'+index]={...item,poId:'demo-po',poItemId:item.itemId,date:po.date,supplier:po.supplier,status:'ordered'};
      data.projects['materials-demo'].materialMovements['move-'+index]={type:'receive',description:item.desc,size:item.size,unit:item.unit,qtyIn:item.qtyAccepted,movementCost:item.qtyAccepted*item.cost,sourceType:'delivery',sourceId:'demo-batch',deliveryId:'demo-batch',poId:'demo-po',createdBy:'demo-user',createdAt:1789180000000+index};
    });
    function snapshot(path, value) { return { key:path.split('/').pop(),val:()=>clone(value),exists:()=>value!=null,forEach:fn=>{Object.entries(value||{}).forEach(([key,child])=>fn(snapshot(path+'/'+key,child)))} }; }
    function ref(path='', query={}) {
      path=path.replace(/^\/+|\/+$/g,'');
      function value(){let result=read(path); if(query.field){let rows=Object.entries(result||{}).filter(([,row])=>query.equal===undefined||row[query.field]===query.equal);rows.sort((a,b)=>(a[1][query.field]||0)-(b[1][query.field]||0));if(query.limit)rows=rows.slice(-query.limit);result=rows.length?Object.fromEntries(rows):null}return result}
      const api={key:path.split('/').pop(),child:key=>ref(path+'/'+key),orderByChild:field=>ref(path,{...query,field}),equalTo:equal=>ref(path,{...query,equal}),limitToLast:limit=>ref(path,{...query,limit}),once:async(event,cb)=>{const snap=snapshot(path,value());if(cb)cb(snap);return snap},on:(event,cb)=>{const entry={path,cb,read:()=>snapshot(path,value())};listeners.add(entry);cb(entry.read())},off:(event,cb)=>{for(const entry of listeners)if(entry.path===path&&(!cb||entry.cb===cb))listeners.delete(entry)},set:async value=>{put(path,value);emit()},update:async updates=>{for(const [key,value]of Object.entries(updates))put(path+'/'+key,value);emit()},push:()=>ref(path+'/-sample-'+String(++sequence).padStart(6,'0')),transaction:async updater=>{put(path,updater(read(path)));emit();return{committed:true,snapshot:snapshot(path,value())}}};return api;
    }
    function emit(){for(const entry of listeners)entry.cb(entry.read())}
    return {database:()=>({ref}),auth:()=>({currentUser:{uid:'demo-user'}}),read,put,emit,getData:()=>clone(data)};
  }
  if (typeof module !== 'undefined') module.exports = { createMaterialsFixture };
  else root.createMaterialsFixture = createMaterialsFixture;
})(typeof window !== 'undefined' ? window : globalThis);
