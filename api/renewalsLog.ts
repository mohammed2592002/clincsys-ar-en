import type {Express} from 'express';

type Dependencies = {getAuth:(req:any)=>Promise<any>; db:{execute:(sql:any)=>Promise<{rows:any[]}>;getIsPostgres:()=>boolean}};
const parse = (value:any) => {try{return typeof value === 'string' ? JSON.parse(value) : value || {};}catch{return {};}};
const record = (row:any) => {const d=parse(row.data);return {...d,id:row.id,clinicId:d.clinicId||row.clinicId||row.clinicid||'',clinicName:d.clinicName||'',renewedAt:d.renewedAt||'',amount:Number.isFinite(Number(d.amount))?Number(d.amount):0,paymentMethod:d.paymentMethod||d.method||'cash',notes:d.notes||''};};

export function installRenewalsLog(app:Express, deps:Dependencies) {
  app.get('/api/superadmin/renewals', async(req,res)=>{
    const auth=await deps.getAuth(req);
    if(auth?.type!=='admin')return res.status(403).json({error:'forbidden'});
    const rawOffset=String(req.query.offset??'0');
    if(!/^\d{1,9}$/.test(rawOffset))return res.status(400).json({error:'invalid_offset'});
    if(typeof req.query.q!=='undefined'&&typeof req.query.q!=='string')return res.status(400).json({error:'invalid_query'});
    const q=String(req.query.q||'').trim();
    if(q.length>200)return res.status(400).json({error:'query_too_long'});
    const offset=Number(rawOffset),limit=10;
    try {
      if(deps.db.getIsPostgres()) {
        // Search is literal, including % and _, and covers the entire log.
        // The database aggregates the matching set. Only ten documents leave it.
        const where=q?" WHERE strpos(lower(COALESCE(json_extract(data, '$.clinicName'),'')), lower(?)) > 0":'';
        const args=q?[q]:[];
        const amount="COALESCE(json_extract(data, '$.amount'),'')";
        const summary=await deps.db.execute({sql:`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN ${amount} ~ '^[-]{0,1}[0-9]+([.][0-9]+){0,1}([eE][+-]{0,1}[0-9]+){0,1}$' THEN (${amount})::numeric ELSE 0 END),0) AS revenue FROM renewals${where}`,args});
        // Immutable jsonb expression so the idx_renewals_renewedat_id index serves the sort.
        const page=await deps.db.execute({sql:`SELECT id,data FROM renewals${where} ORDER BY COALESCE(data::jsonb->>'renewedAt','') DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,args});
        const total=Number(summary.rows[0]?.total||0),totalRevenue=Number(summary.rows[0]?.revenue||0);
        return res.json({items:page.rows.map(record),total,totalRevenue,offset,limit,hasMore:offset+page.rows.length<total});
      }
      // Development JSON storage has no SQL JSON aggregate support. Keep the
      // same API contract, filtering and pagination entirely on the server.
      const all=(await deps.db.execute('SELECT id,data FROM renewals')).rows.map(record)
        .filter(r=>r.clinicName.toLowerCase().includes(q.toLowerCase()))
        .sort((a,b)=>b.renewedAt.localeCompare(a.renewedAt)||b.id.localeCompare(a.id));
      const items=all.slice(offset,offset+limit);
      return res.json({items,total:all.length,totalRevenue:all.reduce((n,r)=>n+r.amount,0),offset,limit,hasMore:offset+items.length<all.length});
    } catch(err) {console.error('[Renewals Log]',err);return res.status(500).json({error:'renewals_load_failed'});}
  });
}
