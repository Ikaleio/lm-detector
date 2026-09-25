import { mkdir, writeFile } from 'node:fs/promises'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CompletionTransport } from '@fingerpoint/shared/detection'

/** Save request bodies and response bytes, never authentication headers. */
export async function traceTransport(directory:string,transport:CompletionTransport):Promise<CompletionTransport> {
  await mkdir(directory,{recursive:true})
  let index=0
  return async(url,config,body,signal)=>{
    const prefix=join(directory,`attempt-${++index}`)
    await writeFile(prefix+'.request.json',JSON.stringify({url,body,started_at:new Date().toISOString()},null,2)+'\n',{mode:0o600,flag:'wx'})
    let response:Response
    try{response=await transport(url,config,body,signal)}
    catch(error){
      const raw=error instanceof Error?error.message:String(error)
      const message=config.apiKey?raw.replaceAll(config.apiKey,'[REDACTED]'):raw
      await writeFile(prefix+'.error.json',JSON.stringify({message})+'\n',{mode:0o600})
      throw new Error(message)
    }
    await writeFile(prefix+'.response.json',JSON.stringify({status:response.status,content_type:response.headers.get('content-type'),request_id:response.headers.get('x-request-id')},null,2)+'\n',{mode:0o600})
    if(!response.body)return response
    await writeFile(prefix+'.body.txt','',{mode:0o600})
    const reader=response.body.getReader()
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller){
        try{
          const next=await reader.read()
          if(next.done){controller.close();return}
          appendFileSync(prefix+'.body.txt',next.value)
          controller.enqueue(next.value)
        }catch(error){controller.error(error)}
      },
      cancel(reason){return reader.cancel(reason)},
    }),{status:response.status,headers:response.headers})
  }
}
