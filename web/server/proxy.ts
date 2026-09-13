import type { IncomingMessage, ServerResponse } from 'node:http'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { once } from 'node:events'

const privateAddress = (ip:string) => {
  if(isIP(ip)===6)return !ip.toLowerCase().startsWith('2')&&!ip.toLowerCase().startsWith('3')
  const [a,b]=ip.split('.').map(Number)
  return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||a===198&&[18,19].includes(b)
}
const reply=(res:ServerResponse,status:number,message:string)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:{message}}))}
export async function proxy(req:IncomingMessage & {body?:any},res:ServerResponse){
  if(req.method!=='POST'){reply(res,405,'请使用 POST 请求');return}
  if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host){reply(res,403,'仅接受本站请求');return}}catch{reply(res,403,'无效来源');return}}
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),240000)
  res.on('close',()=>{if(!res.writableEnded)controller.abort()})
  try{
    let data=req.body
    if(data===undefined){let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>262144)throw new Error('请求内容过长')}data=JSON.parse(raw)}
    if(typeof data==='string')data=JSON.parse(data)
    const {url,apiKey,format,body}=data||{}
    if(typeof apiKey!=='string'||!apiKey.trim()||!['openai','responses','anthropic'].includes(format)||!body||typeof body.model!=='string')throw new Error('缺少 API 密钥、模型或端点类型')
    const target=new URL(url)
    if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||(target.port&&target.port!=='443'))throw new Error('上游必须使用公网 HTTPS 地址')
    const suffix={openai:'/chat/completions',responses:'/responses',anthropic:'/messages'}[format as string]!
    if(!target.pathname.endsWith(suffix))throw new Error('端点路径与选择的类型不一致')
    const addresses=await lookup(target.hostname,{all:true})
    if(!addresses.length||addresses.some(a=>privateAddress(a.address)))throw new Error('不支持转发到本机或内网地址')
    const headers:Record<string,string>={'Content-Type':'application/json','Accept':body.stream?'text/event-stream':'application/json'}
    if(format==='anthropic'){headers['x-api-key']=apiKey;headers['anthropic-version']='2023-06-01'}else headers.Authorization='Bearer '+apiKey
    const upstream=await fetch(target,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,redirect:'error'})
    if(!upstream.ok){const raw=(await upstream.text()).replaceAll(apiKey,'[REDACTED]').replace(/\bsk-[\w-]+/g,'[REDACTED]');let message=raw;try{const d=JSON.parse(raw);message=d.error?.message||d.message||raw}catch{}reply(res,upstream.status,String(message).slice(0,500));return}
    res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'})
    res.flushHeaders()
    if(upstream.body){for await(const chunk of upstream.body){if(controller.signal.aborted)break;if(!res.write(chunk))await once(res,'drain',{signal:controller.signal})}}
    res.end()
  }catch(error){if(!res.headersSent)reply(res,controller.signal.aborted?504:400,controller.signal.aborted?'上游请求超时或已取消':error instanceof Error&&['上游必须','缺少','端点路径','不支持','请求内容'].some(x=>error.message.startsWith(x))?error.message:'代理请求失败，请检查上游地址、网络和请求格式');else res.destroy()}
  finally{clearTimeout(timer)}
}
