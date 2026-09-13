const {readFileSync}=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {ref,set,get,update,remove}=require('firebase/database');
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
const env=await initializeTestEnvironment({projectId:'demo-project-controls',database:{rules:readFileSync('database.rules.json','utf8'),host:'127.0.0.1',port:18200}});
try{
await env.withSecurityRulesDisabled(async ctx=>set(ref(ctx.database()),{users:{boss:{role:'boss',status:'active'},pm:{role:'pm',status:'active'},apm:{role:'apm',status:'active',projects:{p:true}},suspended:{role:'boss',status:'suspended'}},projects:{p:{name:'Fixture',status:'active',createdAt:1,payrollLogs:{log:{net:1000}},purchaseOrders:{po:{total:1000,invoiceAmount:1000}}}}}));
const db=uid=>env.authenticatedContext(uid).database();const boss=db('boss');
const entry={kind:'payroll',sourceId:'log',type:'payment',amountCents:20000,date:'2026-09-13',payeeName:'Ana',reference:'BANK-001',method:'bank',notes:'Partial',createdAt:Date.now(),createdBy:'boss',createdByName:'Alex'};
const path='projectPaymentEvents/p/a';
await check('Boss can record an actual payment',()=>assertSucceeds(set(ref(boss,path),entry)));
await check('PM can read the payment register',()=>assertSucceeds(get(ref(db('pm'),'projectPaymentEvents/p'))));
await check('APM cannot read payment records',()=>assertFails(get(ref(db('apm'),'projectPaymentEvents/p'))));
await check('APM cannot write payment records',()=>assertFails(set(ref(db('apm'),'projectPaymentEvents/p/b'),{...entry,createdBy:'apm'})));
await check('suspended user cannot write payment records',()=>assertFails(set(ref(db('suspended'),'projectPaymentEvents/p/b'),{...entry,createdBy:'suspended'})));
await check('unauthenticated access is rejected',()=>assertFails(get(ref(env.unauthenticatedContext().database(),'projectPaymentEvents/p'))));
await check('existing payment cannot be overwritten',()=>assertFails(set(ref(boss,path),{...entry,amountCents:100})));
await check('existing payment cannot be deleted',()=>assertFails(remove(ref(boss,path))));
await check('payment register cannot be replaced at a parent path',()=>assertFails(set(ref(boss,'projectPaymentEvents/p'),{other:entry})));
await check('invalid payroll source is rejected',()=>assertFails(set(ref(boss,'projectPaymentEvents/p/b'),{...entry,sourceId:'missing'})));
await check('zero and fractional cent payments are rejected',async()=>{await assertFails(set(ref(boss,'projectPaymentEvents/p/b'),{...entry,amountCents:0}));await assertFails(set(ref(boss,'projectPaymentEvents/p/b'),{...entry,amountCents:0.5}));});
await check('forged recorder is rejected',()=>assertFails(set(ref(boss,'projectPaymentEvents/p/b'),{...entry,createdBy:'pm'})));
await check('unexpected fields are rejected',()=>assertFails(set(ref(boss,'projectPaymentEvents/p/b'),{...entry,extra:'unexpected'})));
await check('supplier credit note is allowed',()=>assertSucceeds(set(ref(boss,'projectPaymentEvents/p/credit'),{...entry,kind:'supplier',sourceId:'po',type:'credit'})));
await check('payroll credit is rejected',()=>assertFails(set(ref(boss,'projectPaymentEvents/p/b'),{...entry,type:'credit'})));
const correction={...entry,type:'void',voids:'a',amountCents:0,notes:'Wrong amount'};
await check('correction adds an immutable void event',()=>assertSucceeds(set(ref(boss,'projectPaymentEvents/p/void_a'),correction)));
await check('same payment cannot be voided twice',()=>assertFails(set(ref(boss,'projectPaymentEvents/p/void_a'),correction)));
await check('void must use its deterministic ID',()=>assertFails(set(ref(boss,'projectPaymentEvents/p/random'),correction)));
await check('void cannot point at another obligation',()=>assertFails(set(ref(boss,'projectPaymentEvents/p/void_credit'),{...correction,voids:'credit'})));
await check('two distinct payment records can both be recorded without lost updates',async()=>{await Promise.all([assertSucceeds(set(ref(boss,'projectPaymentEvents/p/concurrent1'),{...entry,reference:'B1'})),assertSucceeds(set(ref(boss,'projectPaymentEvents/p/concurrent2'),{...entry,reference:'B2'}))]);});
console.log(JSON.stringify({result:'PASS',checks}));
}finally{await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});
