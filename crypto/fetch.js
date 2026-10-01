/* Crypto regime dashboard - browser fetch script.
   MUST run from a tab whose origin is https://api.llama.fi/v2/chains - a generic
   page such as example.com blocks the cross-origin fetches.
   Runs in the background (the tool call returns at once) and leaves a plain-text
   bundle in window.__TXT. Do NOT base64 it - encoded blobs are filtered in transit.
   Sources are all CORS-open; FRED and CoinGlass are not, which is why L3 is a
   TGA+RRP proxy and Z1/Z2 come from Binance. */
window.__TXT=null;window.__SUMMARY=null;window.__ERR=null;window.__STAGE='start';
window.__RUN=async function(){
 const j=async u=>{const r=await fetch(u);if(!r.ok)throw new Error(r.status+' '+u);return r.json()};
 const iso=t=>new Date(t).toISOString().slice(0,10);
 const back=(d,n)=>new Date(new Date(d)-n*864e5).toISOString().slice(0,10);
 const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
 const errs=[];
 const safe=async(name,fn,fb)=>{try{return await fn()}catch(e){errs.push(name+': '+e.message);return fb}};

 /* --- price, 1000 daily candles: enough for the 350-day (50-week) mean --- */
 const K=await j('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000');
 const B=K.map(x=>[iso(x[0]),Math.round(+x[4])]), px=B.map(r=>r[1]);

 /* --- top-5 alt breadth --- */
 const SYM={eth:'ETHUSDT',bnb:'BNBUSDT',xrp:'XRPUSDT',sol:'SOLUSDT',trx:'TRXUSDT'}, alts={};
 for(const [k,s] of Object.entries(SYM))
   alts[k]=await safe(k,async()=>(await j('https://api.binance.com/api/v3/klines?symbol='+s+'&interval=1d&limit=140'))
     .map(x=>[iso(x[0]),+(+x[4]).toPrecision(6)]),null);

 /* --- no-rate-limit sources in parallel --- */
 const [stab,vol,fund,oi,tga,rrp,tvl]=await Promise.all([
  safe('stables',()=>j('https://stablecoins.llama.fi/stablecoincharts/all'),[]),
  safe('vol',()=>j('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=90'),[]),
  safe('funding',()=>j('https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=200'),[]),
  safe('oi',()=>j('https://fapi.binance.com/futures/data/openInterestHist?symbol=BTCUSDT&period=1d&limit=60'),[]),
  safe('tga',()=>j('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?filter=record_date:gte:'+back(new Date().toISOString().slice(0,10),140)+',account_type:eq:Treasury%20General%20Account%20(TGA)%20Closing%20Balance&fields=record_date,open_today_bal,close_today_bal&sort=-record_date&page[size]=140'),{data:[]}),
  safe('rrp',()=>j('https://markets.newyorkfed.org/api/rp/reverserepo/propositions/search.json?startDate='+back(new Date().toISOString().slice(0,10),140)),{repo:{operations:[]}}),
  safe('tvl',()=>j('https://api.llama.fi/v2/historicalChainTvl'),[])
 ]);
 const M={};
 M.stab=Object.fromEntries(stab.map(r=>[iso(r.date*1000),r.totalCirculatingUSD.peggedUSD/1e6]));
 M.vol=Object.fromEntries(vol.map(k2=>[iso(k2[0]),+k2[7]/1e6]));
 const fm={};fund.forEach(f=>{const d=iso(f.fundingTime);(fm[d]=fm[d]||[]).push(+f.fundingRate)});
 M.fund=Object.fromEntries(Object.entries(fm).map(([d,a])=>[d,+(avg(a)*100).toFixed(5)]));
 M.oi=Object.fromEntries(oi.map(o=>[iso(o.timestamp),+o.sumOpenInterestValue/1e6]));
 M.tga=Object.fromEntries((tga.data||[]).map(r=>[r.record_date,
   +((r.close_today_bal&&r.close_today_bal!=='null')?r.close_today_bal:r.open_today_bal)]).filter(x=>x[1]>0));
 const rm={};((rrp.repo||{}).operations||[]).filter(x=>/Reverse/i.test(x.operationType))
   .forEach(x=>{rm[x.operationDate]=(rm[x.operationDate]||0)+(+x.totalAmtAccepted||0)});
 M.rrp=Object.fromEntries(Object.entries(rm).map(([d,v])=>[d,v/1e6]));

 /* --- synthetic DXY, ICE weights, from ECB rates via jsdelivr --- */
 M.dxy={};
 const days=[];for(let i=0;i<70;i++)days.push(back(new Date().toISOString().slice(0,10),i));
 const pull=async dt=>{try{
   const c=(await j('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@'+dt+'/v1/currencies/usd.json')).usd;
   if(!c)return;
   M.dxy[dt]=+(50.14348112*Math.pow(1/c.eur,-0.576)*Math.pow(c.jpy,0.136)*Math.pow(1/c.gbp,-0.119)
     *Math.pow(c.cad,0.091)*Math.pow(c.sek,0.042)*Math.pow(c.chf,0.036)).toFixed(3);
 }catch(e){}};
 for(let i=0;i<days.length;i+=12) await Promise.all(days.slice(i,i+12).map(pull));

 /* --- next-FOMC hike odds from Polymarket (slug changes each meeting) --- */
 let hike={};
 await safe('polymarket',async()=>{
  const ev=await j('https://gamma-api.polymarket.com/events?closed=false&limit=60&tag_slug=fed-rates&order=volume&ascending=false');
  const cand=ev.filter(e=>/^fed-decision-in-/.test(e.slug)&&new Date(e.endDate)>new Date())
               .sort((a,b)=>new Date(a.endDate)-new Date(b.endDate))[0];
  if(!cand){errs.push('polymarket: no upcoming fed-decision event');return;}
  const mk=(cand.markets||[]).filter(m=>/increase/i.test(m.groupItemTitle||''));
  const per={};
  for(const m of mk){
    const ids=JSON.parse(m.clobTokenIds||'[]'); if(!ids[0])continue;
    const h=await j('https://clob.polymarket.com/prices-history?market='+ids[0]+'&interval=1m&fidelity=1440');
    const byday={};(h.history||[]).forEach(p=>{byday[iso(p.t*1000)]=+(p.p*100).toFixed(1)});
    for(const d in byday) per[d]=(per[d]||0)+byday[d];
  }
  hike=per; window.__FEDSLUG=cand.slug;
 },null);

 /* --- ETF flows: Farside blocks cross-origin fetch, so they are scraped
        from the page itself. Left empty here; the task fills raw.flows. --- */

 const ffill=(o,d)=>{let x=new Date(d);for(let k=0;k<9;k++){const s=iso(x);if(o[s]!=null)return o[s];x=new Date(x-864e5);}return null;};
 const breadth=d=>{let n=0,cov=0;
   for(const k in alts){const s=alts[k];if(!s)continue;const i2=s.findIndex(r=>r[0]===d);if(i2<49)continue;
     cov++;if(s[i2][1]>avg(s.slice(i2-49,i2+1).map(r=>r[1])))n++;}
   return cov===5?n:null;};
 const SESS=40, der=[];
 for(let i=B.length-SESS;i<B.length;i++){
   const d=B[i][0], ma=n=>i>=n-1?Math.round(avg(px.slice(i-n+1,i+1))):null;
   const v7=[],v30=[];
   for(let k=0;k<30;k++){const x=M.vol[back(d,k)];if(x==null)continue;if(k<7)v7.push(x);v30.push(x);}
   const volR=(v7.length>=5&&v30.length>=20)?+(avg(v7)/avg(v30)).toFixed(3):null;
   const st=ffill(M.stab,d), st30=ffill(M.stab,back(d,30));
   const dx=ffill(M.dxy,d), dx20=ffill(M.dxy,back(d,20));
   const tg=ffill(M.tga,d), tg20=ffill(M.tga,back(d,20));
   const rr=ffill(M.rrp,d)||0, rr20=ffill(M.rrp,back(d,20))||0;
   const oiN=ffill(M.oi,d), oi5=ffill(M.oi,back(d,5));
   const p20=px.slice(Math.max(0,i-19),i+1), q20=px.slice(Math.max(0,i-39),Math.max(0,i-19));
   const hh=(q20.length<15)?null:((Math.max(...p20)>Math.max(...q20)&&Math.min(...p20)>Math.min(...q20))?1:
             (Math.max(...p20)<Math.max(...q20)&&Math.min(...p20)<Math.min(...q20))?-1:0);
   der.push([d,px[i],ma(350),ma(200),ma(100),breadth(d),volR,
     st!=null?+(st/1000).toFixed(1):null,(st&&st30)?+(((st-st30)/st30)*100).toFixed(2):null,
     dx,(dx&&dx20)?+(dx-dx20).toFixed(3):null,
     (tg&&tg20)?+(((tg+rr)-(tg20+rr20))/1000).toFixed(1):null,
     hike[d]!=null?+hike[d].toFixed(1):(hike[back(d,1)]!=null?+hike[back(d,1)].toFixed(1):null),
     ffill(M.fund,d), oiN!=null?+(oiN/1000).toFixed(2):null,
     (oiN&&oi5)?+(((oiN-oi5)/oi5)*100).toFixed(2):null,
     hh, i>=5?+(((px[i]/px[i-5])-1)*100).toFixed(3):null]);
 }
 const T=tvl.slice(-70).map(x=>[iso(x.date*1000),Math.round(x.tvl/1e9)]);
 const tnow=T.length?T[T.length-1][1]:null, t30=T.length>30?T[T.length-31][1]:null, t0=T.length?T[0][1]:null;
 const raw={asof:der[der.length-1][0],der,flows:[],
   tvl:{now:tnow,d30:(tnow&&t30)?+(((tnow-t30)/t30)*100).toFixed(1):null,
        since:(tnow&&t0)?+(((tnow-t0)/t0)*100).toFixed(1):null,
        from:T.length?T[0][0].slice(8)+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+T[0][0].slice(5,7)-1]:'',
        ethShare:57,btcShare:4.8},
   errors:errs};
 const e=v=>v===null||v===undefined?'':String(v);
 const txt='ASOF|'+raw.asof+
   '\nTVL|'+e(raw.tvl.now)+'|'+e(raw.tvl.d30)+'|'+e(raw.tvl.since)+'|'+e(raw.tvl.from)+
   '\nERRORS|'+errs.join(' ; ')+
   '\nDER\n'+der.map(r=>r.map(e).join(':')).join('\n');
 window.__TXT=txt;
 window.__SUMMARY={asof:raw.asof,sessions:der.length,len:txt.length,
   chunks:Math.ceil(txt.length/880),errors:errs,fedSlug:window.__FEDSLUG};
};
setTimeout(function(){window.__RUN().catch(function(x){window.__ERR=String(x)})},0);
'queued - poll window.__SUMMARY, then pull window.__TXT.slice(a,b) in 880-char chunks';
