import type {CharacterInput,CharacterState} from './character';
export const PROTOCOL_VERSION=1;
export const INTEREST_CELL=128;
export const WORLD_HZ=30, SNAPSHOT_HZ=20, INPUT_HZ=120;
export interface PlayerState {id:string;nickname:string;state:CharacterState;ack:number}
export interface InputStep {seq:number;input:CharacterInput}
export const interestCell=(x:number,z:number)=>`${Math.floor(x/INTEREST_CELL)}:${Math.floor(z/INTEREST_CELL)}`;
export const validCell=(v:unknown):v is string=>typeof v==='string'&&/^-?\d{1,7}:-?\d{1,7}$/.test(v);
export function validInput(value:unknown):value is InputStep {
  const v=value as InputStep,i=v?.input;
  return !!v&&Number.isSafeInteger(v.seq)&&v.seq>0&&!!i&&typeof i.sprint==='boolean'&&typeof i.jump==='boolean'&&
    [i.x,i.z].every(n=>Number.isFinite(n)&&Math.abs(n)<=1.5)&&
    (i.swimVector===undefined||Array.isArray(i.swimVector)&&i.swimVector.length===3&&i.swimVector.every(n=>Number.isFinite(n)&&Math.abs(n)<=1.5));
}
/** Small, versioned binary value codec. Typed distance bricks stay packed on the wire.
 * Decoding has byte, depth and collection limits before allocating containers. */
export function encodeMessage(value:unknown):Uint8Array {
  let bytes=new Uint8Array(1024),offset=0;
  const reserve=(n:number)=>{if(offset+n>bytes.length){const b=new Uint8Array(Math.max(offset+n,bytes.length*2));b.set(bytes);bytes=b;}const p=offset;offset+=n;return p;};
  const byte=(n:number)=>{const p=reserve(1);bytes[p]=n;},u32=(n:number)=>{const p=reserve(4);new DataView(bytes.buffer).setUint32(p,n,true);};
  const write=(v:any,depth:number)=>{if(depth>40)throw new Error('Message nesting exceeded');
    if(v===undefined||v===null){byte(0);return;}if(typeof v==='boolean'){byte(v?2:1);return;}
    if(typeof v==='number'){if(!Number.isFinite(v))throw new Error('Nonfinite number');byte(3);const p=reserve(8);new DataView(bytes.buffer).setFloat64(p,v,true);return;}
    if(typeof v==='string'){byte(4);const b=new TextEncoder().encode(v);u32(b.length);{const p=reserve(b.length);bytes.set(b,p);};return;}
    if(v instanceof Int16Array){byte(7);u32(v.length);const p=reserve(v.length*2),d=new DataView(bytes.buffer);for(let i=0;i<v.length;i++)d.setInt16(p+i*2,v[i],true);return;}
    if(Array.isArray(v)){byte(5);u32(v.length);for(const item of v)write(item,depth+1);return;}
    if(typeof v==='object'){byte(6);const entries=Object.entries(v).filter(([,n])=>n!==undefined);u32(entries.length);for(const [k,n]of entries){write(k,depth+1);write(n,depth+1);}return;}
    throw new Error('Unsupported message value');};
  byte(PROTOCOL_VERSION);write(value,0);return bytes.slice(0,offset);
}
export function decodeMessage(bytes:Uint8Array,maxBytes=8*1024*1024):any {
  if(bytes.byteLength>maxBytes)throw new Error('Message too large');let offset=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const take=(n:number)=>{if(n<0||offset+n>bytes.length)throw new Error('Truncated message');const p=offset;offset+=n;return p;};
  const byte=()=>bytes[take(1)],u32=()=>view.getUint32(take(4),true);
  const read=(depth:number):any=>{if(depth>40)throw new Error('Message nesting exceeded');const tag=byte();
    if(tag===0)return null;if(tag===1)return false;if(tag===2)return true;if(tag===3){const n=view.getFloat64(take(8),true);if(!Number.isFinite(n))throw new Error('Nonfinite number');return n;}
    const size=u32();if(size>1_000_000||size>bytes.length)throw new Error('Invalid collection size');
    if(tag===4)return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset,take(size)+size));
    if(tag===7){const p=take(size*2),a=new Int16Array(size);for(let i=0;i<size;i++)a[i]=view.getInt16(p+i*2,true);return a;}
    if(tag===5){const a=[];for(let i=0;i<size;i++)a.push(read(depth+1));return a;}
    if(tag===6){const o=Object.create(null);for(let i=0;i<size;i++){const key=read(depth+1);if(typeof key!=='string'||key==='__proto__'||key==='constructor'||key==='prototype'||Object.hasOwn(o,key))throw new Error('Invalid object key');o[key]=read(depth+1);}return o;}
    throw new Error('Unknown message tag');};
  if(byte()!==PROTOCOL_VERSION)throw new Error('Protocol version mismatch');const result=read(0);if(offset!==bytes.length)throw new Error('Trailing message bytes');return result;
}
