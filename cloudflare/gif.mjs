import { fonts } from './font-atlas.mjs';
export const WIDTH=480, HEIGHT=168;
const background=[17,24,35];
const palette=[background,[38,50,66],[125,225,190],[11,17,26]];
for(const color of [[239,244,250],[133,151,173],[125,225,190]]) {
  for(let a=0;a<16;a++) palette.push(background.map((b,i)=>Math.round(b+(color[i]-b)*a/15)));
}
while(palette.length<64) palette.push(background);
const base=new Uint8Array(WIDTH*HEIGHT);
function rect(p,x,y,w,h,color) {
  for(let j=y;j<y+h;j++) p.fill(color,j*WIDTH+x,j*WIDTH+x+w);
}
function rounded(p,x,y,w,h,r,color) {
  for(let j=0;j<h;j++) for(let i=0;i<w;i++) {
    const dx=Math.max(r-i-0.5,i-w+r+0.5,0),dy=Math.max(r-j-0.5,j-h+r+0.5,0);
    if(dx*dx+dy*dy<=r*r) p[(y+j)*WIDTH+x+i]=color;
  }
}
base.fill(3);
rounded(base,0,0,WIDTH,HEIGHT,18,1);
rounded(base,1,1,WIDTH-2,HEIGHT-2,17,0);
rect(base,28,133,424,1,1);
rounded(base,28,28,6,6,3,2);
function width(value,font,spacing=0){return [...value].reduce((n,c)=>n+fonts[font][c].w+spacing,0)-spacing;}
function text(p,value,x,y,font,color,spacing=0,opacity=1) {
  for(const c of value) {
    const glyph=fonts[font][c];
    for(let i=0;i<glyph.r.length;i+=4) {
      const [row,col,length,a]=glyph.r.slice(i,i+4);
      p.fill(4+color*16+Math.round(a*opacity),(y+row)*WIDTH+x+col,(y+row)*WIDTH+x+col+length);
    }
    x+=glyph.w+spacing;
  }
}
const pacific=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true,timeZoneName:'short'});
const calendar=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',weekday:'short',month:'short',day:'numeric',year:'numeric'});
export function pixels(timestamp,dim=false) {
  const p=base.slice(), date=new Date(timestamp);
  const parts=Object.fromEntries(pacific.formatToParts(date).map(x=>[x.type,x.value]));
  text(p,'PACIFIC TIME',44,26,'small',1,2);
  text(p,parts.timeZoneName,WIDTH-28-width(parts.timeZoneName,'small'),26,'small',2,0);
  const main=parts.hour+':'+parts.minute+':'+parts.second;
  const total=width(main,'time')+14+width(parts.dayPeriod,'period');
  const x=Math.round((WIDTH-total)/2);
  text(p,main,x,57,'time',0,0,dim?0.3:1);
  text(p,parts.dayPeriod,x+width(main,'time')+14,95,'period',1,0,dim?0.3:1);
  const label=calendar.format(date).toUpperCase();
  text(p,label,Math.round((WIDTH-width(label,'date'))/2),144,'date',1);
  rect(p,28,133,Math.max(1,Math.round(424*Number(parts.second)/59)),1,2);
  return p;
}

// GIF LZW encoder. The encoder's dictionary is one entry ahead of the decoder.
function lzw(input) {
  const output=[];
  let bits=0, count=0, size=7, next=66, dictionary=new Map();
  function write(code) {
    bits|=code<<count; count+=size;
    while(count>=8) {output.push(bits&255);bits>>>=8;count-=8;}
  }
  write(64);
  let prefix=input[0];
  for(let i=1;i<input.length;i++) {
    const symbol=input[i], key=prefix*64+symbol;
    if(dictionary.has(key)) {prefix=dictionary.get(key);continue;}
    write(prefix);
    if(next<4096) {
      dictionary.set(key,next++);
      if(next>(1<<size) && size<12) size++;
    } else {
      write(64);dictionary=new Map();next=66;size=7;
    }
    prefix=symbol;
  }
  write(prefix);write(65);
  if(count) output.push(bits&255);
  const blocks=[6];
  for(let i=0;i<output.length;i+=255) {
    const block=output.slice(i,i+255);blocks.push(block.length,...block);
  }
  blocks.push(0);
  return blocks;
}
export const header = Uint8Array.from([
  ...new TextEncoder().encode('GIF89a'),WIDTH&255,WIDTH>>8,HEIGHT&255,HEIGHT>>8,0x85,0,0,
  ...palette.flat()
]);
export function frame(timestamp,duration=100,dim=false) {
  return Uint8Array.from([0x21,0xf9,4,4,duration&255,duration>>8,0,0,0x2c,0,0,0,0,WIDTH&255,WIDTH>>8,HEIGHT&255,HEIGHT>>8,0,...lzw(pixels(timestamp,dim))]);
}
export function gif(timestamps) {
  const parts=timestamps.flatMap(t=>[frame(t,90),frame(t,10,true)]), result=new Uint8Array(header.length+parts.reduce((n,p)=>n+p.length,0)+1);
  result.set(header);let offset=header.length;
  for(const part of parts){result.set(part,offset);offset+=part.length;}
  result[offset]=0x3b;
  return result;
}
