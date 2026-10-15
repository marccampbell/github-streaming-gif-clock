import { DurableObject } from 'cloudflare:workers';
import { frame, gif, header } from './gif.mjs';

export class Clock extends DurableObject {
  async fetch(request) {
    const alarm=await this.ctx.storage.getAlarm();
    if(alarm===null) {
      await this.ctx.storage.setAlarm(Date.now()+1000);
      await this.publish();
    }
    return Response.json({now:new Date().toISOString(),lastPublished:await this.ctx.storage.get('lastPublished'),nextAlarm:await this.ctx.storage.getAlarm(),githubUpdatesEnabled:Boolean(this.env.GITHUB_TOKEN),lastCommentUpdate:await this.ctx.storage.get('lastCommentUpdate'),lastError:await this.ctx.storage.get('lastError'),clockRevision:'secret-enabled-v1'});
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
    catch(error) {
      await this.ctx.storage.put('lastError',{at:Date.now(),message:String(error)});
      console.error('Clock publication failed',String(error));
    }
  }
}

function clock(env) {return env.CLOCK.get(env.CLOCK.idFromName('permanent-clock'));}

async function updateComment(env) {
  if(!env.GITHUB_TOKEN) return;
  const previous=await env.CLOCK_BUCKET.get('comment-status.json');
  const status=previous?await previous.json():{};
  const now=Date.now();
  if(now<(status.nextAttempt??0)) return;
  const image=`${env.PUBLIC_R2_URL}/clock.gif?v=${Math.floor(now/1000)}`;
  const response=await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues/comments/${env.GITHUB_COMMENT_ID}`,{
    method:'PATCH',
    headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,'User-Agent':'github-gif-clock','Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
    // Reserve the GIF's space before its new cache URL finishes loading.
    body:JSON.stringify({body:`<img src="${image}" width="256" height="72" alt="Clock">`})
  });
  const responseText=await response.text();
  let payload;
  try {payload=JSON.parse(responseText);}
  catch {payload={message:responseText.slice(0,200).replace(/github_pat_[A-Za-z0-9_]+/g,'[redacted]')};}
  const next=response.ok
    ?{lastCommentUpdate:now,nextAttempt:now+9000}
    :{...status,lastError:`GitHub returned ${response.status}: ${payload.message}`,requiredPermissions:response.headers.get('x-accepted-github-permissions'),nextAttempt:now+Math.max(60000,Number(response.headers.get('retry-after')??0)*1000)};
  await env.CLOCK_BUCKET.put('comment-status.json',JSON.stringify(next),{httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});
}

export default {
  async scheduled(event,env,ctx) {
    // Watchdog: rearm if an alarm disappears. Does not depend on any viewers.
    await clock(env).fetch('https://clock.internal/status');
    // Each scheduled invocation is bounded; Cloudflare starts a new one each minute.
    const started=Date.now();
    for(let i=0;i<6;i++) {
      const delay=started+i*10000-Date.now();
      if(delay>0) await new Promise(resolve=>setTimeout(resolve,delay));
      await updateComment(env);
    }
  },
  async fetch(request,env,ctx) {
    const path=new URL(request.url).pathname;
    if(request.method!=='GET' && request.method!=='HEAD') return new Response('Method not allowed',{status:405});
    if(path==='/status') {
      const response=await clock(env).fetch('https://clock.internal/status');
      const status=await response.json();
      const comment=await env.CLOCK_BUCKET.get('comment-status.json');
      return Response.json({...status,commentUpdater:comment?await comment.json():null,workerGithubUpdatesEnabled:Boolean(env.GITHUB_TOKEN),workerRevision:'scheduled-comment-v1'},{headers:{'Cache-Control':'no-store'}});
    }
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
