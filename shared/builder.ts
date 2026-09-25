import { Matrix, SingularValueDecomposition } from 'ml-matrix'
import { countNumbers, hellingerFeature, orderedBlockFeature, parseNumbers, robustScoreNumbers } from './fingerprint-core.js'
import type { Bank } from './types'
import type { ReferenceBatch } from './reference'

type Prepared = { source:string; family_id:string; family_name:string; channel:string; condition_id:string; challenge_id:string; numbers:number[]; counts:number[]; h:number[]; o:number[] }
const avg = (xs:number[]) => xs.reduce((a,b)=>a+b,0)/xs.length
const dot = (a:number[],b:number[]) => a.reduce((s,x,i)=>s+x*b[i],0)
const unit = (a:number[]) => { const n=Math.max(Math.sqrt(dot(a,a)),1e-12);return a.map(x=>x/n) }
const meanRows = (a:number[][]) => a[0].map((_,i)=>avg(a.map(x=>x[i])))
const counts = (a:string[]) => {const d:Record<string,number>={};for(const x of a)d[x]=(d[x]||0)+1;return d}
function featureFit(features:number[][], rows:Prepared[], nuisance:string[], complete:string[]) {
  const mean=meanRows(features)
  const scale=mean.map((m,i)=>Math.sqrt(avg(features.map(f=>(f[i]-m)**2)))||1)
  const z=features.map(f=>f.map((x,i)=>(x-mean[i])/scale[i]))
  const offsets=nuisance.map(e=>meanRows(z.filter((_,i)=>rows[i].condition_id===e&&complete.includes(rows[i].condition_id))))
  let basis:number[][]=[]
  if(offsets.length>1){
    const center=meanRows(offsets), matrix=offsets.map(f=>f.map((x,i)=>x-center[i]))
    const svd=new SingularValueDecomposition(new Matrix(matrix),{autoTranspose:true})
    const singular=svd.diagonal,rank=Math.min(2,singular.filter(x=>x>singular[0]*1e-8).length)
    basis=Array.from({length:rank},(_,i)=>svd.rightSingularVectors.getColumn(i))
  }
  const projected=z.map(f=>{const v=f.slice();for(const b of basis){const d=dot(f,b);for(let i=0;i<v.length;i++)v[i]-=d*b[i]}return v})
  return {mean,scale,z,projected,basis}
}
function fit(rows:Prepared[], models:string[]) {
  const envs=[...new Set(rows.map(r=>r.condition_id))].sort()
  const complete=envs.filter(e=>new Set(rows.filter(r=>r.condition_id===e).map(r=>r.source)).size===models.length)
  const nuisance=[...new Set(rows.filter(r=>complete.includes(r.condition_id)).map(r=>r.condition_id))].sort()
  const h=featureFit(rows.map(r=>r.h),rows,nuisance,complete),o=featureFit(rows.map(r=>r.o),rows,nuisance,complete)
  const centers=(values:number[][])=>models.map(m=>unit(meanRows(values.filter((_,i)=>rows[i].source===m))))
  return {model_order:models,robust_ready:!!complete.length,training_rows:rows.length,complete_environments:complete,
    hellinger:{feature_mean:h.mean,feature_scale:h.scale,nuisance_rank:h.basis.length,nuisance_environments:nuisance,nuisance_basis:h.basis,centroids:centers(h.projected)},
    ordered_blocks:{weight:0.25,feature:'four position blocks x 16 value bins plus final-digit distribution',feature_mean:o.mean,feature_scale:o.scale,nuisance_rank:o.basis.length,nuisance_basis:o.basis,centroids:centers(o.projected),environment_centroids:[null,...complete].map(e=>models.map(m=>unit(meanRows(o.z.filter((_,i)=>rows[i].source===m && (e===null||rows[i].condition_id===e))))))}}
}
function combinations<T>(items:T[],n:number):T[][] { if(!n)return [[]];return items.flatMap((x,i)=>combinations(items.slice(i+1),n-1).map(rest=>[x,...rest])) }
function calibrate(records:{scores:number[];truth:number}[]) {
  if(!records.length)return {beta:1,cv_accuracy:null,cv_samples:0,cv_correct:0,cv_nll:null,fallback:true}
  let best=Infinity,beta=1
  for(let step=0;step<=800;step++){
    const b=Math.exp(Math.log(.05)+step*(Math.log(12)-Math.log(.05))/800)
    const loss=avg(records.map(({scores,truth})=>{const scaled=scores.map(x=>x*b),max=Math.max(...scaled);return max+Math.log(scaled.reduce((sum,x)=>sum+Math.exp(x-max),0))-scaled[truth]}))
    if(loss<best){best=loss;beta=b}
  }
  const correct=records.filter(r=>r.scores.indexOf(Math.max(...r.scores))===r.truth).length
  return {beta,cv_accuracy:correct/records.length,cv_samples:records.length,cv_correct:correct,cv_nll:best,fallback:false}
}
export function buildBank(input:ReferenceBatch[],progress:(message:string)=>void=()=>{}):Bank {
  if(!input.some(batch=>batch.samples.length))throw new Error('统一库至少需要一条有效样本')
  if(input.some(batch=>batch.purpose!=='reference'))throw new Error('测试集不能用于建库或校准')
  const rows:Prepared[]=[]
  for(const batch of input)for(const sample of batch.samples){
    const numbers=parseNumbers(sample.text),c=countNumbers(numbers)
    rows.push({source:batch.model.id,family_id:batch.model.family,family_name:batch.model.family_name,channel:sample.actual_channel??batch.source.channel,condition_id:sample.condition,challenge_id:sample.challenge_id,numbers,counts:c,h:hellingerFeature(c),o:orderedBlockFeature(numbers)})
  }
  const models=[...new Set(rows.map(r=>r.source))]
  const robust=fit(rows,models)
  const calibration:Bank['calibration']={}
  for(const n of [1,2,3]){
    progress(`Fitting calibration for ${n} response${n === 1 ? '' : 's'}`)
    const records:{scores:number[];truth:number}[]=[]
    for(const condition of [...new Set(rows.map(r=>r.condition_id))].sort()){
      const challenges=[...new Set(rows.filter(r=>r.condition_id===condition).map(r=>r.challenge_id))].sort().filter(id=>models.every(m=>rows.some(r=>r.source===m&&r.challenge_id===id)))
      // Match the offline builder: hold out every source/variant of a challenge.
      for(const ids of combinations(challenges,n)){
        const selected=new Set(ids),train=rows.filter(r=>!selected.has(r.challenge_id))
        if(models.some(m=>!train.some(r=>r.source===m)))continue
        const artifact=fit(train,models)
        models.forEach((model,truth)=>{
          const held=rows.filter(r=>r.source===model&&selected.has(r.challenge_id))
          if(held.length!==n)return
          const scores=held.map(r=>robustScoreNumbers(r.numbers,{robust:artifact}))
          records.push({truth,scores:models.map((_,i)=>avg(scores.map(s=>s[i])))})
        })
      }
    }
    calibration[String(n)]=calibrate(records)
  }
  return {schema:'robust-number-fingerprint-bank',built_at:new Date().toISOString(),method:{name:'Ordered-block + nuisance-Hellinger',range:[1,355],alpha:.5,ordered_block_weight:.25},sources:counts(rows.map(r=>r.channel)),recommended_queries:3,minimum_valid_numbers:80,models:models.map(id=>{const selected=rows.filter(r=>r.source===id);return {id,display_name:id,family:selected[0].family_id||'other',family_name:selected[0].family_name||'其他',response_count:selected.length,valid_number_count:selected.reduce((n,r)=>n+r.numbers.length,0),frequency_references:selected.map(r=>r.counts),counts:selected[0].counts.map((_,i)=>selected.reduce((n,r)=>n+r.counts[i],0)),sources:counts(selected.map(r=>r.channel)),conditions:counts(selected.map(r=>r.condition_id))}}),robust,calibration}
}
