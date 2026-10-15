export const WIDTH = 256, HEIGHT = 72;
const glyphs = {
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11110','00001','00001','01110','00001','00001','11110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','10000','11110','00001','00001','11110'],
  '6':['01110','10000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00001','01110'],
  ':':['0','1','1','0','1','1','0'], '-':['000','000','000','111','000','000','000'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'C':['01111','10000','10000','10000','10000','10000','01111'],
  ' ':['000','000','000','000','000','000','000']
};
export function pixels(timestamp) {
  const p = new Uint8Array(WIDTH * HEIGHT);
  const date = new Date(timestamp).toISOString();
  function text(value, x, y, scale, color) {
    for (const char of value) {
      const glyph = glyphs[char];
      for (let row=0; row<7; row++) for(let col=0;col<glyph[row].length;col++) {
        if(glyph[row][col]==='1') for(let dy=0;dy<scale;dy++) for(let dx=0;dx<scale;dx++) {
          p[(y+row*scale+dy)*WIDTH+x+col*scale+dx]=color;
        }
      }
      x+=(glyph[0].length+1)*scale;
    }
  }
  text(date.slice(11,19), 12, 10, 4, 1);
  text(date.slice(0,10)+' UTC',12,48,2,2);
  return p;
}

// GIF LZW encoder. The encoder's dictionary is one entry ahead of the decoder.
function lzw(input) {
  const output=[];
  let bits=0, count=0, size=3, next=6, dictionary=new Map();
  function write(code) {
    bits|=code<<count; count+=size;
    while(count>=8) {output.push(bits&255);bits>>>=8;count-=8;}
  }
  write(4);
  let prefix=input[0];
  for(let i=1;i<input.length;i++) {
    const symbol=input[i], key=prefix*4+symbol;
    if(dictionary.has(key)) {prefix=dictionary.get(key);continue;}
    write(prefix);
    if(next<4096) {
      dictionary.set(key,next++);
      if(next>(1<<size) && size<12) size++;
    } else {
      write(4);dictionary=new Map();next=6;size=3;
    }
    prefix=symbol;
  }
  write(prefix);write(5);
  if(count) output.push(bits&255);
  const blocks=[2];
  for(let i=0;i<output.length;i+=255) {
    const block=output.slice(i,i+255);blocks.push(block.length,...block);
  }
  blocks.push(0);
  return blocks;
}
export const header = Uint8Array.from([
  ...new TextEncoder().encode('GIF89a'),WIDTH&255,WIDTH>>8,HEIGHT&255,HEIGHT>>8,0x81,0,0,
  15,23,42,74,222,128,226,232,240,0,0,0
]);
export function frame(timestamp) {
  return Uint8Array.from([0x21,0xf9,4,4,100,0,0,0,0x2c,0,0,0,0,WIDTH&255,WIDTH>>8,HEIGHT&255,HEIGHT>>8,0,...lzw(pixels(timestamp))]);
}
export function gif(timestamps) {
  const parts=timestamps.map(frame), result=new Uint8Array(header.length+parts.reduce((n,p)=>n+p.length,0)+1);
  result.set(header);let offset=header.length;
  for(const part of parts){result.set(part,offset);offset+=part.length;}
  result[offset]=0x3b;
  return result;
}
