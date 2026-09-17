import { completionBody, COMPLETION_TIMEOUT_MS } from './completion-request'
import { readCompletion } from './completion'
import { parseNumbers } from './fingerprint-core.js'
import type { ApiConfig, Challenge, CodedError, CollectionProgress, ErrorCode, Output, SampleState } from './types'

export type CompletionTransport = (url:string, config:ApiConfig, body:Record<string,unknown>, signal:AbortSignal) => Promise<Response>
export const coded=(message:string,code:ErrorCode,extra?:Partial<CodedError>):CodedError=>Object.assign(new Error(message),{code},extra)
export const directTransport:CompletionTransport = (url,config,body,signal) => {
  const headers:Record<string,string> = {'Content-Type':'application/json',Accept:body.stream?'text/event-stream':'application/json'}
  if(config.format==='anthropic'){
    headers['x-api-key']=config.apiKey
    headers['anthropic-version']='2023-06-01'
  }else headers.Authorization='Bearer '+config.apiKey
  return fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal,redirect:'error'})
}

export function endpoint(config:ApiConfig){
  let u:URL
  try{u=new URL(config.baseUrl)}catch{throw coded('请输入有效的 Base URL','invalid_base_url')}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw coded('Base URL 格式不正确','invalid_base_url')
  const base=u.href.replace(/\/$/,'')
  if(config.format==='responses')return base.endsWith('/responses')?base:base+(base.endsWith('/v1')?'/responses':'/v1/responses')
  if(config.format==='anthropic')return base.endsWith('/messages')?base:base+(base.endsWith('/v1')?'/messages':'/v1/messages')
  return base.endsWith('/chat/completions')?base:base+(base.endsWith('/v1')?'/chat/completions':'/v1/chat/completions')
}
export async function complete(config:ApiConfig,prompt:string,system='',signal?:AbortSignal,onText?:(text:string)=>void,transport:CompletionTransport=directTransport){
  const body=completionBody(config,prompt,system)
  const timeout=AbortSignal.timeout(COMPLETION_TIMEOUT_MS),combined=signal?AbortSignal.any([signal,timeout]):timeout
  try{
    const response=await transport(endpoint(config),config,body,combined)
    return await readCompletion(response,config.format,onText)
  }catch(error){
    if(signal?.aborted)throw coded('已取消请求','aborted')
    if(timeout.aborted)throw coded('上游请求超时，请重试','timeout')
    if(error instanceof TypeError)throw coded('API 连接失败，请检查地址和网络','network')
    if(error instanceof Error){
      const e=error as CodedError
      e.message=e.message.replaceAll(config.apiKey,'[REDACTED]')
      throw e
    }
    throw coded('调用失败','network')
  }
}

export async function testApi(config:ApiConfig,challenges:Challenge[],onProgress:(p:CollectionProgress)=>void,signal?:AbortSignal,transport:CompletionTransport=directTransport):Promise<Output[]>{
  const outputs:Output[]=challenges.map(c=>({text:'',expected_count:c.expected_count})),errors:string[]=[]
  const states:NonNullable<CollectionProgress['challenges']>=challenges.map(()=>({text:'',status:'等待发送',state:'pending' as SampleState}));let accepted=0,completed=0
  const report=(message:string,i:number)=>{if(!signal?.aborted)onProgress({completed,total:challenges.length,accepted,message,challengeIndex:i,challenges:states.map(s=>({...s})),outputs:outputs.map(o=>({...o}))})}
  const run=async(i:number)=>{
    signal?.throwIfAborted();states[i]={...states[i],status:'正在请求',state:'requesting'};report(`正在请求挑战 ${i+1}`,i)
    try{
      const r=await complete(config,challenges[i].prompt,'',signal,text=>{states[i]={text,status:'正在接收输出',state:'streaming'};report(config.parallel?'三个挑战并行处理中':`挑战 ${i+1} 正在接收输出`,i)},transport)
      states[i].text=r.text
      if(parseNumbers(r.text).length<Math.max(80,Math.ceil(challenges[i].expected_count*.55)))throw coded('有效数字不足','insufficient_numbers')
      outputs[i]={text:r.text,expected_count:challenges[i].expected_count};accepted++;states[i]={...states[i],status:'已完成',state:'done'}
    }catch(error){
      if(signal?.aborted)throw coded('已取消请求','aborted')
      const e=error as CodedError,message=e instanceof Error?e.message:'请求失败'
      errors.push(message);states[i]={...states[i],status:`未采用：${message}`,state:'rejected',error:message,errorCode:e?.code,httpStatus:e?.httpStatus}
    }
    completed++;report(errors.length?`已完成 ${completed} 次，${errors.length} 次未采用：${errors.at(-1)}`:`已完成 ${completed} 次请求`,i)
  }
  if(config.parallel){
    const results=await Promise.allSettled(challenges.map((_,i)=>run(i)))
    const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason
  }else{for(let i=0;i<challenges.length;i++)await run(i)}

  if(!accepted){
    const first=states.find(s=>s.state==='rejected')
    throw coded(errors[0]||'没有获得有效输出',first?.errorCode||'no_output',{httpStatus:first?.httpStatus})
  }
  return outputs
}
