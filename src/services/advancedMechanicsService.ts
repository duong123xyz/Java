import { LoadedJarSession } from '../types/jar';
import { parseClassFile } from './classFileParser';
import { getGameMechanicsDraft } from './gameMechanicsService';

export interface AdvancedMechanicsDraft {
  /** Bỏ cap 1e12 và dùng Long.MAX_VALUE cho power/potential runtime. */
  unlimitedPower: boolean;
  gearUpgradeRates: number[];
  crystalUpgradeRates: number[];
  discipleSkillRates: number[][];
  godWheelEnabled: boolean;
  godWheelCost: number;
  godWheelRates: number[];
  godWheelRewards: number[];
  /** Vá item #521 Tự động luyện tập: có thời hạn và ưu tiên quái nhiệm vụ. */
  autoTrainingPatchEnabled: boolean;
  autoTrainingQuestAware: boolean;
  autoTrainingDurationMinutes: number;
}

export interface AdvancedMechanicsPatchResult {
  status: 'NO_CHANGES' | 'READY' | 'BLOCKED' | 'FAILED';
  rewrittenClasses: Map<string, ArrayBuffer>;
  appliedDraftCount: number;
  appliedPatchCount: number;
  blockers: Array<{ field: string; message: string }>;
  diagnostics: string[];
  errorMessage?: string;
}

export const ADVANCED_DEFAULTS: AdvancedMechanicsDraft = {
  unlimitedPower: false,
  gearUpgradeRates: [30, 28, 25, 23, 21, 19, 16, 16, 16],
  crystalUpgradeRates: [90, 80, 70, 60, 40, 30, 10, 10, 10],
  discipleSkillRates: [
    [34, 33, 33], // skill đầu: Dragon / Demon / Galick
    [33, 33, 34], // 150m: 7 / 21 / 35
    [30, 40, 30], // 1.5b: 42 / 56 / 63
    [10, 70, 20], // 20b: 91 / 84 / 121
  ],
  godWheelEnabled: false,
  godWheelCost: 0,
  godWheelRates: [50, 30, 15, 5],
  godWheelRewards: [1, 5, 20, 100],
  autoTrainingPatchEnabled: false,
  autoTrainingQuestAware: true,
  autoTrainingDurationMinutes: 60,
};

const store = new WeakMap<LoadedJarSession, AdvancedMechanicsDraft>();

function clone(draft: AdvancedMechanicsDraft): AdvancedMechanicsDraft {
  return {
    ...draft,
    gearUpgradeRates: [...draft.gearUpgradeRates],
    crystalUpgradeRates: [...draft.crystalUpgradeRates],
    discipleSkillRates: draft.discipleSkillRates.map((row) => [...row]),
    godWheelRates: [...draft.godWheelRates],
    godWheelRewards: [...draft.godWheelRewards],
  };
}

function storageKey(session: LoadedJarSession): string {
  const file = session.originalFile;
  return `nro-advanced-mechanics:${file?.name || session.jarInfo.fileName}:${file?.size || 0}`;
}

function clampChance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}
function int(value: number, min = 0, max = 2_100_000_000): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
function fixedArray(input: number[] | undefined, fallback: number[], chance = true): number[] {
  return fallback.map((base, i) => chance ? clampChance(Number(input?.[i] ?? base)) : int(Number(input?.[i] ?? base)));
}
function normalize(input: Partial<AdvancedMechanicsDraft> | null | undefined): AdvancedMechanicsDraft {
  return {
    unlimitedPower: Boolean(input?.unlimitedPower),
    gearUpgradeRates: fixedArray(input?.gearUpgradeRates, ADVANCED_DEFAULTS.gearUpgradeRates),
    crystalUpgradeRates: fixedArray(input?.crystalUpgradeRates, ADVANCED_DEFAULTS.crystalUpgradeRates),
    discipleSkillRates: ADVANCED_DEFAULTS.discipleSkillRates.map((row, i) => fixedArray(input?.discipleSkillRates?.[i], row)),
    godWheelEnabled: Boolean(input?.godWheelEnabled),
    godWheelCost: int(Number(input?.godWheelCost ?? ADVANCED_DEFAULTS.godWheelCost), 0),
    godWheelRates: fixedArray(input?.godWheelRates, ADVANCED_DEFAULTS.godWheelRates),
    godWheelRewards: fixedArray(input?.godWheelRewards, ADVANCED_DEFAULTS.godWheelRewards, false),
    autoTrainingPatchEnabled: Boolean(input?.autoTrainingPatchEnabled),
    autoTrainingQuestAware: input?.autoTrainingQuestAware !== false,
    autoTrainingDurationMinutes: int(Number(input?.autoTrainingDurationMinutes ?? ADVANCED_DEFAULTS.autoTrainingDurationMinutes), 1, 10080),
  };
}

export function getAdvancedMechanicsDraft(session: LoadedJarSession): AdvancedMechanicsDraft {
  const existing = store.get(session);
  if (existing) return clone(existing);
  let loaded: AdvancedMechanicsDraft | null = null;
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(storageKey(session));
      if (raw) loaded = normalize(JSON.parse(raw));
    }
  } catch { /* ignore bad local storage */ }
  const next = loaded ?? clone(ADVANCED_DEFAULTS);
  store.set(session, next);
  return clone(next);
}

