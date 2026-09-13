import { completionBody, COMPLETION_TIMEOUT_MS } from './completion-request'
import { readCompletion } from './completion'
import { parseNumbers } from './fingerprint-core.js'
import type { ApiConfig, Challenge, CollectionProgress, Output } from './types'

export type CompletionTransport = (url:string, config:ApiConfig, body:Record<string,unknown>, signal:AbortSignal) => Promise<Response>
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
  try{u=new URL(config.baseUrl)}catch{throw new Error('请输入有效的 Base URL')}
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw new Error('Base URL 格式不正确')
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
    if(signal?.aborted)throw new Error('已取消请求')
    if(timeout.aborted)throw new Error('上游请求超时，请重试')
    if(error instanceof TypeError)throw new Error('API 连接失败，请检查地址和网络')
    throw new Error((error instanceof Error?error.message:'调用失败').replaceAll(config.apiKey,'[REDACTED]'))
  }
}

export async function testApi(config:ApiConfig,challenges:Challenge[],onProgress:(p:CollectionProgress)=>void,signal?:AbortSignal,transport:CompletionTransport=directTransport):Promise<Output[]>{
  const outputs:Output[]=challenges.map(c=>({text:'',expected_count:c.expected_count})),errors:string[]=[]
  const states=challenges.map(()=>({text:'',status:'等待发送'}));let accepted=0,completed=0
  const report=(message:string,i:number)=>{if(!signal?.aborted)onProgress({completed,total:challenges.length,accepted,message,challengeIndex:i,challenges:states.map(s=>({...s})),outputs:outputs.map(o=>({...o}))})}
  const run=async(i:number)=>{
    signal?.throwIfAborted();states[i].status='正在请求';report(`正在请求挑战 ${i+1}`,i)
    try{
      const r=await complete(config,challenges[i].prompt,'',signal,text=>{states[i]={text,status:'正在接收输出'};report(config.parallel?'三个挑战并行处理中':`挑战 ${i+1} 正在接收输出`,i)},transport)
      states[i].text=r.text
      if(parseNumbers(r.text).length<Math.max(80,Math.ceil(challenges[i].expected_count*.55)))throw new Error('有效数字不足')
      outputs[i]={text:r.text,expected_count:challenges[i].expected_count};accepted++;states[i].status='已完成'
    }catch(error){if(signal?.aborted)throw new Error('已取消请求');const message=error instanceof Error?error.message:'请求失败';errors.push(message);states[i].status=`未采用：${message}`}
    completed++;report(errors.length?`已完成 ${completed} 次，${errors.length} 次未采用：${errors.at(-1)}`:`已完成 ${completed} 次请求`,i)
  }
  if(config.parallel){
    const results=await Promise.allSettled(challenges.map((_,i)=>run(i)))
    const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason
  }else{for(let i=0;i<challenges.length;i++)await run(i)}

  if(!accepted)throw new Error(errors[0]||'没有获得有效输出')
  return outputs
}
