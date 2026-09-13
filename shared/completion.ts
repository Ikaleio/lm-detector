export type Format='openai'|'responses'|'anthropic'
const outputText=(response:any)=> (response.output||[]).filter((x:any)=>x.type==='message').flatMap((x:any)=>x.content||[]).filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join('')
export async function readCompletion(response:Response,format:Format,onText?:(text:string)=>void){
  if(!response.ok){let d:any;try{d=await response.json()}catch{throw new Error(`代理不可用（HTTP ${response.status}），请使用 Vercel 或本地预览服务`)}throw new Error(`HTTP ${response.status}：${d.error?.message||d.message||'请求失败'}`)}
  let text='',finish='',terminal=false,responseModel:string|undefined,responseId:string|undefined,usage:any
  const emit=(part:string)=>{text+=part;onText?.(text)}
  if(!response.headers.get('content-type')?.includes('text/event-stream')){
    let d:any;try{d=await response.json()}catch{throw new Error('接口未返回 JSON 或 SSE，请检查部署是否包含 API Function')}
    responseModel=d.model;responseId=d.id;usage=d.usage
    if(format==='responses'){text=outputText(d);finish=d.status;terminal=d.status==='completed'}
    else if(format==='anthropic'){text=(d.content||[]).filter((x:any)=>x.type==='text').map((x:any)=>x.text).join('');finish=d.stop_reason;terminal=true}
    else{const c=d.choices?.[0];text=c?.message?.content||'';finish=c?.message?.refusal?'refusal':c?.finish_reason;terminal=true}
    onText?.(text)
  }else{
    if(!response.body)throw new Error('接口未返回流式正文')
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer=''
    const event=(frame:string)=>{
      const payload=frame.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n')
      if(!payload)return
      if(payload.trim()==='[DONE]'){terminal=true;return}
      let d:any;try{d=JSON.parse(payload)}catch{throw new Error('流式数据不是有效的 JSON')}
      if(d.error||d.type==='error')throw new Error(String(d.error?.message||d.message||'上游流式调用失败'))
      if(d.model)responseModel=d.model;if(d.id)responseId=d.id;if(d.usage)usage=d.usage
      if(format==='openai'){
        const c=d.choices?.find((c:any)=>c.index===0)||d.choices?.[0]
        if(c?.delta?.refusal)finish='refusal'
        if(typeof c?.delta?.content==='string')emit(c.delta.content)
        if(c?.finish_reason)finish=c.finish_reason
      }else if(format==='anthropic'){
        if(d.type==='message_start'){responseModel=d.message?.model;responseId=d.message?.id;usage=d.message?.usage}
        if(d.type==='content_block_start'&&d.content_block?.type==='text'&&d.content_block.text)emit(d.content_block.text)
        if(d.type==='content_block_delta'&&d.delta?.type==='text_delta')emit(d.delta.text)
        if(d.type==='message_delta'){finish=d.delta?.stop_reason||finish;usage={...usage,...d.usage}}
        if(d.type==='message_stop')terminal=true
      }else{
        if(d.type==='response.output_text.delta')emit(d.delta||'')
        if(d.type==='response.output_item.done'&&!text){const fallback=outputText({output:[d.item]});if(fallback)emit(fallback)}
        if(d.type==='response.completed'){
          terminal=true;finish=d.response?.status||'completed';responseModel=d.response?.model||responseModel;responseId=d.response?.id||responseId;usage=d.response?.usage
          const full=outputText(d.response||{});if(full){text=full;onText?.(text)}
        }
        if(['response.failed','response.incomplete'].includes(d.type))throw Object.assign(new Error(d.response?.error?.message||'Responses 输出未完整结束'),{completionDetails:{finish:d.response?.status,reason:d.response?.incomplete_details,usage:d.response?.usage,responseId:d.response?.id,responseModel:d.response?.model}})
      }
    }
    try{
      while(true){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});let match:RegExpExecArray|null
        while(!terminal&&(match=/\r?\n\r?\n/.exec(buffer))){event(buffer.slice(0,match.index));buffer=buffer.slice(match.index+match[0].length)}
        if(terminal)break
        if(done){if(buffer.trim())event(buffer);break}
      }
    }finally{void reader.cancel().catch(()=>{});reader.releaseLock()}
  }
  if(['refusal','content_filter'].includes(finish))throw Object.assign(new Error('渠道拒绝了此请求'),{completionDetails:{finish,terminal,responseModel,responseId,usage}})
  if(!terminal||!['stop','end_turn','completed'].includes(finish)||!text)throw Object.assign(new Error('输出未完整结束，本条不计入检测或入库'),{completionDetails:{finish,terminal,responseModel,responseId,usage}})
  return {text,responseModel,responseId,usage}
}