export function setAdvancedMechanicsDraft(session: LoadedJarSession, draft: AdvancedMechanicsDraft): AdvancedMechanicsDraft {
  const next = normalize(draft);
  store.set(session, next);
  session.candidateOutput = undefined;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey(session), JSON.stringify(next));
  } catch { /* storage is optional */ }
  return clone(next);
}

export function resetAdvancedMechanicsDraft(session: LoadedJarSession): AdvancedMechanicsDraft {
  const next = clone(ADVANCED_DEFAULTS);
  store.set(session, next);
  session.candidateOutput = undefined;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey(session));
  } catch { /* ignore */ }
  return clone(next);
}

function sameArray(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
}
function sameMatrix(a: number[][], b: number[][]): boolean {
  return a.length === b.length && a.every((row, i) => sameArray(row, b[i]));
}
export function getAdvancedMechanicsDirtyCount(session: LoadedJarSession): number {
  const d = getAdvancedMechanicsDraft(session);
  let count = 0;
  if (d.unlimitedPower !== ADVANCED_DEFAULTS.unlimitedPower) count++;
  if (!sameArray(d.gearUpgradeRates, ADVANCED_DEFAULTS.gearUpgradeRates)) count++;
  if (!sameArray(d.crystalUpgradeRates, ADVANCED_DEFAULTS.crystalUpgradeRates)) count++;
  if (!sameMatrix(d.discipleSkillRates, ADVANCED_DEFAULTS.discipleSkillRates)) count++;
  if (d.godWheelEnabled !== ADVANCED_DEFAULTS.godWheelEnabled) count++;
  if (d.godWheelEnabled && (d.godWheelCost !== ADVANCED_DEFAULTS.godWheelCost || !sameArray(d.godWheelRates, ADVANCED_DEFAULTS.godWheelRates) || !sameArray(d.godWheelRewards, ADVANCED_DEFAULTS.godWheelRewards))) count++;
  if (d.autoTrainingPatchEnabled !== ADVANCED_DEFAULTS.autoTrainingPatchEnabled) count++;
  if (d.autoTrainingPatchEnabled && d.autoTrainingQuestAware !== ADVANCED_DEFAULTS.autoTrainingQuestAware) count++;
  if (d.autoTrainingPatchEnabled && d.autoTrainingDurationMinutes !== ADVANCED_DEFAULTS.autoTrainingDurationMinutes) count++;
  return count;
}

function validateRates(draft: AdvancedMechanicsDraft): Array<{ field: string; message: string }> {
  const blockers: Array<{ field: string; message: string }> = [];
  const groups: Array<[string, number[]]> = [
    ['Skill đầu Đệ tử', draft.discipleSkillRates[0]],
    ['Skill 150m', draft.discipleSkillRates[1]],
    ['Skill 1.5b', draft.discipleSkillRates[2]],
    ['Skill 20b', draft.discipleSkillRates[3]],
  ];
  if (draft.godWheelEnabled) groups.push(['Vòng quay Thượng Đế', draft.godWheelRates]);
  for (const [name, rates] of groups) {
    const total = rates.reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 0.011) blockers.push({ field: name, message: `Tổng tỷ lệ phải = 100%, hiện tại ${total.toFixed(2)}%.` });
  }
  return blockers;
}

interface CpEntry {
  tag: number;
  payloadOffset: number;
  value?: number | bigint | string;
  nameIndex?: number;
  classIndex?: number;
  nameAndTypeIndex?: number;
  descriptorIndex?: number;
}
interface MethodLayout {
  name: string;
  descriptor: string;
  attributeLengthOffset: number;
  attributeLength: number;
  codeDataStart: number;
  maxStackOffset: number;
  maxLocalsOffset: number;
  codeLengthOffset: number;
  codeStart: number;
  codeLength: number;
  codeEnd: number;
}
interface ClassLayout { cpCount: number; cpEnd: number; cp: Array<CpEntry | null>; utf8: Map<number,string>; methods: MethodLayout[]; }

function r2(v: DataView, o: number): number { return v.getUint16(o, false); }
function r4(v: DataView, o: number): number { return v.getUint32(o, false); }
function w2(b: Uint8Array, o: number, n: number): void { b[o] = (n >>> 8) & 255; b[o + 1] = n & 255; }
function w4(b: Uint8Array, o: number, n: number): void { b[o]=(n>>>24)&255;b[o+1]=(n>>>16)&255;b[o+2]=(n>>>8)&255;b[o+3]=n&255; }
function skipAttrs(v: DataView, o: number, n: number): number { let c=o; for(let i=0;i<n;i++){c+=2; const l=r4(v,c); c+=4+l;} return c; }
function toAB(bytes: Uint8Array): ArrayBuffer { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; }

