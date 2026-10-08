import type { Throughput } from './throughput'
import type { ServiceTier } from './completion-request'
import type { UsageObservation } from './usage-fit'
export interface Challenge { id:string; expected_count:number; prompt:string }
export interface BankModel {id:string;display_name:string;family:string;family_name:string;response_count:number;valid_number_count:number;counts:number[];frequency_references?:number[][];sources:Record<string,number>;conditions:Record<string,number>;nearest_models?:{model:string;distance:number}[]}
export interface Bank {schema:string;built_at:string;models:BankModel[];sources:Record<string,number>;reference_sha256?:string;robust:any;calibration:Record<string,{beta:number;cv_accuracy:number|null;[key:string]:unknown}>;[key:string]:unknown}
export interface Analysis {prediction:string;prediction_name:string;probability:number|null;absolute_match:number|null;evidence:{insufficient:boolean;label:string;reason:string;threshold:number|null;method:string};used_outputs:number;results:{model:string;display_name:string;family:string;family_name:string;probability:number|null;absolute_match:number|null;score:number;identity_probability?:number|null}[];diagnostics:{index:number;parsed_numbers:number;minimum_numbers:number;accepted:boolean}[];family_prediction_name:string;family_probability:number|null;ranking_score?:number;decision?:string;[key:string]:unknown}
export interface Output {text:string;expected_count:number}
export interface ApiConfig {baseUrl:string;apiKey:string;model:string;effort:string;format:'openai'|'responses'|'anthropic';serviceTier?:ServiceTier;stream?:boolean;parallel?:boolean;relaxed?:boolean}
export type SampleState='pending'|'requesting'|'streaming'|'done'|'capped'|'rejected'|'stopped'
export type ErrorCode='invalid_base_url'|'aborted'|'timeout'|'network'|'direct_network'|'http'|'proxy_unavailable'|'not_json'|'no_stream_body'|'bad_stream_json'|'upstream_stream_error'|'refused'|'incomplete'|'insufficient_numbers'|'no_output'|'responses_incomplete'|'no_usage'|'proxy_missing'|'upstream_not_api'
export interface CodedError extends Error {code?:ErrorCode;httpStatus?:number;completionDetails?:unknown}
export interface CollectionProgress {completed:number;total:number;accepted:number;message:string;text?:string;challengeIndex?:number;challenges?:{text:string;status:string;state?:SampleState;error?:string;errorCode?:ErrorCode;httpStatus?:number;throughput?:Throughput;usage?:UsageObservation}[];outputs?:Output[]}
