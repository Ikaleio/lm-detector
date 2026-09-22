import { analyzeGlobalOutputs, countNumbers, hellingerFeature, orderedBlockFeature, parseNumbers } from './fingerprint-core.js'
import type { Analysis, Bank, Output } from './types'

type Vector = number[]
type Matrix = Vector[]
type Preprocessing = {mean:Vector;scale:Vector}[]
type Gaussian = {precision:Matrix;constant:number}
type FeatureBank = {feature_mean:Vector;feature_scale:Vector;nuisance_basis:Matrix;centroids:Matrix}
export interface SharedDetector {
  schema:'shared-detector-v1'
  source_run:string
  base_sha256:string
  verifier_sha256:string
  source_reference_sha256:string
  bank_built_at:string
  model_ids:string[]
  response_counts:number[]
  calibration_sha256?:string|null
  calibration?:null|{schema:'shared-confidence-v2';method:'ranking-temperature';tau:number;
    binding:{base_sha256:string;verifier_sha256:string;reference_sha256:string;model_ids:string[]};calibration_run:string}
  ranker:{head_params:Preprocessing;full_params:Preprocessing;lda_weights:Matrix;lda_bias:Vector;
    references:Matrix[];bank:{hellinger:FeatureBank;ordered_blocks:FeatureBank & {environment_centroids:Matrix[]}}}
  verifier:{preprocessing:Preprocessing;origin:Vector;basis:Matrix;unit_scale:number;mu:Vector;
    references:Matrix[];new_joint:Gaussian;candidates:{mean:Vector;same_joint:Gaussian;
    alternative_joint:Gaussian;same_single:Gaussian;alternative_single:Gaussian}[];
    model:{active_features:number[];mean:Vector;scale:Vector;weights:Vector;bias:number}}
}

const dot = (a:Vector,b:Vector) => a.reduce((sum,x,i)=>sum+x*b[i],0)
const mean = (a:Vector) => a.reduce((sum,x)=>sum+x,0)/a.length
const norm = (a:Vector) => {const n=Math.max(Math.sqrt(dot(a,a)),1e-12);return a.map(x=>x/n)}
const z = (a:Vector) => {const m=mean(a),s=Math.max(Math.sqrt(mean(a.map(x=>(x-m)**2))),1e-12);return a.map(x=>(x-m)/s)}
const columnMean = (a:Matrix) => a[0].map((_,i)=>mean(a.map(r=>r[i])))
const median = (a:Vector) => {const v=[...a].sort((x,y)=>x-y),i=Math.floor(v.length/2);return v.length%2?v[i]:(v[i-1]+v[i])/2}
const sigmoid = (score:number) => score>=0?1/(1+Math.exp(-score)):Math.exp(score)/(1+Math.exp(score))
const blocks = (n:Vector):Matrix => [hellingerFeature(countNumbers(n)),orderedBlockFeature(n)]
const transform = (b:Matrix,p:Preprocessing):Vector => b.flatMap((v,j)=>
  norm(v.map((x,i)=>(x-p[j].mean[i])/p[j].scale[i])).map(x=>x*Math.sqrt(j===0?.75:.25)))
const centered = (v:Vector,p:FeatureBank) => v.map((x,i)=>(x-p.feature_mean[i])/p.feature_scale[i])
const subtract = (v:Vector,b:Matrix) => {
  const coefficients=b.map(row=>dot(v,row))
  return v.map((x,i)=>x-b.reduce((sum,row,j)=>sum+coefficients[j]*row[i],0))
}
const referenceNorms=new WeakMap<Matrix,Vector>()
function nearest(x:Vector,references:Matrix):number {
  let norms=referenceNorms.get(references)
  if(!norms){norms=references.map(r=>dot(r,r));referenceNorms.set(references,norms)}
  const xx=dot(x,x)
  return mean(references.map((r,i)=>Math.max(0,xx+norms[i]-2*dot(x,r))).sort((a,b)=>a-b).slice(0,7))
}
function gaussian(x:Vector,mu:Vector,g:Gaussian):number {
  const delta=x.map((v,i)=>v-mu[i%mu.length])
  return g.constant-.5*dot(delta,g.precision.map(row=>dot(row,delta)))
}
function baseline(b:Matrix,bank:SharedDetector['ranker']['bank']):Vector {
  const h=bank.hellinger,o=bank.ordered_blocks
  const hUnit=norm(subtract(centered(b[0],h),h.nuisance_basis))
  const marginal=h.centroids.map(row=>dot(hUnit,row))
  const oCentered=centered(b[1],o),raw=norm(oCentered),projected=norm(subtract(oCentered,o.nuisance_basis))
  const templates=o.centroids.map((_,i)=>Math.max(...o.environment_centroids.map(rows=>dot(raw,rows[i]))))
  const nuisance=o.centroids.map(row=>dot(projected,row))
  const tz=z(templates),nz=z(nuisance),ordered=z(tz.map((v,i)=>.5*v+.5*nz[i])),mz=z(marginal)
  return mz.map((v,i)=>.5*v+.5*ordered[i])
}