function parseLayout(input: ArrayBuffer): ClassLayout {
  const b = new Uint8Array(input); const v = new DataView(input);
  if (v.getUint32(0,false)!==0xcafebabe) throw new Error('Class không có CAFEBABE.');
  const cpCount=r2(v,8); const cp:Array<CpEntry|null>=new Array(cpCount).fill(null); const utf8=new Map<number,string>(); let c=10;
  for(let i=1;i<cpCount;i++){
    const tag=v.getUint8(c++), payloadOffset=c;
    if(tag===1){const l=r2(v,c);c+=2;const s=new TextDecoder().decode(b.slice(c,c+l));cp[i]={tag,payloadOffset,value:s};utf8.set(i,s);c+=l;}
    else if(tag===3){cp[i]={tag,payloadOffset,value:v.getInt32(c,false)};c+=4;}
    else if(tag===4){cp[i]={tag,payloadOffset,value:v.getFloat32(c,false)};c+=4;}
    else if(tag===5){cp[i]={tag,payloadOffset,value:v.getBigInt64(c,false)};c+=8;i++;}
    else if(tag===6){cp[i]={tag,payloadOffset,value:v.getFloat64(c,false)};c+=8;i++;}
    else if(tag===7){cp[i]={tag,payloadOffset,nameIndex:r2(v,c)};c+=2;}
    else if(tag===8||tag===16||tag===19||tag===20){cp[i]={tag,payloadOffset};c+=2;}
    else if(tag===9||tag===10||tag===11){cp[i]={tag,payloadOffset,classIndex:r2(v,c),nameAndTypeIndex:r2(v,c+2)};c+=4;}
    else if(tag===12){cp[i]={tag,payloadOffset,nameIndex:r2(v,c),descriptorIndex:r2(v,c+2)};c+=4;}
    else if(tag===15){cp[i]={tag,payloadOffset};c+=3;}
    else if(tag===17||tag===18){cp[i]={tag,payloadOffset};c+=4;}
    else throw new Error(`CP tag ${tag} chưa hỗ trợ.`);
  }
  const cpEnd=c; c+=6; const ic=r2(v,c);c+=2+ic*2; const fc=r2(v,c);c+=2;
  for(let i=0;i<fc;i++){c+=6;const ac=r2(v,c);c+=2;c=skipAttrs(v,c,ac);}
  const mc=r2(v,c);c+=2; const methods:MethodLayout[]=[];
  for(let i=0;i<mc;i++){
    c+=2;const ni=r2(v,c);c+=2;const di=r2(v,c);c+=2;const ac=r2(v,c);c+=2;const name=utf8.get(ni)||'',descriptor=utf8.get(di)||'';
    for(let a=0;a<ac;a++){
      c+=2;const alo=c, al=r4(v,c);c+=4;const ds=c; const an=utf8.get(r2(v, c-6))||'';
      if(an==='Code'){
        const clo=ds+4, len=r4(v,clo), cs=ds+8;
        methods.push({name,descriptor,attributeLengthOffset:alo,attributeLength:al,codeDataStart:ds,maxStackOffset:ds,maxLocalsOffset:ds+2,codeLengthOffset:clo,codeStart:cs,codeLength:len,codeEnd:cs+len});
      }
      c=ds+al;
    }
  }
  return {cpCount,cpEnd,cp,utf8,methods};
}

function resolveRef(layout: ClassLayout, index: number): {owner:string;name:string;descriptor:string}|null {
  const ref=layout.cp[index]; if(!ref || (ref.tag!==9&&ref.tag!==10&&ref.tag!==11) || !ref.classIndex || !ref.nameAndTypeIndex) return null;
  const ce=layout.cp[ref.classIndex], nt=layout.cp[ref.nameAndTypeIndex]; if(!ce?.nameIndex || !nt?.nameIndex || !nt?.descriptorIndex) return null;
  return {owner:layout.utf8.get(ce.nameIndex)||'',name:layout.utf8.get(nt.nameIndex)||'',descriptor:layout.utf8.get(nt.descriptorIndex)||''};
}
function findRef(layout: ClassLayout, tag: number, owner: string, name: string, descriptor: string): number|null {
  for(let i=1;i<layout.cpCount;i++){const e=layout.cp[i];if(e?.tag!==tag)continue;const r=resolveRef(layout,i);if(r?.owner===owner&&r.name===name&&r.descriptor===descriptor)return i;} return null;
}
function method(layout: ClassLayout, name: string, descriptor: string): MethodLayout { const m=layout.methods.find(x=>x.name===name&&x.descriptor===descriptor); if(!m) throw new Error(`Không tìm thấy ${name}${descriptor}.`); return m; }

function pushInt(value:number): number[] {
  const v=Math.round(value); if(v===-1)return[0x02]; if(v>=0&&v<=5)return[0x03+v]; if(v>=-128&&v<=127)return[0x10,v&255]; if(v>=-32768&&v<=32767)return[0x11,(v>>>8)&255,v&255]; throw new Error(`Giá trị ${v} quá lớn cho push trực tiếp.`);
}

function replaceCode(input:ArrayBuffer, targetName:string, descriptor:string, code:Uint8Array, maxStack:number, maxLocals:number):ArrayBuffer{
  const bytes=new Uint8Array(input.slice(0));const layout=parseLayout(toAB(bytes));const m=method(layout,targetName,descriptor);
  const oldStart=m.codeDataStart, oldEnd=m.codeDataStart+m.attributeLength;
  const data=new Uint8Array(12+code.length);w2(data,0,maxStack);w2(data,2,maxLocals);w4(data,4,code.length);data.set(code,8);w2(data,8+code.length,0);w2(data,10+code.length,0);
  const out=new Uint8Array(bytes.length-(oldEnd-oldStart)+data.length);out.set(bytes.slice(0,oldStart));out.set(data,oldStart);out.set(bytes.slice(oldEnd),oldStart+data.length);w4(out,m.attributeLengthOffset,data.length);return toAB(out);
}

