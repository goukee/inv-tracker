/* Stock dashboard - shared browser collector. ONE copy serves every stock.
   Set window.__CFG before pasting, e.g.
     window.__CFG={stage:'A',code:'AAPL',bench:'^GSPC',peers:['GOOGL','MSFT'],cik:'0000320193'};
   Stages must run from these origins (other origins block the calls):
     A  https://query1.finance.yahoo.com/   prices, company data, peers, macro, Fed odds
     B  https://data.sec.gov/               SEC reported financials and filings
     C  https://api.nasdaq.com/             institutional holders
     D  https://www.sec.gov/                revenue mix: segment / product revenue, cost and operating profit from the
                                            inline XBRL in the last ~16 10-Q/10-K filings (US only). Optional __CFG.n (filings, default 16)
                                            and __CFG.axes (regex of dimension axes, default ProductOrService / BusinessSegments).
     G  commodity feeds, one source per run from its own site: FRED (fred.stlouisfed.org), SPDR daily file (www.spdrgoldshares.com),
        CFTC (publicreporting.cftc.gov). See the stage G block. Stage A takes __CFG.ratio=['GC=F','^GSPC'] for commodity tabs.
   Each stage runs in the background and leaves a plain-text bundle in window.__TXT.
   Poll window.__SUMMARY, then pull window.__TXT in 880-character chunks. Never base64 it. */
