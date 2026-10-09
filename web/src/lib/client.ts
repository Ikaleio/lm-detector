import { redactPrivateMetadata } from '@fingerpoint/shared/privacy'
import { coded, endpoint, testApi as testApiShared, type CompletionTransport } from '@fingerpoint/shared/detection'
import { assertTokenizerBank, type TokenizerBank } from '@fingerpoint/shared/tokenizer-bank'
import { probeTokenizer as probeTokenizerShared, tokenizerReport, type TokenizerRun } from '@fingerpoint/shared/tokenizer-probe'
import { generateChallenges } from '@fingerpoint/shared/challenge-browser.js'
import { parseNumbers } from '@fingerpoint/shared/fingerprint-core.js'
import { analyzeSharedOutputs, type SharedDetector } from '@fingerpoint/shared/shared-detector'
import type { Analysis, ApiConfig, Bank, Challenge, CollectionProgress, Output } from '@fingerpoint/shared/types'
import { parseReference, referenceSamples } from '@fingerpoint/shared/reference'
import type { ReferenceBatch, ReferenceSample } from '@fingerpoint/shared/reference'
import { directHeaders, directInit } from './route'
import { readStaticData } from './static-data'
export { generateChallenges, parseNumbers }

export interface ReferenceEntry { batch: ReferenceBatch; sample: ReferenceSample }
let current:Bank|undefined, referenceCache:ReferenceBatch[]|undefined
let loading:Promise<Bank>|undefined
let detectorLoading:Promise<SharedDetector>|undefined
function loadDetector():Promise<SharedDetector>{
  return detectorLoading ??= readStaticData('shared_detector.json').then(data=>JSON.parse(data) as SharedDetector)
    .catch(error=>{detectorLoading=undefined;throw error})
}
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
  loading=readStaticData('unified_bank.json').then(data=>JSON.parse(data) as Bank).then((bank:Bank)=>{current=bank;return bank}).catch(error=>{loading=undefined;throw error})
  return loading
}
export async function loadReferences():Promise<ReferenceBatch[]>{await loadBank();if(!referenceCache)referenceCache=parseReference(await readStaticData('unified_reference.jsonl'));return referenceCache}
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
/** The tokenizer probe shown beside the result; it travels as reference information and never changes the candidates. */
export interface ResultTokenizer { run:TokenizerRun; bank:TokenizerBank; startedAt:number; model:string }
export function exportAnalysis(result:Analysis,probe?:ResultTokenizer){
  const candidates=result.results.map(r=>({model:r.model,name:r.display_name,confidence:r.probability}))
  // Counts, probe ids, response model names and the claimed model leave with the result; the address and key stay behind.
  const tokenizer=probe?tokenizerReport(probe.run,probe.bank,{createdAt:probe.startedAt,model:probe.model}):undefined
  download('fingerpoint-result.json',JSON.stringify(sanitize({candidates,tokenizer}),null,2)+'\n')
}
/** Chat Completions and Responses omit their optional output limits on both routes. */
function browserBody(config:ApiConfig,body:Record<string,unknown>){
  const requestBody={...body}
  if(config.format==='responses')delete requestBody.max_output_tokens
  else if(config.format==='openai')delete requestBody.max_tokens
  return requestBody
}
/** Sends the request to the site proxy or a self-deployed Worker, which both run `worker/main.js`. */
const proxyTransport = (proxy:string):CompletionTransport => (url,config,body,signal) => {
  const headers={'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`,Accept:body.stream?'text/event-stream':'application/json'}
  return fetch(proxy,{method:'POST',headers,body:JSON.stringify({url,format:config.format,body:browserBody(config,body)}),signal,redirect:'error',credentials:'omit',cache:'no-store'})
}
/**
 * Calls the endpoint from the browser. A network-level failure here may be a wrong address or network, or an API that
 * does not allow browser CORS; the browser cannot tell them apart, so it gets its own code.
 */
const directTransport:CompletionTransport = (url,config,body,signal) =>
  fetch(url,{...directInit,method:'POST',headers:directHeaders(config,config.apiKey,Boolean(body.stream)),body:JSON.stringify(browserBody(config,body)),signal})
    .catch(error=>{throw error instanceof TypeError?coded('The browser could not call the API directly.','direct_network'):error})
/** A proxied route names its relay, so a later settings change cannot redirect a running job. */
export type Route = {kind:'direct'}|{kind:'proxy';endpoint:string}
export const transportFor = (route:Route):CompletionTransport => route.kind==='direct'?directTransport:proxyTransport(route.endpoint)
export const testApi = (config:ApiConfig,challenges:Challenge[],onProgress:(p:CollectionProgress)=>void,route:Route,signal?:AbortSignal) =>
  testApiShared(config,challenges,onProgress,signal,transportFor(route))

let tokenizerBankLoading:Promise<TokenizerBank>|undefined
export function loadTokenizerBank():Promise<TokenizerBank>{
  return tokenizerBankLoading ??= readStaticData('tokenizer_bank.json').then(text=>{
    const bank=JSON.parse(text) as unknown
    assertTokenizerBank(bank)
    return bank
  }).catch(error=>{tokenizerBankLoading=undefined;throw error})
}
/** Keeps `concurrency` probes in flight; one at a time sends the fewest requests. */
export const probeTokenizer = (config:ApiConfig&{concurrency:number},bank:TokenizerBank,route:Route,signal:AbortSignal,onUpdate:(run:TokenizerRun)=>void) =>
  probeTokenizerShared(config,bank,{url:endpoint(config),transport:transportFor(route),concurrency:config.concurrency,signal,onUpdate})