function tableReturnCode(values:number[]):Uint8Array{
  const parts:number[]=[0x1a,0xaa]; // iload_0, tableswitch
  while(parts.length%4!==0)parts.push(0);
  const tableOp=1; const defaultPos=parts.length; parts.push(0,0,0,0); // default
  parts.push(0,0,0,0); // low=0
  const high=values.length-1; parts.push((high>>>24)&255,(high>>>16)&255,(high>>>8)&255,high&255);
  const offsetPositions:number[]=[]; for(let i=0;i<values.length;i++){offsetPositions.push(parts.length);parts.push(0,0,0,0);}
  const targets:number[]=[];
  for(const value of values){targets.push(parts.length);parts.push(...pushInt(value),0xac);}
  const defaultTarget=targets[targets.length-1];
  const put32=(pos:number,val:number)=>{parts[pos]=(val>>>24)&255;parts[pos+1]=(val>>>16)&255;parts[pos+2]=(val>>>8)&255;parts[pos+3]=val&255;};
  put32(defaultPos,defaultTarget-tableOp); offsetPositions.forEach((p,i)=>put32(p,targets[i]-tableOp));
  return new Uint8Array(parts);
}

class Asm {
  b:number[]=[]; labels=new Map<string,number>(); fix:Array<{pos:number;op:number;label:string}>=[];
  emit(...x:number[]){this.b.push(...x.map(v=>v&255));}
  label(n:string){this.labels.set(n,this.b.length);}
  branch(op:number,label:string){const pos=this.b.length;this.emit(op,0,0);this.fix.push({pos,op,label});}
  finish():Uint8Array{for(const f of this.fix){const t=this.labels.get(f.label);if(t===undefined)throw new Error(`Missing label ${f.label}`);const d=t-f.pos;this.b[f.pos+1]=(d>>8)&255;this.b[f.pos+2]=d&255;}return new Uint8Array(this.b);}
}
function buildDiscipleSkillCode(rates:number[][], wRef:number):Uint8Array{
  const a=new Asm();a.emit(0x10,100,0xb8,(wRef>>8)&255,wRef&255,0x3c); // roll local1
  a.emit(0x1a);a.branch(0x99,'tier0'); // ifeq
  a.emit(0x1a,0x04);a.branch(0x9f,'tier1');
  a.emit(0x1a,0x05);a.branch(0x9f,'tier2');
  a.branch(0xa7,'tier3');
  const ids=[[0,14,28],[7,21,35],[42,56,63],[91,84,121]];
  for(let tier=0;tier<4;tier++){
    a.label(`tier${tier}`);const t1=Math.round(rates[tier][0]);const t2=Math.round(rates[tier][0]+rates[tier][1]);
    a.emit(0x1b,...pushInt(t1));a.branch(0xa2,`tier${tier}_b`);a.emit(...pushInt(ids[tier][0]),0xac);
    a.label(`tier${tier}_b`);a.emit(0x1b,...pushInt(t2));a.branch(0xa2,`tier${tier}_c`);a.emit(...pushInt(ids[tier][1]),0xac);
    a.label(`tier${tier}_c`);a.emit(...pushInt(ids[tier][2]),0xac);
  }
  return a.finish();
}

function rerouteInitialSkill(input:ArrayBuffer):ArrayBuffer{
  const bytes=new Uint8Array(input.slice(0));const layout=parseLayout(toAB(bytes));const m=method(layout,'a','(La/a/H;BB)V');
  const wRef=findRef(layout,10,'a/a/l','w','(I)I');const jRef=findRef(layout,10,'a/a/l','J','(I)I');if(!wRef||!jRef)throw new Error('Không resolve được l.w/l.J.');
  const o=m.codeStart+187; const code=bytes.slice(m.codeStart,m.codeEnd);
  const currentRef=(code[189]<<8)|code[190];
  if(code[187]===0x06 && code[188]===0xb8 && currentRef===wRef){bytes[o]=0x03;bytes[o+1]=0xb8;bytes[o+2]=(jRef>>8)&255;bytes[o+3]=jRef&255;}
  else if(!(code[187]===0x03&&code[188]===0xb8&&currentRef===jRef)) throw new Error('Initial disciple skill pattern @187 khác JAR đã xác minh.');
  return toAB(bytes);
}

function utf8Entry(value:string):Uint8Array{const e=new TextEncoder().encode(value),o=new Uint8Array(3+e.length);o[0]=1;w2(o,1,e.length);o.set(e,3);return o;}
function u2Entry(tag:number,value:number):Uint8Array{const o=new Uint8Array(3);o[0]=tag;w2(o,1,value);return o;}
function pairEntry(tag:number,a:number,b:number):Uint8Array{const o=new Uint8Array(5);o[0]=tag;w2(o,1,a);w2(o,3,b);return o;}
function concat(parts:Uint8Array[]):Uint8Array{const n=parts.reduce((s,p)=>s+p.length,0),o=new Uint8Array(n);let c=0;for(const p of parts){o.set(p,c);c+=p.length;}return o;}