window.__TXT=null;window.__SUMMARY=null;window.__ERR=null;
window.__RUN=async function(){
 const C=window.__CFG, errs=[], L=[];
 const J=async(u,o)=>{const r=await fetch(u,o);if(!r.ok)throw new Error(r.status+' '+u.slice(0,80));return r.json()};
 const safe=async(n,f,fb)=>{try{return await f()}catch(e){errs.push(n+': '+e.message);return fb}};
 const iso=t=>new Date(t).toISOString().slice(0,10);
 const r2=x=>x==null||isNaN(x)?'':+(+x).toFixed(4);
 const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
 const sd=a=>{const m=avg(a);return Math.sqrt(avg(a.map(x=>(x-m)**2)))};
 const put=(k,...v)=>L.push(k+'|'+v.map(x=>x==null?'':x).join('|'));
 /* Yahoo sometimes leaves the newest daily bar's close EMPTY for hours after the US close (seen 1-2 Oct 2026 for every US stock and
    ETF, while indices were filled). The official closing price is then in meta.regularMarketPrice, stamped at the close.
    Use it ONLY when that stamp is on the bar's own date and at or after the end of the regular session (market closed);
    never during trading hours. Recorded as FILLED|symbol|date|price so the report can say so. History self-corrects on the
    next run once Yahoo fills the bar in. */
 const fillLast=(s,r,q,mk)=>{const m=r.meta||{},T=r.timestamp||[],n=T.length-1;if(n<0||q.close[n]!=null)return null;
   const end=m.currentTradingPeriod?.regular?.end, t=m.regularMarketTime, px=m.regularMarketPrice;
   if(px==null||!t||!end||t<end||iso(t*1000)!==iso(T[n]*1000))return null;
   put('FILLED',s,iso(T[n]*1000),px);return mk(iso(T[n]*1000),px,q.volume?.[n]||m.regularMarketVolume||0)};

 if(C.stage==='A'){
  const chart=async(s,range,iv)=>{const j=await J(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${range}&interval=${iv}`);
    const r=j.chart.result[0],q=r.indicators.quote[0],a=r.indicators.adjclose?.[0]?.adjclose||q.close;const out=[];
    r.timestamp.forEach((t,i)=>{if(q.close[i]!=null)out.push({d:iso(t*1000),c:q.close[i],a:a[i]??q.close[i],v:q.volume?.[i]||0})});
    if(iv==='1d'){const f=fillLast(s,r,q,(d,c,v)=>({d,c,a:c,v}));if(f)out.push(f)}return out};
  const crumb=await safe('crumb',async()=>(await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb',{credentials:'include'})).text(),'');
  const QS=async(s,m)=>(await J(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(s)}?modules=${m}&crumb=${encodeURIComponent(crumb)}`,{credentials:'include'})).quoteSummary.result[0];

  /* --- the stock: 2 years daily --- */
  const P=await chart(C.code,'2y','1d'); const n=P.length-1, c=P.map(x=>x.c), a=P.map(x=>x.a);
  const N=P.length, ma=k=>N>=k?avg(c.slice(n-k+1,n+1)):null;
  put('ASOF',P[n].d); put('PX',r2(c[n]),r2(ma(50)),r2(ma(200)));
  /* new-listing support: trading days available (2-year request), first date, average of every close, 20-day average */
  put('LISTING',P[0].d,N,r2(avg(c)),r2(ma(20)));
  if(N>=40){const hi20=Math.max(...c.slice(n-19)),lo20=Math.min(...c.slice(n-19)),hi40=Math.max(...c.slice(n-39,n-19)),lo40=Math.min(...c.slice(n-39,n-19));
  put('HHLL',hi20>hi40&&lo20>lo40?1:(hi20<hi40&&lo20<lo40?-1:0));} else put('HHLL','');
  let up=0,dn=0;for(let k=Math.max(1,n-19);k<=n;k++){if(c[k]>c[k-1])up+=P[k].v;else if(c[k]<c[k-1])dn+=P[k].v}
  put('LQ1',dn?r2(up/dn):'');
  const ret=k=>n-k>=0?a[n]/a[n-k]-1:null;
  const dr=[];for(let k=Math.max(1,n-59);k<=n;k++)dr.push(a[k]/a[k-1]-1);
  put('MOVE',r2(ret(1)),r2(ret(5)),r2(ret(63)),r2(sd(dr)));
  const Y=P.slice(-252);put('CLOSE1Y',Y[0].d,Y[Y.length-1].d,Y.map(x=>Math.round(x.c*10)).join(','));  /* closes x10, no dates: digit-only date runs get filtered in transit */

  /* --- benchmark and beta (1 year daily) --- */
  const B=await chart(C.bench,'2y','1d'); const bm=Object.fromEntries(B.map(x=>[x.d,x.a]));
  const pairs=[];for(let k=Math.max(1,n-251);k<=n;k++){const d0=P[k-1].d,d1=P[k].d;if(bm[d0]&&bm[d1])pairs.push([a[k]/a[k-1]-1,bm[d1]/bm[d0]-1])}
  const mx=avg(pairs.map(p=>p[1])),my=avg(pairs.map(p=>p[0]));
  const beta=pairs.length>=60?pairs.reduce((s,p)=>s+(p[1]-mx)*(p[0]-my),0)/pairs.reduce((s,p)=>s+(p[1]-mx)**2,0):null;  /* needs 60+ days */
  const bn=B.length-1, bret=k=>B[bn].a/B[bn-k].a-1;
  put('BENCH',C.bench,r2(bret(1)),r2(bret(5)),r2(bret(63)),r2(beta),B[bn].d,pairs.length);

  /* --- peers: price moves and valuation --- */
  for(const p of C.peers){
   await safe('peer '+p,async()=>{
    const X=await chart(p,'6mo','1d'); const m=X.length-1, pr=k=>X[m].a/X[m-k].a-1;
    const q=await QS(p,'summaryDetail,defaultKeyStatistics,financialData,price,earningsTrend');
    put('PEER',p,r2(pr(1)),r2(pr(5)),r2(pr(63)),r2(q.summaryDetail?.forwardPE?.raw),r2(q.summaryDetail?.trailingPE?.raw),
        r2(q.defaultKeyStatistics?.pegRatio?.raw),r2(q.defaultKeyStatistics?.enterpriseToEbitda?.raw),
        r2(q.financialData?.revenueGrowth?.raw),r2(q.financialData?.grossMargins?.raw),X[m].d,(q.price?.shortName||'').replace(/\|/g,' '));
    /* next-12-month forward P/E inputs (plan v0.5, D29): this and next fiscal year's consensus EPS, blended by the engine */
    {const t=q.earningsTrend?.trend||[],g=k=>t.find(x=>x.period===k)||{};put('PEEREST',p,r2(X[m].c),g('0y').endDate||'',r2(g('0y').earningsEstimate?.avg?.raw),g('+1y').endDate||'',r2(g('+1y').earningsEstimate?.avg?.raw),q.price?.currency||'')}
   },null);
  }

  /* --- the stock: company data --- */
  await safe('quoteSummary',async()=>{
   const q=await QS(C.code,'summaryDetail,defaultKeyStatistics,financialData,price,earningsTrend,calendarEvents,earningsHistory,insiderTransactions');
   const k=q.defaultKeyStatistics||{}, s=q.summaryDetail||{}, f=q.financialData||{};
   put('NAME',(q.price?.longName||q.price?.shortName||'').replace(/\|/g,' '),q.price?.currency||'',r2(q.price?.marketCap?.raw));
   put('VAL',r2(s.forwardPE?.raw),r2(s.trailingPE?.raw),r2(k.pegRatio?.raw),r2(k.enterpriseToEbitda?.raw));
   put('SHORT',k.sharesShort?.raw,k.sharesShortPriorMonth?.raw,r2(k.shortPercentOfFloat?.raw),k.dateShortInterest?.fmt||'');
   put('FIN',r2(f.revenueGrowth?.raw),r2(f.grossMargins?.raw),f.freeCashflow?.raw,f.operatingCashflow?.raw);
   /* balance sheet for the engine's own EV (market value + debt - cash): Yahoo's EV can be wrong (SPCX, Sep 2026) */
   put('BAL',f.totalDebt?.raw??'',f.totalCash?.raw??'',f.ebitda?.raw??'',k.enterpriseValue?.raw??'');
   for(const t of (q.earningsTrend?.trend||[])) if(['0q','+1q','0y','+1y'].includes(t.period))
     put('EST',t.period,t.endDate||'',r2(t.earningsEstimate?.avg?.raw),r2(t.epsTrend?.current?.raw),r2(t.epsTrend?.['90daysAgo']?.raw),r2(t.revenueEstimate?.growth?.raw));
   const ce=q.calendarEvents?.earnings||{};
   put('NEXTEARN',(ce.earningsDate||[]).map(x=>x.fmt).join(','),ce.isEarningsDateEstimate?1:0);
   for(const h of (q.earningsHistory?.history||[])) put('EHIST',h.quarter?.fmt||'',r2(h.epsActual?.raw),r2(h.epsEstimate?.raw),r2(h.surprisePercent?.raw));
   const cut=Date.now()/1000-183*86400, ag={};
   for(const t of (q.insiderTransactions?.transactions||[])){ if(!(t.startDate?.raw>cut))continue;
     const typ=/^Sale/.test(t.transactionText||'')?'S':(/^Purchase/.test(t.transactionText||'')?'B':'O');
     const nm=t.filerName; ag[nm]=ag[nm]||{rel:t.filerRelation,B:0,S:0,SV:0,BV:0};
     ag[nm][typ]=(ag[nm][typ]||0)+(t.shares?.raw||0); if(typ==='S')ag[nm].SV+=t.value?.raw||0; if(typ==='B')ag[nm].BV+=t.value?.raw||0;}
   for(const [nm,x] of Object.entries(ag)) put('INSIDER',nm,x.rel,x.B,Math.round(x.BV),x.S,Math.round(x.SV));
  },null);

  /* --- 5 years weekly closes (for P/E vs own history) --- */
  await safe('weekly',async()=>{const W=await chart(C.code,'6y','1wk');put('WEEKLY',W[0].d,W.map(x=>Math.round(x.c*10)).join(','))  /* weekly closes x10; weeks are 7 days apart except the last */},null);
  /* commodity tabs (plan v0.6, G-VL2): __CFG.ratio=['GC=F','^GSPC'] -> this week's ratio vs the median of the previous 520 weeks */
  if(C.ratio) await safe('ratio',async()=>{const [X,Y]=await Promise.all(C.ratio.map(s=>chart(s,'11y','1wk')));const ym=Object.fromEntries(Y.map(x=>[x.d,x.c]));
    const R=X.filter(x=>ym[x.d]).map(x=>({d:x.d,g:x.c,s:ym[x.d],r:x.c/ym[x.d]}));const last=R[R.length-1],H=R.slice(-521,-1),srt=H.map(x=>x.r).sort((a,b)=>a-b);
    const md=srt.length%2?srt[(srt.length-1)/2]:(srt[srt.length/2-1]+srt[srt.length/2])/2;
    put('RATIO',last.d,+last.g.toFixed(1),+last.s.toFixed(2),+last.r.toFixed(4),+md.toFixed(4),H[0].d,H[H.length-1].d,H.length)},null);

  /* --- shared macro: dollar, 10-year yield, yuan, memory proxy, Fed odds --- */
  for(const [key,sym] of [['DXY','DX-Y.NYB'],['TNX','^TNX'],['CNY','CNY=X'],['MU','MU'],...(C.extraMacro||[])]){
   await safe('macro '+key,async()=>{const X=await chart(sym,'3mo','1d');const m=X.length-1;
     put('MACRO',key,sym,r2(X[m].c),r2(X[Math.max(0,m-20)].c),r2(X[Math.max(0,m-21)]?.c),X[m].d)},null);
  }
  await safe('fedodds',async()=>{
   const ev=await J('https://gamma-api.polymarket.com/events?closed=false&limit=60&tag_slug=fed-rates&order=volume&ascending=false');
   const e=ev.filter(x=>/^fed-decision-in-/.test(x.slug)&&new Date(x.endDate)>new Date()).sort((x,y)=>new Date(x.endDate)-new Date(y.endDate))[0];
   if(!e){errs.push('fedodds: no upcoming event');return}
   let cutN=0,hikeN=0,cutT=0,hikeT=0;const then=Date.now()/1000-28*86400;
   for(const m of (e.markets||[])){ const t=m.groupItemTitle||m.question||''; const isC=/decrease|cut/i.test(t), isH=/increase|hike/i.test(t); if(!isC&&!isH)continue;
     const p=JSON.parse(m.outcomePrices||'[0]')[0]*100; const ids=JSON.parse(m.clobTokenIds||'[]');
     let pt=null; if(ids[0]){const h=await J('https://clob.polymarket.com/prices-history?market='+ids[0]+'&interval=max&fidelity=1440');
       const hs=(h.history||[]).filter(x=>x.t<=then); if(hs.length) pt=hs[hs.length-1].p*100;}
     if(isC){cutN+=p;cutT+=pt||0}else{hikeN+=p;hikeT+=pt||0}}
   put('FED',e.slug,r2(cutN),r2(hikeN),r2(cutT),r2(hikeT),iso(e.endDate));
  },null);
 }

 if(C.stage==='M'){
  /* Shared macro, ONCE per refresh for every tab (plan v0.5): values at the close of __CFG.asof (YYYY-MM-DD) and 20 / 21 trading
     days earlier; Fed odds at 21:00 UTC on asof and 28 days earlier. Run from https://query1.finance.yahoo.com/. Output feeds
     refresh_stock.py --macro-in (as macro.json). Extra symbols: __CFG.extraMacro=[['ITA','ITA']]. */
  const chart=async(s,range)=>{const j=await J(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${range}&interval=1d`);
    const r=j.chart.result[0],q=r.indicators.quote[0];const out=[];r.timestamp.forEach((t,i)=>{if(q.close[i]!=null)out.push({d:iso(t*1000),c:q.close[i]})});
    const f=fillLast(s,r,q,(d,c)=>({d,c}));if(f)out.push(f);return out};
  for(const [key,sym] of [['DXY','DX-Y.NYB'],['TNX','^TNX'],['CNY','CNY=X'],['MU','MU'],...(C.extraMacro||[])]){
   await safe('macro '+key,async()=>{const X=(await chart(sym,'6mo')).filter(x=>x.d<=C.asof);const m=X.length-1;
     put('MACRO',key,sym,r2(X[m].c),r2(X[Math.max(0,m-20)].c),r2(X[Math.max(0,m-21)].c),X[m].d)},null);
  }
  await safe('fedodds',async()=>{
   const at=Date.parse(C.asof+'T21:00:00Z')/1000, then=at-28*86400;
   const ev=await J('https://gamma-api.polymarket.com/events?closed=false&limit=60&tag_slug=fed-rates&order=volume&ascending=false');
   const e=ev.filter(x=>/^fed-decision-in-/.test(x.slug)&&Date.parse(x.endDate)/1000>at).sort((x,y)=>new Date(x.endDate)-new Date(y.endDate))[0];
   if(!e){errs.push('fedodds: no upcoming event');return}
   let cN=0,hN=0,cT=0,hT=0;
   for(const m of (e.markets||[])){const t=m.groupItemTitle||m.question||'';const isC=/decrease|cut/i.test(t),isH=/increase|hike/i.test(t);if(!isC&&!isH)continue;
     const ids=JSON.parse(m.clobTokenIds||'[]');if(!ids[0])continue;const h=await J('https://clob.polymarket.com/prices-history?market='+ids[0]+'&interval=max&fidelity=60');
     const pAt=x=>{const hs=(h.history||[]).filter(y=>y.t<=x);return hs.length?hs[hs.length-1].p*100:0};
     if(isC){cN+=pAt(at);cT+=pAt(then)}else{hN+=pAt(at);hT+=pAt(then)}}
   put('FED',e.slug,r2(cN),r2(hN),r2(cT),r2(hT),iso(e.endDate),(e.title||'').replace(/\|/g,' '));
  },null);
 }

 if(C.stage==='B'){
  const cik=C.cik;
  const concept=async(tag,unit)=>{const j=await J(`/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`);return j.units[unit||Object.keys(j.units)[0]]};
  const dur=(s,e)=>(new Date(e)-new Date(s))/864e5;
  const quarterly=async(tag,unit)=>{const u=await concept(tag,unit);const q={},fy={};
   for(const x of u){if(!x.start)continue;const d=dur(x.start,x.end);
    if(d>80&&d<100&&(!q[x.end]||x.filed<q[x.end].filed))q[x.end]={v:x.val,filed:x.filed,start:x.start};
    if(d>350&&d<380&&(!fy[x.end]||x.filed<fy[x.end].filed))fy[x.end]={v:x.val,filed:x.filed,start:x.start};}
   for(const [e,f] of Object.entries(fy)){if(q[e])continue;const ins=Object.entries(q).filter(([k,v])=>v.start>=f.start&&k<e);
    if(ins.length===3)q[e]={v:f.v-ins.reduce((s,[k,v])=>s+v.v,0),filed:f.filed}}
   return {q,fy}};
  const R=await safe('rev',()=>quarterly(C.revTag||'RevenueFromContractWithCustomerExcludingAssessedTax'),{q:{},fy:{}});
  const G=await safe('gp',()=>quarterly('GrossProfit'),{q:{},fy:{}});
  const E=await safe('eps',()=>quarterly('EarningsPerShareDiluted','USD/shares'),{q:{},fy:{}});
  const ends=Object.keys(R.q).sort().slice(-28);
  for(const e of ends) put('Q',e,R.q[e].filed,Math.round(R.q[e].v/1e6),G.q[e]?Math.round(G.q[e].v/1e6):'',E.q[e]?+E.q[e].v.toFixed(3):'');  /* $m */
  const OCF=await safe('ocf',()=>quarterly('NetCashProvidedByUsedInOperatingActivities'),{q:{},fy:{}});
  const NI=await safe('ni',()=>quarterly('NetIncomeLoss'),{q:{},fy:{}});
  for(const e of Object.keys(OCF.fy).sort().slice(-3)) put('FY',e,Math.round(OCF.fy[e].v/1e6),NI.fy[e]?Math.round(NI.fy[e].v/1e6):'',R.fy[e]?Math.round(R.fy[e].v/1e6):'');
  await safe('ar',async()=>{const u=await concept('AccountsReceivableNetCurrent','USD');const m={};
    for(const x of u){if(!m[x.end]||x.filed<m[x.end].filed)m[x.end]={v:x.val,filed:x.filed}}
    for(const e of Object.keys(m).sort().slice(-6)) put('AR',e,Math.round(m[e].v/1e6))},null);
  /* Cash-flow and interest periods, raw (plan v0.5, quality & cash): every reported period of the last ~6 years, latest filing wins.
     10-Q cash-flow statements are year-to-date, so the engine turns them into quarters. CFP|start|end|operating cash|capex|filed ($m)
     INTP|start|end|operating income|interest expense|filed ($m). Capex / interest fall back through the tags listed. */
  const periods=async(tags,unit)=>{const m={},used=[];for(const t of tags){try{const u=await concept(t,unit);const mt={};
      for(const x of u){if(!x.start||x.end<iso(Date.now()-2300*864e5))continue;const k=x.start+'|'+x.end;if(!mt[k]||x.filed>mt[k].filed)mt[k]={v:x.val,filed:x.filed}}
      let n=0;for(const k in mt)if(!m[k]){m[k]=mt[k];n++}if(n)used.push(t)}catch(e){}}return {tag:used.join('+'),m}};  /* tags merged: first tag with a value for a period wins */
  await safe('cashflow',async()=>{
    const O=await periods(['NetCashProvidedByUsedInOperatingActivitiesContinuingOperations','NetCashProvidedByUsedInOperatingActivities'],'USD')  /* continuing operations first: a sold business's cash is not the company's (AMD 2025) */;
    const X=await periods(['PaymentsToAcquirePropertyPlantAndEquipment','PaymentsToAcquireProductiveAssets','PaymentsForCapitalImprovements'],'USD');
    for(const k of Object.keys(O.m).sort()){const [a,b]=k.split('|');put('CFP',a,b,Math.round(O.m[k].v/1e5)/10,X.m[k]?Math.round(X.m[k].v/1e5)/10:'',O.m[k].filed)}
    put('CFTAGS',O.tag||'',X.tag||'')},null);
  await safe('interest',async()=>{
    const OI=await periods(['OperatingIncomeLoss'],'USD');
    const IE=await periods(['InterestExpense','InterestExpenseNonoperating','InterestExpenseDebt','InterestAndDebtExpense'],'USD');
    for(const k of Object.keys(OI.m).sort()){const [a,b]=k.split('|');put('INTP',a,b,Math.round(OI.m[k].v/1e5)/10,IE.m[k]?Math.round(IE.m[k].v/1e5)/10:'',OI.m[k].filed)}
    put('INTTAGS',OI.tag||'',IE.tag||'')},null);
  await safe('filings',async()=>{const s=await J(`/submissions/CIK${cik}.json`);const f=s.filings.recent;const cut=iso(Date.now()-730*864e5);
    let a401=0;f.form.forEach((x,i)=>{if(x==='8-K'&&f.filingDate[i]>=cut&&/4\.01/.test(f.items[i]||''))a401++});
    put('AUDITCHG',a401);
    const last=f.form.map((x,i)=>[x,f.filingDate[i]]).filter(x=>['10-Q','10-K'].includes(x[0]))[0];put('LASTREPORT',...(last||[]))},null);
 }

 if(C.stage==='C'){
  const j=await J(`https://api.nasdaq.com/api/company/${C.code}/institutional-holdings?limit=40&type=TOTAL&sortColumn=marketValue&sortOrder=DESC`);
  const d=j.data, os=d.ownershipSummary||{};
  put('INSTSUM',(os.SharesOutstandingPCT?.value||'').replace('%',''),(os.ShareoutstandingTotal?.value||'').replace(/,/g,''));
  for(const r of (d.activePositions?.rows||[])) put('ACTIVE',r.positions,(r.holders||'').replace(/,/g,''),(r.shares||'').replace(/,/g,''));
  for(const r of (d.holdingsTransactions?.table?.rows||[])) put('HOLDER',(r.ownerName||'').replace(/\|/g,' '),r.date,(r.sharesHeld||'').replace(/,/g,''),(r.sharesChange||'').replace(/,/g,''),(r.sharesChangePCT||'').replace('%',''));
 }


 if(C.stage==='D'){
  /* Revenue mix from SEC inline XBRL. One line per concept+member(~printed row label): SEG|REV/COST/GP/OI|member~label|v1,v2,... ($m, one value per quarter
     in SEGQ order, blank if missing). SEGFY lines carry full-year values; the engine derives quarter 4. Newest filing wins
     (so restated / re-drawn segments use the latest figures). */
  const cik=C.cik.replace(/^0+/,''), n=C.n||16, AX=new RegExp(C.axes||'ProductOrServiceAxis|StatementBusinessSegmentsAxis');
  const CONC=/^us-gaap:(RevenueFromContractWithCustomerExcludingAssessedTax|Revenues|CostOfGoodsAndServicesSold|CostOfRevenue|GrossProfit|OperatingIncomeLoss)$/;
  const sub=await J(`https://data.sec.gov/submissions/CIK${C.cik}.json`); const f=sub.filings.recent;
  const F=f.form.map((x,i)=>[x,f.accessionNumber[i],f.primaryDocument[i]]).filter(x=>x[0]==='10-Q'||x[0]==='10-K').slice(0,n);
  const facts={};
  for(const [form,acc,doc] of F){ await safe('filing '+doc,async()=>{
   const t=await (await fetch(`/Archives/edgar/data/${cik}/${acc.replace(/-/g,'')}/${doc}`)).text();
   const d=new DOMParser().parseFromString(t,'text/html'); const ctx={};
   for(const c of d.getElementsByTagName('xbrli:context')){const s0=c.getElementsByTagName('xbrli:startDate')[0]?.textContent,e0=c.getElementsByTagName('xbrli:endDate')[0]?.textContent;
     const mem=[...c.getElementsByTagName('xbrldi:explicitMember')].map(m=>[m.getAttribute('dimension'),m.textContent.split(':').pop()]);ctx[c.getAttribute('id')]={s:s0,e:e0,mem}}
   for(const x of d.getElementsByTagName('ix:nonFraction')){const nm=x.getAttribute('name');if(!CONC.test(nm))continue;const c=ctx[x.getAttribute('contextRef')];if(!c||!c.s)continue;
     /* Newer filings (segment-reporting rule ASU 2023-07) add ConsolidationItemsAxis=OperatingSegmentsMember next to the segment:
        drop that neutral tag. A product-inside-segment context (ProductOrService + segment, e.g. AMD Gaming inside Client & Gaming)
        is keyed by the product member, so it lines up with older filings where that product was its own segment. */
     const mm=c.mem.filter(m=>!(/ConsolidationItemsAxis/.test(m[0])&&/^OperatingSegmentsMember$/.test(m[1])));
     if(mm.some(m=>!AX.test(m[0]))||mm.length>2)continue;
     const pick=mm.length===2?(mm.find(m=>/ProductOrServiceAxis/.test(m[0]))||null):mm[0]||['','Total']; if(!pick)continue;
     const days=(new Date(c.e)-new Date(c.s))/864e5, kind=days>350&&days<380?'FY':days>80&&days<100?'Q':days>170&&days<190?'H':null; if(!kind)continue;
     const v=+x.textContent.replace(/,/g,'')*Math.pow(10,+(x.getAttribute('scale')||0))*(x.getAttribute('sign')==='-'?-1:1);
     /* Row label as printed in the filing's table. Filers sometimes attach the wrong member tag (AMD 2023 filings tag the
        Data Center row as ClientMember), so the printed label is kept too and the engine matches segments on it first. */
     const tr=pick[1]==='Total'?null:x.closest('tr'), lab=tr?(tr.querySelector('td')?.textContent||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z ]/g,' ').replace(/\b(segment|segments|net|revenue|revenues|sales|total)\b/g,' ').replace(/\s+/g,' ').trim().slice(0,30):'';
     const cn={RevenueFromContractWithCustomerExcludingAssessedTax:'REV',Revenues:'REV',CostOfGoodsAndServicesSold:'COST',CostOfRevenue:'COST',GrossProfit:'GP',OperatingIncomeLoss:'OI'}[nm.split(':')[1]];
     const k=[cn,pick[1].replace(/Member$/,'')+(lab?'~'+lab:''),c.e,kind].join('|'); if(!(k in facts))facts[k]={v,s:c.s}}
  },null)}
  /* Raw output: quarterly values (SEG) and full-year values (SEGFY). The engine merges keys by printed label and derives
     each fourth quarter as full year minus the three quarters inside it, so a label spread over several member tags still works. */
  const series={};
  for(const k of Object.keys(facts)){const [cn,m,e,kind]=k.split('|');(series[cn+'|'+m]=series[cn+'|'+m]||{Q:{},FY:{},H:{}})[kind][e]=facts[k]}
  /* half-year minus its second quarter = its first quarter (for new listings whose first 10-Q holds only a 6-month and a 3-month figure) */
  for(const sr of Object.values(series))for(const [e,h] of Object.entries(sr.H)){const q=sr.Q[e];if(!q||!q.s)continue;
    const pe=new Date(new Date(q.s)-864e5).toISOString().slice(0,10);if(!sr.Q[pe])sr.Q[pe]={v:h.v-q.v,s:h.s,derived:1}}
  const ends=new Set();for(const sr of Object.values(series)){for(const e in sr.Q)ends.add(e);for(const e in sr.FY)ends.add(e)}
  const E=[...ends].sort().slice(-20);   // 20 ends: the engine needs the three quarters before the oldest full year to derive its quarter 4
  put('SEGQ',E.join(','));
  for(const [key,sr] of Object.entries(series)){const vals=E.map(e=>sr.Q[e]?Math.round(sr.Q[e].v/1e6):'');
    const fy=Object.entries(sr.FY).filter(([e])=>e>=E[0]).map(([e,o])=>e+':'+Math.round(o.v/1e6));
    if(vals.filter(x=>x!=='').length+fy.length<2)continue;put('SEG',...key.split('|'),vals.join(','));if(fy.length)put('SEGFY',...key.split('|'),fy.join(' '))}
  put('SEGSRC',F.length+' filings',F[F.length-1]?.[1]||'',F[0]?.[1]||'');
 }


 if(C.stage==='G'){
  /* Commodity feeds (plan v0.6; GLD first). One source per run, each from its own site (other origins block the calls):
       __CFG={stage:'G',src:'fred',series:['DFII10','T10YIE']}   from https://fred.stlouisfed.org/
       __CFG={stage:'G',src:'spdr',product:'gld'}                   from https://www.spdrgoldshares.com/usa/gld/
       __CFG={stage:'G',src:'cftc',market:'088691'}                 from https://publicreporting.cftc.gov/
     Join the three outputs (any order) into rawG.txt; refresh_stock.py --graw rawG.txt. */
  if(C.src==='fred') for(const id of (C.series||['DFII10','T10YIE'])) await safe('fred '+id,async()=>{
    const r=await fetch(`/graph/fredgraph.csv?id=${id}`);if(!r.ok)throw new Error(r.status);
    const rows=(await r.text()).trim().split('\n').slice(1).map(l=>l.split(',')).filter(x=>x[1]&&x[1]!=='.'&&!isNaN(+x[1]));
    const n=rows.length-1;if(n<21)throw new Error('too few rows');
    put('FRED',id,rows[n][0],+rows[n][1],rows[n-20][0],+rows[n-20][1],rows[n-1][0],+rows[n-1][1])},null);   /* 20 observations earlier */
  if(C.src==='spdr') await safe('spdr',async()=>{
    if(!window.XLSX) await new Promise((ok,no)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';s.onload=ok;s.onerror=()=>no(new Error('SheetJS did not load'));document.head.appendChild(s)});
    const r=await fetch(`https://api.spdrgoldshares.com/api/v1/historical-archive?product=${C.product||'gld'}&exchange=NYSE&lang=en`);if(!r.ok)throw new Error(r.status);
    const wb=XLSX.read(await r.arrayBuffer(),{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[1]],{header:1,raw:false});
    const M={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const f=v=>+String(v).replace(/[$,]/g,'');
    const D=rows.filter(x=>/^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(x[0]||'')&&x[9]&&!isNaN(f(x[9]))).map(x=>{const [d,m,y]=x[0].split('-');return {d:`${y}-${M[m]}-${d.padStart(2,'0')}`,t:f(x[9]),pr:f(x[6]),oz:f(x[2]),nav:f(x[10])}});
    const n=D.length-1;if(n<61)throw new Error('too few rows');const S=D.slice(-260);
    /* SPDR|date|tonnes|prev date|prev|date 20 days earlier|tonnes|date 60 days earlier|tonnes|premium %|oz per share|trust value $|series start|tonnes x10 (last 260 days) */
    put('SPDR',D[n].d,D[n].t,D[n-1].d,D[n-1].t,D[n-20].d,D[n-20].t,D[n-60].d,D[n-60].t,D[n].pr,D[n].oz,Math.round(D[n].nav),S[0].d,S.map(x=>Math.round(x.t*10)).join(','))},null);
  if(C.src==='cftc') await safe('cftc',async()=>{
    const q=`https://publicreporting.cftc.gov/resource/72hh-3qpy.json?cftc_contract_market_code=${C.market||'088691'}&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=170&$select=report_date_as_yyyy_mm_dd,m_money_positions_long_all,m_money_positions_short_all,open_interest_all`;
    const r=await fetch(q);if(!r.ok)throw new Error(r.status);const J=(await r.json()).reverse();
    const P=J.map(x=>({d:x.report_date_as_yyyy_mm_dd.slice(0,10),v:(x.m_money_positions_long_all-x.m_money_positions_short_all)/x.open_interest_all*100}));
    const n=P.length-1,H=P.slice(-156),cur=P[n].v,pc=H.filter(x=>x.v<cur).length/H.length*100;   /* percentile: share of the last 156 weekly reports (3 years, this week included) below this week's level */
    const vs=H.map(x=>x.v);
    /* CFTC|report|net long % of open interest|percentile (3y)|prev report|value|4 weeks earlier|value|3y max|3y min */
    put('CFTC',P[n].d,+cur.toFixed(2),+pc.toFixed(1),P[n-1].d,+P[n-1].v.toFixed(2),P[n-4].d,+P[n-4].v.toFixed(2),+Math.max(...vs).toFixed(1),+Math.min(...vs).toFixed(1))},null);
 }
 put('ERRORS',errs.join(' ; '));
 const txt=L.join('\n'); window.__TXT=txt;
 window.__SUMMARY={stage:C.stage,code:C.code,lines:L.length,len:txt.length,chunks:Math.ceil(txt.length/880),errors:errs};
};
setTimeout(function(){window.__RUN().catch(function(x){window.__ERR=String(x)})},0);
'queued - poll window.__SUMMARY, then pull window.__TXT.slice(a,b) in 880-char chunks';
