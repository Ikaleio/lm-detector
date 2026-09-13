import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CompletionTransport } from '@fingerpoint/shared/detection'

export const CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'

export function codexRequest(body: Record<string, unknown>) {
  const { max_output_tokens: _limit, ...request } = body
  return { ...request, instructions: typeof body.instructions === "string" ? body.instructions : "" }
}

/** Read the local login only for the fixed Codex endpoint. Never persist credentials. */
export async function codexTransport(traceDirectory?:string):Promise<CompletionTransport> {
  const auth:unknown = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(),'.codex'),'auth.json'),'utf8'))
  if (!auth || typeof auth!=='object' || !('tokens' in auth) || !auth.tokens || typeof auth.tokens!=='object') throw new Error('本机没有可用的 Codex ChatGPT 登录')
  const tokens = auth.tokens
  if (!('access_token' in tokens) || typeof tokens.access_token!=='string' || !tokens.access_token) throw new Error('本机 Codex 登录缺少 access_token')
  const accessToken=tokens.access_token
  const accountId='account_id' in tokens && typeof tokens.account_id==='string' ? tokens.account_id : undefined
  if(traceDirectory) await mkdir(traceDirectory,{recursive:true})
  let index=0
  return async (url,config,body,signal) => {
    if(url!==CODEX_ENDPOINT || config.format!=='responses' || body.stream!==true) throw new Error('Codex 登录只支持固定官方端点和 Responses 流式请求')
    const request = codexRequest(body)
    const prefix=traceDirectory ? join(traceDirectory,`attempt-${++index}`) : undefined
    if(prefix) await writeFile(prefix+'.request.json',JSON.stringify({url,body:request,adaptations:['omit max_output_tokens (Codex endpoint)','preserve instructions; default to empty'],started_at:new Date().toISOString()},null,2)+'\n',{mode:0o600,flag:'wx'})
    const headers:Record<string,string>={'Content-Type':'application/json',Accept:'text/event-stream',Authorization:'Bearer '+accessToken,originator:'codex_cli_rs'}
    if(accountId) headers['chatgpt-account-id']=accountId
    let response:Response
    try { response=await fetch(url,{method:'POST',headers,body:JSON.stringify(request),signal,redirect:'error'}) }
    catch(error) {
      const message=(error instanceof Error?error.message:String(error)).replaceAll(accessToken,'[REDACTED]')
      if(prefix) await writeFile(prefix+'.error.json',JSON.stringify({message})+'\n',{mode:0o600})
      throw new Error(message)
    }
    if(prefix) await writeFile(prefix+'.response.json',JSON.stringify({status:response.status,request_id:response.headers.get('x-request-id'),content_type:response.headers.get('content-type')},null,2)+'\n',{mode:0o600})
    const responseHeaders=new Headers(response.headers)
    if(response.ok && !responseHeaders.has('content-type')) responseHeaders.set('content-type','text/event-stream')
    if(!prefix || !response.body) return new Response(response.body,{status:response.status,headers:responseHeaders})
    await writeFile(prefix+'.body.txt','',{mode:0o600})
    const reader=response.body.getReader()
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next=await reader.read()
          if(next.done){controller.close();return}
          appendFileSync(prefix+'.body.txt',next.value)
          controller.enqueue(next.value)
        }catch(error){controller.error(error)}
      },
      cancel(reason){return reader.cancel(reason)},
    }),{status:response.status,headers:responseHeaders})
  }
}