const GAMEPLAY_HELPER_INTERNAL='patch/PanelGameplayScale';
const GAMEPLAY_HELPER_PATH='patch/PanelGameplayScale.class';
const GAMEPLAY_TNSM_SENTINEL=1.23456789012345;
const GAMEPLAY_HELPER_BASE64='yv66vgAAAC8AIAoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWBwAIAQAYcGF0Y2gvUGFuZWxHYW1lcGxheVNjYWxlBj/zwMpCjFndBkPgAAAAAAAABwAOAQAOamF2YS9sYW5nL0xvbmcFf/////////8KABIAEwcAFAwAFQAWAQAMcGF0Y2gvR1RMRml4AQATYXBwbHlEaXNjaXBsZVJld2FyZAEACyhMYS9hL0g7SilKAQAEVE5TTQEAAUQBAA1Db25zdGFudFZhbHVlAQAEQ29kZQEAD0xpbmVOdW1iZXJUYWJsZQEADmRpc2NpcGxlUmV3YXJkAQANU3RhY2tNYXBUYWJsZQEAClNvdXJjZUZpbGUBABdQYW5lbEdhbWVwbGF5U2NhbGUuamF2YQAxAAcAAgAAAAEAGgAXABgAAQAZAAAAAgAJAAIAAgAFAAYAAQAaAAAAEQABAAEAAAAFKrcAAbEAAAAAAAkAHAAWAAEAGgAAADkABAAFAAAALR8JlJ4AJB+KFAAJa0opFAALl5sAChQAD0CnAA4pj0AfCpScAAUKQCofuAARrQAAAAAAAQAeAAAAAgAf';

function findUniqueDouble(layout:ClassLayout,value:number):CpEntry{
  const xs=layout.cp.filter((e):e is CpEntry=>Boolean(e&&e.tag===6&&typeof e.value==='number'&&Math.abs((e.value as number)-value)<1e-12));
  if(xs.length!==1)throw new Error(`Gameplay helper sentinel ${value} found ${xs.length}.`);
  return xs[0];
}
function buildGameplayHelper(multiplier:number):ArrayBuffer{
  const bytes=b64(GAMEPLAY_HELPER_BASE64);
  const layout=parseLayout(toAB(bytes));
  const entry=findUniqueDouble(layout,GAMEPLAY_TNSM_SENTINEL);
  new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setFloat64(entry.payloadOffset,multiplier,false);
  return toAB(bytes);
}
function ensureStaticMethodRef(input:ArrayBuffer,owner:string,name:string,descriptor:string):{bytes:ArrayBuffer;ref:number}{
  let bytes=new Uint8Array(input.slice(0));let layout=parseLayout(toAB(bytes));let ref=findRef(layout,10,owner,name,descriptor);
  if(ref)return{bytes:toAB(bytes),ref};
  const base=layout.cpCount,classUtf=base,cls=base+1,nameUtf=base+2,descUtf=base+3,nt=base+4;ref=base+5;
  const add=concat([utf8Entry(owner),u2Entry(7,classUtf),utf8Entry(name),utf8Entry(descriptor),pairEntry(12,nameUtf,descUtf),pairEntry(10,cls,nt)]);
  const out=new Uint8Array(bytes.length+add.length);out.set(bytes.slice(0,layout.cpEnd));out.set(add,layout.cpEnd);out.set(bytes.slice(layout.cpEnd),layout.cpEnd+add.length);w2(out,8,layout.cpCount+6);
  return{bytes:toAB(out),ref};
}
function patchDiscipleTnsmBridge(input:ArrayBuffer):ArrayBuffer{
  const oldLayout=parseLayout(input);
  const oldRef=findRef(oldLayout,10,'patch/GTLFix','applyDiscipleReward','(La/a/H;J)J');
  if(!oldRef)throw new Error('Không resolve được GTLFix.applyDiscipleReward(H,long).');
  const ensured=ensureStaticMethodRef(input,GAMEPLAY_HELPER_INTERNAL,'discipleReward','(La/a/H;J)J');
  const bytes=new Uint8Array(ensured.bytes.slice(0));const layout=parseLayout(toAB(bytes));const m=method(layout,'e','(IZ)V');
  const code=bytes.subarray(m.codeStart,m.codeEnd);let count=0;
  for(let i=0;i+2<code.length;i++){
    if(code[i]!==0xb8)continue;
    const ref=(code[i+1]<<8)|code[i+2];
    if(ref!==oldRef)continue;
    code[i+1]=(ensured.ref>>8)&255;code[i+2]=ensured.ref&255;count++;
  }
  if(count!==1)throw new Error(`Disciple reward bridge expected 1 call, nhận ${count}.`);
  return toAB(bytes);
}
function findUniqueLong(layout:ClassLayout,value:bigint):CpEntry{
  const xs=layout.cp.filter((e):e is CpEntry=>Boolean(e&&e.tag===5&&typeof e.value==='bigint'&&(e.value as bigint)===value));
  if(xs.length!==1)throw new Error(`Power cap long ${value.toString()} found ${xs.length}.`);
  return xs[0];
}
function patchUnlimitedPower(input:ArrayBuffer):ArrayBuffer{
  const bytes=new Uint8Array(input.slice(0));const layout=parseLayout(toAB(bytes));const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const LONG_MAX=9223372036854775807n;
  const entries:[bigint,bigint][]=[
    [999999999995n,LONG_MAX-5n],
    [1000000000000n,LONG_MAX],
    [1000000000001n,LONG_MAX],
  ];
  for(const [from,to] of entries)view.setBigInt64(findUniqueLong(layout,from).payloadOffset,to,false);
  return toAB(bytes);
}

