'use strict';
const crypto=require('node:crypto');
function valid(loop,withHash=false){return Boolean(loop&&Number.isSafeInteger(loop.sampleRate)&&loop.sampleRate>=8000&&loop.sampleRate<=192000&&Number.isSafeInteger(loop.frames)&&loop.frames>0&&Number.isSafeInteger(loop.start)&&Number.isSafeInteger(loop.end)&&loop.start>=0&&loop.start<loop.end&&loop.end<=loop.frames&&(loop.channels===undefined||Number.isSafeInteger(loop.channels)&&loop.channels>=1&&loop.channels<=8)&&(!withHash||typeof loop.sha256==='string'&&/^[0-9a-f]{64}$/.test(loop.sha256)));}
function bind(bytes,loop){
 if(!valid(loop)||!Buffer.isBuffer(bytes)||bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('原始循环音频元数据无效');
 let pos=12,format=null,dataLength=null;
 while(pos+8<=bytes.length){const id=bytes.toString('ascii',pos,pos+4),len=bytes.readUInt32LE(pos+4);pos+=8;if(len>bytes.length-pos)throw Error('音频文件损坏');if(id==='fmt '&&len>=16)format={tag:bytes.readUInt16LE(pos),channels:bytes.readUInt16LE(pos+2),rate:bytes.readUInt32LE(pos+4),align:bytes.readUInt16LE(pos+12)};if(id==='data')dataLength=len;pos+=len+(len%2);}
 if(!format||format.tag!==1||!format.align||format.rate!==loop.sampleRate||(loop.channels!==undefined&&format.channels!==loop.channels)||dataLength===null||dataLength%format.align||dataLength/format.align!==loop.frames)throw Error('音频文件与循环元数据不匹配');
 return {...loop,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
module.exports={valid,bind};