export function supportsSharedDetector(bank:Bank,artifact:SharedDetector):boolean {
  return artifact.schema==='shared-detector-v1' && bank.built_at===artifact.bank_built_at &&
    bank.models.length===artifact.model_ids.length && bank.models.every((m,i)=>
      m.id===artifact.model_ids[i] && m.response_count===artifact.response_counts[i])
}

/** Calibrate closed-set rankings; otherwise return the uncalibrated verifier sigmoid. */
export function calibrateSharedScores(ranking:Vector,scores:Vector,artifact:SharedDetector) {
  const head=artifact.calibration,binding=head?.binding
  const calibrated=!!(head && binding && head.schema==='shared-confidence-v2' && head.method==='ranking-temperature' &&
    Number.isFinite(head.tau) && head.tau>=.001 && head.tau<=1000 &&
    binding.base_sha256===artifact.base_sha256 && binding.verifier_sha256===artifact.verifier_sha256 &&
    binding.reference_sha256===artifact.source_reference_sha256 && binding.model_ids.length===ranking.length &&
    ranking.length===artifact.model_ids.length && scores.length===ranking.length && ranking.every(Number.isFinite) &&
    binding.model_ids.every((id,i)=>id===artifact.model_ids[i]))
  if(!calibrated || !head)return {values:scores.map(sigmoid),calibrated:false}
  const logits=ranking.map(score=>head.tau*score)
  const maximum=Math.max(...logits),weights=logits.map(value=>Math.exp(value-maximum)),sum=weights.reduce((a,b)=>a+b,0)
  return {values:weights.map(value=>value/sum),calibrated:true}
}

function rankSharedNumbers(numbers:Matrix,artifact:SharedDetector) {
  const a=artifact.ranker,full=numbers.map(blocks)
  const ax=full.map(b=>transform(b,a.full_params))
  const lda=numbers.map(n=>{
    const x=transform(blocks(n.slice(0,128)),a.head_params)
    return z(a.lda_weights.map((row,i)=>dot(row,x)+a.lda_bias[i]))
  })
  const l=z(columnMean(lda)),near=z(a.references.map(ref=>median(ax.map(x=>-nearest(x,ref)))))
  const base=z(columnMean(full.map(b=>baseline(b,a.bank))))
  const ranking=l.map((x,i)=>.5*x+.25*near[i]+.25*base[i])
  if(!ranking.every(Number.isFinite))throw new Error('排名计算产生无效数值，请刷新后重试')
  return {ranking,full}
}

export function scoreSharedNumbers(numbers:Matrix,artifact:SharedDetector) {
  if(numbers.length!==3)throw new Error('共享核验器需要三条完整回答')
  const {ranking,full}=rankSharedNumbers(numbers,artifact)
  const v=artifact.verifier,vx=full.map(b=>transform(b,v.preprocessing))
  const projected=vx.map(x=>Array.from({length:v.mu.length},(_,j)=>
    x.reduce((sum,element,i)=>sum+(element-v.origin[i])*v.basis[i][j],0)/v.unit_scale))
  const flat=projected.flat(),newDensity=gaussian(flat,v.mu,v.new_joint)
  const features=v.candidates.map((c,i)=>{
    const same=gaussian(flat,c.mean,c.same_joint),alternative=gaussian(flat,c.mean,c.alternative_joint)
    const gains=projected.map(row=>alternative-gaussian(row,c.mean,c.alternative_single)-same+gaussian(row,c.mean,c.same_single))
    return [Math.log1p(median(vx.map(x=>nearest(x,v.references[i])))),same/24,(same-newDensity)/24,
      mean(gains)/16,(Math.max(...gains)-Math.min(...gains))/16,
      ranking[i]-Math.max(...ranking.filter((_,j)=>j!==i))]
  })
  const model=v.model
  const scores=features.map(row=>model.bias+model.active_features.reduce((sum,f,j)=>
    sum+(row[f]-model.mean[j])/model.scale[j]*model.weights[j],0))
  if(![...ranking,...scores,...features.flat()].every(Number.isFinite))throw new Error('核验计算产生无效数值，请刷新后重试')
  return {ranking,scores,features}
}