const GOD_HELPER_INTERNAL='patch/PanelGodWheel';
const GOD_HELPER_PATH='patch/PanelGodWheel.class';
const GOD_HELPER_BASE64='yv66vgAAAC8AOAoAAgADBwAEDAAFAAYBABBqYXZhL2xhbmcvT2JqZWN0AQAGPGluaXQ+AQADKClWCgAIAAkHAAoMAAsABgEACHBhdGNoL1JDAQANb3BlbkRlY29tcG9zZQoACAANDAAOAAYBAAtvcGVuUmVjeWNsZQoAEAARBwASDAATABQBABNwYXRjaC9QYW5lbEdvZFdoZWVsAQAEc3BpbgEACihMYS9hL0g7KVYDABS4TQkAFwAYBwAZDAAaABsBAAVhL2EvSAEAAnh2AQABSQoAHQAeBwAfDAAgACEBABBqYXZhL2xhbmcvU3lzdGVtAQARY3VycmVudFRpbWVNaWxsaXMBAAMoKUoFAAAAAAAAJxADABS4TgMAFLhXAwAUuE8DABS4WAMAFLhQAwAUuFkDABS4WgEABENPU1QBAA1Db25zdGFudFZhbHVlAQACVDEBAAJUMgEAAlQzAQACUjEBAAJSMgEAAlIzAQACUjQBAARDb2RlAQAGaGFuZGxlAQANKElJSUxhL2EvSDspWgEADVN0YWNrTWFwVGFibGUAMQAQAAIAAAAIABoAKwAbAAEALAAAAAIAFQAaAC0AGwABACwAAAACACQAGgAuABsAAQAsAAAAAgAmABoALwAbAAEALAAAAAIAKAAaADAAGwABACwAAAACACUAGgAxABsAAQAsAAAAAgAnABoAMgAbAAEALAAAAAIAKQAaADMAGwABACwAAAACACoAAwACAAUABgABADQAAAARAAEAAQAAAAUqtwABsQAAAAAACQA1ADYAAQA0AAAASQACAAQAAAAyGhAVoAAcGwigABccBqAACLgABwSsHAegAAi4AAwErBoQLaAADhwHoAAJLbgADwSsA6wAAAABADcAAAAFAAMVCRAACQATABQAAQA0AAAAgAAEAAQAAABcKscABLESFTwbngAWKrQAFhuiAASxKlm0ABYbZLUAFrgAHAR9FAAicYg9HBIkogAJEiU+pwAeHBImogAJEic+pwASHBIoogAJEik+pwAGEio+Klm0ABYdYLUAFrEAAAABADcAAAASAAcF/AAPAQn8ABYBCwv8AAIBAAA=';
function b64(value:string):Uint8Array{const s=atob(value);const o=new Uint8Array(s.length);for(let i=0;i<s.length;i++)o[i]=s.charCodeAt(i)&255;return o;}
function findUniqueInt(layout:ClassLayout,value:number):CpEntry{const xs=layout.cp.filter((e):e is CpEntry=>Boolean(e&&e.tag===3&&e.value===value));if(xs.length!==1)throw new Error(`GodWheel sentinel ${value} found ${xs.length}.`);return xs[0];}
function buildGodHelper(d:AdvancedMechanicsDraft):ArrayBuffer{
  const bytes=b64(GOD_HELPER_BASE64);const layout=parseLayout(toAB(bytes));const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const rates=d.godWheelRates;const t=[rates[0],rates[0]+rates[1],rates[0]+rates[1]+rates[2]].map(x=>Math.round(x*100));
  const pairs:[[number,number],[number,number],[number,number],[number,number],[number,number],[number,number],[number,number],[number,number]]=[
    [1357901,d.godWheelCost],[1357902,t[0]],[1357903,t[1]],[1357904,t[2]],
    [1357911,d.godWheelRewards[0]],[1357912,d.godWheelRewards[1]],[1357913,d.godWheelRewards[2]],[1357914,d.godWheelRewards[3]],
  ];
  for(const [sentinel,value] of pairs)view.setInt32(findUniqueInt(layout,sentinel).payloadOffset,Math.trunc(value),false);
  return toAB(bytes);
}
function ensureGodRef(input:ArrayBuffer):{bytes:ArrayBuffer;ref:number}{
  let bytes=new Uint8Array(input.slice(0));let layout=parseLayout(toAB(bytes));let ref=findRef(layout,10,GOD_HELPER_INTERNAL,'handle','(IIILa/a/H;)Z');
  if(ref)return{bytes:toAB(bytes),ref};
  const base=layout.cpCount, classUtf=base, cls=base+1,nameUtf=base+2,descUtf=base+3,nt=base+4;ref=base+5;
  const add=concat([utf8Entry(GOD_HELPER_INTERNAL),u2Entry(7,classUtf),utf8Entry('handle'),utf8Entry('(IIILa/a/H;)Z'),pairEntry(12,nameUtf,descUtf),pairEntry(10,cls,nt)]);
  const out=new Uint8Array(bytes.length+add.length);out.set(bytes.slice(0,layout.cpEnd));out.set(add,layout.cpEnd);out.set(bytes.slice(layout.cpEnd),layout.cpEnd+add.length);w2(out,8,layout.cpCount+6);return{bytes:toAB(out),ref};
}
function patchGodWheelMenu(input:ArrayBuffer):ArrayBuffer{
  const ensured=ensureGodRef(input);const bytes=new Uint8Array(ensured.bytes.slice(0));const layout=parseLayout(toAB(bytes));const m=method(layout,'m0','([B)Z');
  const pU=findRef(layout,9,'a/ba','pU','I');if(!pU)throw new Error('Không resolve được a/ba.pU.');
  const code=bytes.slice(m.codeStart,m.codeEnd);if(code[346]!==0x19&&code[346]!==0x2a)throw new Error('a/a/F.m0 special block @346 khác JAR đã xác minh.');
  const rep=new Uint8Array(35).fill(0);let c=0;rep[c++]=0x1c;rep[c++]=0xb2;rep[c++]=(pU>>8)&255;rep[c++]=pU&255;rep[c++]=0x1d;rep[c++]=0x19;rep[c++]=0x04;rep[c++]=0xb8;rep[c++]=(ensured.ref>>8)&255;rep[c++]=ensured.ref&255;rep[c++]=0x99;const branchPos=346+c-1;const disp=381-branchPos;rep[c++]=(disp>>8)&255;rep[c++]=disp&255;rep[c++]=0x04;rep[c++]=0xac;
  bytes.set(rep,m.codeStart+346);return toAB(bytes);
}


