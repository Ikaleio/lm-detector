"""Reference-fitted ensemble ranker for verifier fitting and calibration."""
import numpy as np
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.preprocessing import normalize
from bank_builder import fit_robust_artifacts
from fingerprint import hellinger_feature, ordered_block_feature, count_numbers


def z(x):
    return (x-x.mean(axis=-1,keepdims=True))/np.maximum(x.std(axis=-1,keepdims=True),1e-12)

def feature_blocks(numbers):
    def block(ns):
        return [np.stack([hellinger_feature(count_numbers(n)) for n in ns]),np.stack([ordered_block_feature(n) for n in ns])]
    return {'full':block(numbers),'head':block([n[:128] for n in numbers])}

def fit_transform(blocks):
    params=[];parts=[]
    for x,w in zip(blocks,(.75,.25)):
        mean=x.mean(axis=0);scale=x.std(axis=0);scale[scale<1e-10]=1
        params.append(dict(mean=mean,scale=scale))
        parts.append(normalize((x-mean)/scale)*np.sqrt(w))
    return np.concatenate(parts,axis=1),params

def transform(blocks,params):
    return np.concatenate([normalize((x-p['mean'])/p['scale'])*np.sqrt(w) for x,p,w in zip(blocks,params,(.75,.25))],axis=1)

def bank_components(blocks,bank):
    h=bank['hellinger'];o=bank['ordered_blocks']
    zh=(blocks[0]-h['feature_mean'])/h['feature_scale'];bh=np.asarray(h['nuisance_basis'])
    if bh.size:zh-=zh@bh.T@bh
    marginal=normalize(zh)@np.array(h['centroids']).T
    zo=(blocks[1]-o['feature_mean'])/o['feature_scale'];unit=normalize(zo)
    templates=np.max(np.stack([unit@np.asarray(c).T for c in o['environment_centroids']]),axis=0)
    bo=np.asarray(o['nuisance_basis'])
    if bo.size:zo-=zo@bo.T@bo
    nuisance=normalize(zo)@np.asarray(o['centroids']).T
    ordered=z(.5*z(templates)+.5*z(nuisance))
    absolute=.75*marginal+.25*(templates+nuisance)/2
    return .5*z(marginal)+.5*ordered,absolute

class Ensemble:
    def __init__(self,rows,ids):
        self.ids=ids;self.rows=rows
        labels=np.array([ids.index(r['source']) for r in rows]);self.labels=labels
        blocks=feature_blocks([r['numbers'] for r in rows])
        head,self.head_params=fit_transform(blocks['head'])
        self.full,self.full_params=fit_transform(blocks['full'])
        self.lda=LinearDiscriminantAnalysis(solver='lsqr',shrinkage=.05,priors=np.full(len(ids),1/len(ids))).fit(head,labels)
        self.bank=fit_robust_artifacts(rows,ids)
    def single(self,numbers):
        blocks=feature_blocks(numbers)
        l=self.lda.decision_function(transform(blocks['head'],self.head_params))
        x=transform(blocks['full'],self.full_params)
        distances=np.maximum(0,np.sum(x*x,axis=1)[:,None]+np.sum(self.full*self.full,axis=1)[None,:]-2*x@self.full.T)
        near=np.stack([-np.sort(distances[:,self.labels==i],axis=1)[:,:7].mean(axis=1) for i in range(len(self.ids))],axis=1)
        base,absolute=bank_components(blocks['full'],self.bank)
        return dict(lda=l,neighbors=near,base=base,absolute=absolute)
    @staticmethod
    def group(single,slots):
        def slot_mean(x):return np.stack([x[idx].mean(axis=0) for idx in slots])
        l=slot_mean(z(single['lda'])).mean(axis=0)
        near=np.median(slot_mean(single['neighbors']),axis=0)
        base=slot_mean(single['base']).mean(axis=0)
        scores=.5*z(l[None,:])[0]+.25*z(near[None,:])[0]+.25*z(base[None,:])[0]
        absolute=slot_mean(single['absolute']).mean(axis=0)
        return scores,float(absolute.max())
    def score_groups(self,groups):
        numbers=[n for g in groups for n in g];single=self.single(numbers);output=[];start=0
        for g in groups:
            slots=[[i] for i in range(start,start+len(g))];start+=len(g)
            output.append(self.group(single,slots))
        return output

