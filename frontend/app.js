const parts=[
 {id:1,sku:'ENG-001',name:'V8 Engine Block · 5.7L',category:'Powertrain',supplier:'Bosch',price:3420,stock:24,lead:'7 days'},
 {id:2,sku:'ENG-002',name:'Forged Steel Crankshaft',category:'Powertrain',supplier:'Bosch',price:510,stock:38,lead:'5 days'},
 {id:3,sku:'ECU-8X',name:'Powertrain Control Module',category:'Electrical',supplier:'Denso',price:840,stock:7,lead:'12 days'},
 {id:4,sku:'BRK-014',name:'14-inch Vented Brake Rotor',category:'Chassis',supplier:'ZF Group',price:119,stock:86,lead:'3 days'},
 {id:5,sku:'HVC-220',name:'High-Voltage Cable Assembly',category:'Electrical',supplier:'Denso',price:286,stock:14,lead:'9 days'},
 {id:6,sku:'BOD-024',name:'Front Bumper Carrier',category:'Body',supplier:'Magna',price:450,stock:31,lead:'14 days'}
];
const cart=new Map();
const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);

function renderParts(){
 const query=$('#partSearch').value.toLowerCase();
 const category=$('#categoryFilters .active').dataset.category;
 const visible=parts.filter(p=>(category==='all'||p.category===category)&&`${p.sku} ${p.name} ${p.supplier}`.toLowerCase().includes(query));
 $('#partsGrid').innerHTML=visible.map(p=>`<article class="part-card"><div class="part-top"><span class="part-category">${p.category.toUpperCase()}</span><span class="stock ${p.stock<15?'low':''}">${p.stock} ON HAND</span></div><div class="part-visual"><span>${p.sku}</span></div><div><h3>${p.name}</h3><div class="part-meta">${p.sku} · LEAD ${p.lead.toUpperCase()}</div></div><div class="part-supplier"><span>Qualified supplier</span><strong>${p.supplier}</strong></div><div class="part-price"><div><strong>${money(p.price)}</strong><small> / EA</small></div><button class="add-button" data-add="${p.id}">＋ ADD</button></div></article>`).join('')||'<p>No approved parts match your search.</p>';
 $$('[data-add]').forEach(b=>b.onclick=()=>addToCart(Number(b.dataset.add)));
}
function addToCart(id){cart.set(id,(cart.get(id)||0)+1);renderCart();openDrawer()}
function renderCart(){
 const entries=[...cart.entries()];
 $('#cartCount').textContent=entries.reduce((n,[,q])=>n+q,0);
 $('#cartTotal').textContent=money(entries.reduce((n,[id,q])=>n+parts.find(p=>p.id===id).price*q,0));
 $('#cartItems').innerHTML=entries.length?entries.map(([id,q])=>{const p=parts.find(x=>x.id===id);return `<article class="cart-item"><p><strong>${p.name}</strong><small>${p.sku} · ${p.supplier}</small></p><div class="qty"><button data-minus="${id}">−</button><span>${q}</span><button data-plus="${id}">＋</button></div><strong>${money(p.price*q)}</strong><a data-remove="${id}">REMOVE</a></article>`}).join(''):'<div class="empty-cart"><span>□</span><strong>Your order is empty</strong><p>Add approved components from the catalog.</p></div>';
 $$('[data-minus]').forEach(b=>b.onclick=()=>changeQty(+b.dataset.minus,-1));
 $$('[data-plus]').forEach(b=>b.onclick=()=>changeQty(+b.dataset.plus,1));
 $$('[data-remove]').forEach(b=>b.onclick=()=>{cart.delete(+b.dataset.remove);renderCart()});
}
function changeQty(id,n){const next=(cart.get(id)||0)+n;next>0?cart.set(id,next):cart.delete(id);renderCart()}
function openDrawer(){$('#orderDrawer').classList.add('open');$('#drawerBackdrop').classList.add('open');$('#orderDrawer').setAttribute('aria-hidden','false')}
function closeDrawer(){$('#orderDrawer').classList.remove('open');$('#drawerBackdrop').classList.remove('open');$('#orderDrawer').setAttribute('aria-hidden','true')}
function openView(view){
 $('#commandView').classList.toggle('hidden',view!=='command');$('#catalogView').classList.toggle('hidden',view!=='catalog');$('#placeholderView').classList.toggle('hidden',['command','catalog'].includes(view));
 const labels={command:'COMMAND',orders:'PURCHASE ORDERS',catalog:'PARTS CATALOG',suppliers:'SUPPLIERS',schedule:'DOCK SCHEDULE',insights:'INTELLIGENCE'};
 $('#viewLabel').textContent=labels[view];$('#placeholderTitle').textContent=(labels[view]||view).toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
 $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view));document.body.classList.remove('mobile-open');window.scrollTo(0,0);
}

$$('.nav-item').forEach(b=>b.onclick=()=>openView(b.dataset.view));
$$('[data-open-view]').forEach(b=>b.onclick=()=>openView(b.dataset.openView));
$('#newOrderButton').onclick=()=>{openView('catalog');openDrawer()};$('#cartButton').onclick=openDrawer;$('#closeDrawer').onclick=closeDrawer;$('#drawerBackdrop').onclick=closeDrawer;
$('#partSearch').oninput=renderParts;$('#categoryFilters').onclick=e=>{if(e.target.tagName==='BUTTON'){$$('#categoryFilters button').forEach(b=>b.classList.remove('active'));e.target.classList.add('active');renderParts()}};
$('#menuButton').onclick=()=>document.body.classList.toggle('mobile-open');
$('#reviewOrder').onclick=()=>{if(!cart.size)return;cart.clear();renderCart();closeDrawer();$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),3500)};
renderParts();renderCart();
const initialView=new URLSearchParams(window.location.search).get('view');
if(initialView)openView(initialView);