const AUTO_TRAIN_HELPER_INTERNAL='patch/PanelAutoTrain';
const AUTO_TRAIN_HELPER_PATH='patch/PanelAutoTrain.class';
const AUTO_TRAIN_HELPER_BASE64='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';

function buildAutoTrainHelper(d:AdvancedMechanicsDraft):ArrayBuffer{
  const bytes=b64(AUTO_TRAIN_HELPER_BASE64);const layout=parseLayout(toAB(bytes));const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  view.setInt32(findUniqueInt(layout,2468101).payloadOffset,Math.trunc(d.autoTrainingDurationMinutes),false);
  view.setInt32(findUniqueInt(layout,2468102).payloadOffset,d.autoTrainingQuestAware?1:0,false);
  return toAB(bytes);
}

function patchAutoTrainToggle(input:ArrayBuffer):ArrayBuffer{
  const ensured=ensureStaticMethodRef(input,AUTO_TRAIN_HELPER_INTERNAL,'toggleState','(La/a/H;)Z');
  const bytes=new Uint8Array(ensured.bytes.slice(0));const layout=parseLayout(toAB(bytes));const m=method(layout,'v','(La/a/H;)V');
  const code=bytes.subarray(m.codeStart,m.codeEnd);
  if(code.length<21||code[0]!==0xb2||code[3]!==0x99||code[6]!==0x03||code[7]!==0xa7||code[10]!==0x04||code[11]!==0x3c||code[12]!==0x1b||code[13]!==0xb3||code[16]!==0x2a||code[17]!==0x1b||code[18]!==0xb5){
    throw new Error('a/a/x.v(H) không còn đúng toggle auto đã xác minh.');
  }
  const rep=new Uint8Array(21).fill(0x00);rep[0]=0x2a;rep[1]=0xb8;rep[2]=(ensured.ref>>8)&255;rep[3]=ensured.ref&255;rep[4]=0x3c;
  bytes.set(rep,m.codeStart);return toAB(bytes);
}

function patchAutoTrainMobFilter(input:ArrayBuffer):ArrayBuffer{
  const ensured=ensureStaticMethodRef(input,AUTO_TRAIN_HELPER_INTERNAL,'allowMob','(La/m;)Z');
  const bytes=new Uint8Array(ensured.bytes.slice(0));const layout=parseLayout(toAB(bytes));const m=method(layout,'d','()V');const code=bytes.subarray(m.codeStart,m.codeEnd);
  const aJRef=findRef(layout,9,'a/m','aJ','Z');if(!aJRef)throw new Error('Không resolve được a/m.aJ:Z.');
  const verifyField=(offset:number)=>code[offset]===0xb4&&(((code[offset+1]<<8)|code[offset+2])===aJRef);
  if(!verifyField(381)||code[384]!==0x99||!verifyField(434)||code[437]!==0x9a)throw new Error('a/am.d() auto-target offsets 381/434 khác JAR đã xác minh.');
  code[381]=0xb8;code[382]=(ensured.ref>>8)&255;code[383]=ensured.ref&255;code[384]=0x9a; // target hiện tại hợp quest -> giữ
  code[434]=0xb8;code[435]=(ensured.ref>>8)&255;code[436]=ensured.ref&255;code[437]=0x99; // candidate không hợp -> bỏ
  return toAB(bytes);
}

function validateClass(path:string, bytes:ArrayBuffer):void{const p=parseClassFile(bytes);if(p.status!=='valid'||p.remainingBytes!==0||p.magic!==0xcafebabe)throw new Error(`${path} không parse hợp lệ sau patch.`);}

