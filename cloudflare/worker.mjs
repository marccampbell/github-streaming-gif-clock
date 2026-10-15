import { DurableObject } from 'cloudflare:workers';
import { frame, gif, header } from './gif.mjs';

export class Clock extends DurableObject {
  async fetch(request) {
    const alarm=await this.ctx.storage.getAlarm();
    if(alarm===null) {
      await this.ctx.storage.setAlarm(Date.now()+1000);
      await this.publish();
    }
    return Response.json({now:new Date().toISOString(),lastPublished:await this.ctx.storage.get('lastPublished'),nextAlarm:await this.ctx.storage.getAlarm()});
  }
  async publish() {
    const now=Math.floor(Date.now()/1000)*1000;
    // Clock values are deterministic, so the finite R2 snapshot starts now and
    // advances for one minute. It is replaced by a fresh snapshot every second.
    const body=gif(Array.from({length:60},(_,i)=>now+i*1000));
    await this.env.CLOCK_BUCKET.put('clock.gif',body,{
      httpMetadata:{contentType:'image/gif',cacheControl:'no-store, no-cache, must-revalidate'},
      customMetadata:{generatedAt:new Date(now).toISOString()}
    });
    await this.ctx.storage.put('lastPublished',now);
  }
  async alarm() {
    // Persist the next wakeup before doing I/O. An outage cannot permanently
    // exhaust alarm retries and stop the clock. Never write a key faster than 1 Hz.
    await this.ctx.storage.setAlarm(Date.now()+1000);
    try { await this.publish(); }
    catch(error) { console.error('Clock publication failed',String(error)); }
  }
}

function clock(env) {return env.CLOCK.get(env.CLOCK.idFromName('permanent-clock'));}

export default {
  async scheduled(event,env,ctx) {
    // Watchdog: rearm if an alarm disappears. Does not depend on any viewers.
    ctx.waitUntil(clock(env).fetch('https://clock.internal/status'));
  },
  async fetch(request,env,ctx) {
    const path=new URL(request.url).pathname;
    if(request.method!=='GET' && request.method!=='HEAD') return new Response('Method not allowed',{status:405});
    if(path==='/status') return clock(env).fetch('https://clock.internal/status');
    if(path==='/clock.gif') {
      const object=await env.CLOCK_BUCKET.get('clock.gif');
      if(!object) return new Response('Clock initializing',{status:503});
      const headers=new Headers({'Content-Type':'image/gif','Cache-Control':'no-store, no-cache, must-revalidate','ETag':object.httpEtag,'X-Clock-Generated-At':object.customMetadata.generatedAt});
      return new Response(request.method==='HEAD'?null:object.body,{headers});
    }
    if(path==='/stream.gif') {
      if(request.method==='HEAD') return new Response(null,{headers:{'Content-Type':'image/gif','Cache-Control':'no-store'}});
      // Start each connection at the actual current second. Keep appending until
      // the viewer disconnects; no replay buffer and no fixed demo duration.
      let timer;
      const stream=new ReadableStream({
        start(controller) {
          controller.enqueue(header);
          const tick=()=>{
            try {
              controller.enqueue(frame(Date.now()));
              timer=setTimeout(tick,1000-Date.now()%1000);
            } catch {clearTimeout(timer);}
          };
          tick();
        },
        cancel(){clearTimeout(timer);}
      });
      return new Response(stream,{headers:{'Content-Type':'image/gif','Cache-Control':'no-store, no-cache, no-transform','X-Content-Type-Options':'nosniff'}});
    }
    if(path==='/') return new Response('<!doctype html><meta charset="utf-8"><title>Clock</title><style>body{background:#0f172a;display:grid;place-items:center;min-height:90vh}img{width:768px;max-width:100%;image-rendering:pixelated}</style><img src="/stream.gif" alt="Live UTC clock">',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    return new Response('Not found',{status:404});
  }
};