export function analyzeSharedOutputs(outputs:Output[],bank:Bank,artifact:SharedDetector,options:{allowPartial?:boolean}={}):Analysis {
  if(!supportsSharedDetector(bank,artifact)) {
    const old:Analysis=analyzeGlobalOutputs(outputs,bank)
    return {...old,probability:null,absolute_match:null,family_probability:null,
      results:old.results.map(r=>({model:r.model,display_name:r.display_name,family_name:r.family_name,score:r.score,
        probability:null,absolute_match:null,verification_score:null,verification_confidence:null,identity_probability:null})),
      family_probabilities:[],calibration:null,
      probability_status:'unavailable',verification_confidence:null,risk_certificate:null,
      decision:'not_confirmed',method:'custom-bank-legacy-ranking',
      evidence:{insufficient:true,label:'自定义库排名',reason:'当前参考库已变更，使用该库的传统排名。共享核验器尚未适配，身份概率不可用。',threshold:null,method:'custom-bank-legacy-ranking'}}
  }
  const parsed=outputs.map(o=>parseNumbers(o.text))
  const diagnostics=outputs.map((o,index)=>{
    const minimum=Math.max(80,Math.ceil((o.expected_count||0)*.55))
    const raw=Array.from(o.text.matchAll(/-?\d+/g),m=>Number(m[0]))
    return {index,parsed_numbers:parsed[index].length,minimum_numbers:minimum,
      accepted:parsed[index].length>=minimum,raw_out_of_range_count:raw.filter(n=>n<1||n>355).length}
  })
  const used=diagnostics.filter(d=>d.accepted).length
  const common={probability:null,absolute_match:null,family_probability:null,
    probability_status:'unavailable',verification_confidence:null,risk_certificate:null,
    used_outputs:used,diagnostics,method:'shared-detector-v1',
    model_version:{base_sha256:artifact.base_sha256,verifier_sha256:artifact.verifier_sha256}}
  if(options.allowPartial && used>0 && used<3 && outputs.length<=3) {
    const {ranking}=rankSharedNumbers(parsed.filter((_,i)=>diagnostics[i].accepted),artifact)
    const order=artifact.model_ids.map((_,i)=>i).sort((i,j)=>ranking[j]-ranking[i])
    const results=order.map(i=>({model:artifact.model_ids[i],display_name:bank.models[i].display_name,
      family_name:bank.models[i].family_name,score:ranking[i],verification_score:null,
      verification_confidence:null,probability:null,absolute_match:null,identity_probability:null}))
    const first=order[0]
    return {...common,method:'shared-ranker-partial-v1',decision:'partial',
      prediction:results[0].model,prediction_name:results[0].display_name,
      family_prediction:bank.models[first].family,family_prediction_name:bank.models[first].family_name,
      results,ranking_score:ranking[first],calibration:null,
      evidence:{insufficient:true,label:'部分样本排名',
        reason:`使用 ${used}/3 条有效回答生成排名。补齐三条有效回答后才能计算检验分数。`,
        threshold:null,method:'partial-sample-ranking'}}
  }
  if(outputs.length!==3 || used!==3)return {...common,prediction:'',prediction_name:'暂不可评分',
    family_prediction_name:'',results:[],decision:'unscorable',evidence:{insufficient:true,
      label:'需要三条完整回答',reason:`当前有 ${used}/${outputs.length} 条有效回答。请补齐原来的三条回答后重新检测。`,
      threshold:null,method:'complete-three-answers'}}
  const {ranking,scores,features}=scoreSharedNumbers(parsed,artifact)
  const confidence=calibrateSharedScores(ranking,scores,artifact)
  const order=artifact.model_ids.map((_,i)=>i).sort((i,j)=>ranking[j]-ranking[i])
  const results=order.map(i=>({model:artifact.model_ids[i],display_name:bank.models[i].display_name,
    family_name:bank.models[i].family_name,score:ranking[i],verification_score:scores[i],
    verification_confidence:confidence.values[i],
    verification_features:features[i],probability:confidence.calibrated?confidence.values[i]:null,absolute_match:null,
    identity_probability:confidence.calibrated?confidence.values[i]:null}))
  const first=order[0],top=scores.indexOf(Math.max(...scores)),agree=first===top
  return {...common,prediction:results[0].model,prediction_name:results[0].display_name,
    family_prediction:bank.models[first].family,family_prediction_name:bank.models[first].family_name,
    results,ranking_score:ranking[first],verification_score:scores[first],verification_top:artifact.model_ids[top],
    probability:confidence.calibrated?confidence.values[first]:null,
    probability_status:confidence.calibrated?'reference_calibrated':'unavailable',
    probability_scope:confidence.calibrated?'reference-closed-set':null,
    probability_top:artifact.model_ids[confidence.values.indexOf(Math.max(...confidence.values))],
    calibration:confidence.calibrated?{method:artifact.calibration!.method,run:artifact.calibration!.calibration_run,
      tau:artifact.calibration!.tau,sha256:artifact.calibration_sha256??null}:null,
    verification_confidence:results[0].verification_confidence,
    verification_confidence_method:confidence.calibrated?'ranking-temperature':'sigmoid-shared-logit',
    decision:'not_confirmed',evidence:{insufficient:true,label:agree?'排名与核验一致':'排名与核验存在分歧',
      reason:agree?'两个算法的第一候选一致。':
        `排名第一为 ${results[0].display_name}，核验分数最高为 ${bank.models[top].display_name}。候选顺序仍由排名分数决定。`,
      threshold:null,method:confidence.calibrated?'reference-calibrated-ranking':'uncalibrated-shared-verification'}}
}