export async function buildAdvancedMechanicsPatches(session:LoadedJarSession):Promise<AdvancedMechanicsPatchResult>{
  const draft=getAdvancedMechanicsDraft(session);
  const gameplay=getGameMechanicsDraft(session);
  const dirty=getAdvancedMechanicsDirtyCount(session);
  const needsDiscipleTnsm=Math.abs(gameplay.tnsmMultiplier-1)>1e-12;
  const rewritten=new Map<string,ArrayBuffer>();const diagnostics:string[]=[];const blockers=validateRates(draft);
  if(draft.unlimitedPower&&Math.abs(gameplay.powerCapMultiplier-1)>1e-12){
    blockers.push({field:'Sức mạnh không giới hạn',message:'Khi bật không giới hạn sức mạnh, Power cap multiplier cũ phải để x1 để tránh hai writer cùng sửa a/a/V.class.'});
  }
  if(dirty===0&&!needsDiscipleTnsm)return{status:'NO_CHANGES',rewrittenClasses:rewritten,appliedDraftCount:0,appliedPatchCount:0,blockers:[],diagnostics:[]};
  if(blockers.length)return{status:'BLOCKED',rewrittenClasses:rewritten,appliedDraftCount:dirty,appliedPatchCount:0,blockers,diagnostics};
  try{
    let patches=0;
    if(!sameArray(draft.gearUpgradeRates,ADVANCED_DEFAULTS.gearUpgradeRates)||!sameArray(draft.crystalUpgradeRates,ADVANCED_DEFAULTS.crystalUpgradeRates)){
      const e=session.zip.file('a/a/j.class');if(!e)throw new Error('Không tìm thấy a/a/j.class.');let b=await e.async('arraybuffer');
      if(!sameArray(draft.gearUpgradeRates,ADVANCED_DEFAULTS.gearUpgradeRates)){b=replaceCode(b,'C','(I)I',tableReturnCode(draft.gearUpgradeRates.map(Math.round)),1,1);patches++;diagnostics.push(`Đập đồ +0..+8: ${draft.gearUpgradeRates.join('% / ')}%`);}
      if(!sameArray(draft.crystalUpgradeRates,ADVANCED_DEFAULTS.crystalUpgradeRates)){b=replaceCode(b,'sr','(I)I',tableReturnCode(draft.crystalUpgradeRates.map(Math.round)),1,1);patches++;diagnostics.push(`Đập sao 0..8: ${draft.crystalUpgradeRates.join('% / ')}%`);}
      validateClass('a/a/j.class',b);rewritten.set('a/a/j.class',b);
    }

    const skillRatesChanged=!sameMatrix(draft.discipleSkillRates,ADVANCED_DEFAULTS.discipleSkillRates);
    if(skillRatesChanged||needsDiscipleTnsm){
      const e=session.zip.file('a/a/l.class');if(!e)throw new Error('Không tìm thấy a/a/l.class.');let b=await e.async('arraybuffer');
      if(skillRatesChanged){
        b=rerouteInitialSkill(b);let lay=parseLayout(b);const wRef=findRef(lay,10,'a/a/l','w','(I)I');if(!wRef)throw new Error('Không resolve được RNG l.w(I)I.');
        b=replaceCode(b,'J','(I)I',buildDiscipleSkillCode(draft.discipleSkillRates,wRef),2,2);patches+=2;diagnostics.push('RNG skill Đệ tử: skill đầu + 3 mốc sức mạnh đã đổi tỷ lệ.');
      }
      if(needsDiscipleTnsm){
        b=patchDiscipleTnsmBridge(b);rewritten.set(GAMEPLAY_HELPER_PATH,buildGameplayHelper(gameplay.tnsmMultiplier));patches+=2;
        diagnostics.push(`TNSM global x${gameplay.tnsmMultiplier}: đã đồng bộ reward Đệ tử qua a/a/l.e(IZ)V.`);
      }
      validateClass('a/a/l.class',b);rewritten.set('a/a/l.class',b);
    }

    if(draft.unlimitedPower){
      const e=session.zip.file('a/a/V.class');if(!e)throw new Error('Không tìm thấy a/a/V.class.');
      const b=patchUnlimitedPower(await e.async('arraybuffer'));validateClass('a/a/V.class',b);rewritten.set('a/a/V.class',b);patches+=3;
      diagnostics.push('Power/Potential cap: 1e12 → Long.MAX_VALUE (kèm startup invariant cap-5/cap+1).');
    }

    if(draft.autoTrainingPatchEnabled){
      const xEntry=session.zip.file('a/a/x.class');const amEntry=session.zip.file('a/am.class');
      if(!xEntry||!amEntry)throw new Error('Thiếu a/a/x.class hoặc a/am.class cho Auto Training writer.');
      const xb=patchAutoTrainToggle(await xEntry.async('arraybuffer'));const amb=patchAutoTrainMobFilter(await amEntry.async('arraybuffer'));const helper=buildAutoTrainHelper(draft);
      validateClass('a/a/x.class',xb);validateClass('a/am.class',amb);validateClass(AUTO_TRAIN_HELPER_PATH,helper);
      rewritten.set('a/a/x.class',xb);rewritten.set('a/am.class',amb);rewritten.set(AUTO_TRAIN_HELPER_PATH,helper);patches+=3;
      diagnostics.push(`Tự động luyện tập #521: ${draft.autoTrainingDurationMinutes} phút${draft.autoTrainingQuestAware?' + ưu tiên quái nhiệm vụ':' + target tự do'}.`);
    }

    if(draft.godWheelEnabled){const e=session.zip.file('a/a/F.class');if(!e)throw new Error('Không tìm thấy a/a/F.class.');let b=await e.async('arraybuffer');b=patchGodWheelMenu(b);validateClass('a/a/F.class',b);rewritten.set('a/a/F.class',b);rewritten.set(GOD_HELPER_PATH,buildGodHelper(draft));patches+=2;diagnostics.push(`Vòng quay Thượng Đế custom: cost ${draft.godWheelCost} ngọc, rate ${draft.godWheelRates.join('/')}, reward ${draft.godWheelRewards.join('/')}.`);}
    return{status:'READY',rewrittenClasses:rewritten,appliedDraftCount:dirty,appliedPatchCount:patches,blockers:[],diagnostics};
  }catch(error){return{status:'FAILED',rewrittenClasses:rewritten,appliedDraftCount:dirty,appliedPatchCount:0,blockers:[],diagnostics,errorMessage:error instanceof Error?error.message:String(error)};}
}
