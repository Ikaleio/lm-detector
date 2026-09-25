import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'
import { testApi as testApiShared, type CompletionTransport } from '@fingerpoint/shared/detection'
import { generateChallenges } from '@fingerpoint/shared/challenge-browser.js'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import { analyzeSharedOutputs, type SharedDetector } from '@fingerpoint/shared/shared-detector'
import type { Analysis, ApiConfig, Bank, Challenge, CollectionProgress, Output } from '@fingerpoint/shared/types'
import { parseReference, referenceSamples } from '@fingerpoint/shared/reference'
import type { ReferenceBatch, ReferenceSample } from '@fingerpoint/shared/reference'
export { generateChallenges, parseNumbers }

export interface ReferenceEntry { batch: ReferenceBatch; sample: ReferenceSample }
let current:Bank|undefined, referenceCache:ReferenceBatch[]|undefined
let loading:Promise<Bank>|undefined
let detectorLoading:Promise<SharedDetector>|undefined
function loadDetector():Promise<SharedDetector>{
  return detectorLoading ??= readFile('shared_detector.json').then(r=>r.json()).catch(error=>{detectorLoading=undefined;throw error})
}
const url=(file:string)=>`${import.meta.env.BASE_URL}data/${file}`
async function readFile(file:string) {const response=await fetch(url(file));if(!response.ok)throw new Error('统一库文件加载失败，请刷新重试');return response}
function worker<T>(data:unknown,onProgress?:(text:string)=>void,fallback?:()=>T):Promise<T>{
  return new Promise((resolve,reject)=>{
    let w:Worker|undefined,finished=false
    const stop=()=>{finished=true;w?.terminate()}
    const unavailable=()=>{
      if(finished)return
      stop()
      if(fallback){try{resolve(fallback())}catch(error){reject(error)}}
      else reject(new Error('检测计算无法启动，请刷新页面后重试。'))
    }
    try{
      w=new Worker(new URL('./fingerprint.worker.ts',import.meta.url),{type:'module'})
      w.onmessage=({data})=>{
        if(finished)return
        if(data.progress){onProgress?.(data.progress);return}
        stop()
        if(data.error)reject(new Error(data.error));else resolve(data.result)
      }
      w.onerror=unavailable
      w.onmessageerror=unavailable
      w.postMessage(data)
    }catch{unavailable()}
  })
}
export async function loadBank():Promise<Bank>{
  if(current)return current
  if(loading)return loading
  loading=readFile('unified_bank.json').then(response=>response.json()).then((bank:Bank)=>{current=bank;return bank}).catch(error=>{loading=undefined;throw error})
  return loading
}
export async function loadReferences():Promise<ReferenceBatch[]>{await loadBank();if(!referenceCache)referenceCache=parseReference(await(await readFile('unified_reference.jsonl')).text());return referenceCache}
export async function loadSamples(model:string):Promise<ReferenceEntry[]>{return [...referenceSamples((await loadReferences()).filter(batch=>batch.model.id===model))]}
export async function analyze(outputs:Output[],bank:Bank):Promise<Analysis>{
  const detector=await loadDetector()
  const options={allowPartial:true}
  return worker({action:'analyze',outputs,bank,detector,options},undefined,()=>analyzeSharedOutputs(outputs,bank,detector,options))
}
function sanitize(value:unknown):unknown {
  if(typeof value==='string')return redactPrivateMetadata(value.replace(/\bsk-[\w-]+/g,'[REDACTED]'))
  if(Array.isArray(value))return value.map(sanitize)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['api_key','apiKey','authorization','access_token','refresh_token'].includes(k)).map(([k,v])=>[k,sanitize(v)]))
  return value
}
function download(name:string,content:string,type='application/json'){
  const object=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=object;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(object),1000)
}
export async function exportReferences(){download('unified_reference.jsonl',(await loadReferences()).map(batch=>JSON.stringify(sanitize(batch))).join('\n')+'\n','application/x-ndjson')}
export function exportBank(bank:Bank){download('unified_bank.json',JSON.stringify(sanitize(bank),null,2)+'\n')}
export function exportAnalysis(result:Analysis){
  const candidates=result.results.map(r=>({model:r.model,name:r.display_name,confidence:r.verification_confidence??r.probability??null}))
  download('fingerpoint-result.json',JSON.stringify(candidates,null,2)+'\n')
}
const browserTransport:CompletionTransport = (url,config,body,signal) => {
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`,Accept:body.stream?'text/event-stream':'application/json'}
  const requestBody={...body}
  if(config.format==='responses')delete requestBody.max_output_tokens
  else if(config.format==='openai')delete requestBody.max_tokens
  return fetch('/api/proxy',{method:'POST',headers,body:JSON.stringify({url,format:config.format,body:requestBody}),signal,redirect:'error',credentials:'omit'})
}
export const testApi = (config:ApiConfig,challenges:Challenge[],onProgress:(p:CollectionProgress)=>void,signal?:AbortSignal) =>
  testApiShared(config,challenges,onProgress,signal,browserTransport)
