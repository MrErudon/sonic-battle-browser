import {inflateSync,deflateSync} from 'node:zlib';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
let table;const crc=b=>{table??=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});let n=0xffffffff;for(const x of b)n=table[(n^x)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
function chunk(type,data){const body=Buffer.concat([Buffer.from(type),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(body));return Buffer.concat([head,body,tail]);}
export function encodePng({width,height,rgba}){if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16777216||rgba.length!==width*height*4)throw Error('Invalid RGBA image');const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;const scan=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)scan.set(rgba.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1);return Buffer.concat([signature,chunk('IHDR',h),chunk('IDAT',deflateSync(scan,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
/** Offline PNG input only; supports non-interlaced indexed/grayscale/RGB/RGBA, without color conversion. */
export function decodePng(input){const data=Buffer.from(input);if(!data.subarray(0,8).equals(signature))throw Error('Source must be PNG');let offset=8,header,palette,alpha,ended=false,compressed=[];while(offset+12<=data.length){const size=data.readUInt32BE(offset),end=offset+size+12;if(end>data.length)throw Error('Truncated PNG');const type=data.toString('ascii',offset+4,offset+8),body=data.subarray(offset+8,offset+8+size);if(crc(data.subarray(offset+4,offset+8+size))!==data.readUInt32BE(offset+8+size))throw Error('PNG CRC mismatch');if(type==='IHDR')header=body;if(type==='PLTE')palette=body;if(type==='tRNS')alpha=body;if(type==='IDAT')compressed.push(body);if(type==='IEND'){ended=true;break;}offset=end;}if(!header||header.length!==13||!ended||!compressed.length)throw Error('Incomplete PNG');
 const width=header.readUInt32BE(0),height=header.readUInt32BE(4),depth=header[8],color=header[9],channels=({0:1,2:3,3:1,4:2,6:4})[color];
 if(width<1||height<1||width*height>16777216||!channels||header[10]||header[11]||header[12]||!([0,3].includes(color)?[1,2,4,8].includes(depth):depth===8))throw Error('Unsupported PNG dimensions/bit depth/interlace');
 const rowBytes=Math.ceil(width*channels*depth/8),bpp=Math.max(1,Math.ceil(channels*depth/8)),raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:(rowBytes+1)*height});if(raw.length!==(rowBytes+1)*height)throw Error('Invalid PNG scanline size');
 const scan=Buffer.alloc(rowBytes*height);const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(rowBytes+1)];if(filter>4)throw Error('Invalid PNG filter');for(let x=0;x<rowBytes;x++){const at=y*rowBytes+x,a=x>=bpp?scan[at-bpp]:0,b=y?scan[at-rowBytes]:0,c=y&&x>=bpp?scan[at-rowBytes-bpp]:0;scan[at]=(raw[y*(rowBytes+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 const rgba=new Uint8Array(width*height*4),mask=(1<<depth)-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const pos=y*rowBytes+Math.floor(x*channels*depth/8),out=(y*width+x)*4;let r,g,b,a=255;const sample=depth===8?scan[pos]:(scan[pos]>>(8-depth-(x*depth)%8))&mask;
  if(color===3){if(!palette||sample*3+2>=palette.length)throw Error('Invalid indexed PNG palette');[r,g,b]=palette.subarray(sample*3,sample*3+3);a=alpha?.[sample]??255;}
  else if(color===0){r=g=b=Math.round(sample*255/mask);if(alpha&&sample===alpha.readUInt16BE(0))a=0;}
  else if(color===2){[r,g,b]=scan.subarray(pos,pos+3);if(alpha&&r===alpha.readUInt16BE(0)&&g===alpha.readUInt16BE(2)&&b===alpha.readUInt16BE(4))a=0;}
  else if(color===4){r=g=b=scan[pos];a=scan[pos+1];}else [r,g,b,a]=scan.subarray(pos,pos+4);
  rgba.set([r,g,b,a],out);
 }return {width,height,rgba};
}
