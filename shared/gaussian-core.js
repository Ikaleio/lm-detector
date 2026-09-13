import { countNumbers, hellingerFeature, orderedBlockFeature, parseNumbers } from './number-features.js';

export const CLASSIFIER_VERSION = 'gaussian-head128-r32-p05-v1';
export const CLASSIFIER_SPEC = { feature: 'head128', rank: 32, pooled_weight: 0.5 };
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const meanRows = rows => rows[0].map((_, i) => rows.reduce((sum, row) => sum + row[i], 0) / rows.length);

export function gaussianFeature(numbers, mode = 'head128') {
  if (mode !== 'full' && !/^head[1-9]\d*$/.test(mode)) throw new Error('不支持的高斯特征配置。');
  const sequence = mode === 'full' ? numbers : numbers.slice(0, Number(mode.slice(4)));
  return [...hellingerFeature(countNumbers(sequence)), ...orderedBlockFeature(sequence)];
}

export function scoreGaussianFeature(feature, artifact) {
  const z = feature.map((value, i) => (value - artifact.mean[i]) / artifact.scale[i] * artifact.block_weights[i]);
  const distances = artifact.centers.map((center, model) => {
    const delta = z.map((value, i) => value - center[i]);
    const projected = artifact.components.map(component => dot(delta, component));
    const residual = Math.max(0, dot(delta, delta) - dot(projected, projected));
    const quadratic = projected.reduce((sum, value, i) => sum + value * dot(artifact.inverses[model][i], projected), 0);
    return quadratic + residual / (artifact.residual_variances?.[model] ?? artifact.residual_variance);
  });
  return { distances, scores: distances.map((distance, i) => -.5 * (distance + artifact.log_dets[i])) };
}

export function analyzeGaussianOutputs(outputs, bank) {
  const artifact = bank.classifier;
  if (![CLASSIFIER_VERSION, 'gaussian-tuned-v2', 'gaussian-covariance-v3'].includes(artifact.version) || artifact.model_ids.length !== bank.models.length ||
      artifact.model_ids.some((id, i) => id !== bank.models[i].id)) {
    throw new Error('分类器版本或模型顺序不匹配，请重新建库。');
  }
  const valid = [], diagnostics = [];
  outputs.forEach((output, index) => {
    const numbers = parseNumbers(output.text || '');
    const minimum = Math.max(80, Math.ceil(Number(output.expected_count || 0) * .55));
    const accepted = numbers.length >= minimum;
    diagnostics.push({ index, parsed_numbers: numbers.length, minimum_numbers: minimum, accepted });
    if (accepted) valid.push(scoreGaussianFeature(gaussianFeature(numbers, artifact.spec.feature), artifact));
  });
  if (!valid.length) throw new Error('没有可用回答：请粘贴完整数字序列；拒答或严重截断的回答不会计入。');
  const scores = meanRows(valid.map(row => row.scores)), distances = meanRows(valid.map(row => row.distances));
  const key = String(Math.min(3, valid.length)), config = bank.calibration[key];
  const best = Math.max(...scores);
  const weights = scores.map(score => Math.exp(config.beta * (score - best)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  const tuned = ['gaussian-tuned-v2', 'gaussian-covariance-v3'].includes(artifact.version);
  const calibrated = !config.fallback && (tuned
    ? config.distance_scales?.length === bank.models.length && config.distance_scales.every(value => Number.isFinite(value) && value > 0) &&
      config.distance_limits?.length === bank.models.length && config.distance_limits.every(value => Number.isFinite(value) && value > 0) &&
      config.confidence_model?.coefficients?.length === 3 && config.confidence_model?.mean?.length === 2 && config.confidence_model?.scale?.length === 2
    : Number.isFinite(config.distance_limit) && Number.isFinite(config.ambiguity_limit));
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  let confidence = null;
  if (tuned && calibrated) {
    const model = config.confidence_model;
    const input = [-Math.log(Math.max(distances[order[0]] / config.distance_scales[order[0]], 1e-8)),
      Math.log1p(Math.max((scores[order[0]] - scores[order[1]]) * config.beta, 0))];
    const logit = model.coefficients[0] + input.reduce((sum, value, i) => sum + (value - model.mean[i]) / model.scale[i] * model.coefficients[i + 1], 0);
    confidence = logit >= 0 ? 1 / (1 + Math.exp(-logit)) : Math.exp(logit) / (1 + Math.exp(logit));
  }
  const candidateSet = tuned ? [bank.models[order[0]].id] : bank.models.filter((_, i) => calibrated && distances[i] <= config.distance_limit && best - scores[i] <= config.ambiguity_limit).map(model => model.id);
  const results = bank.models.map((model, i) => ({
    model: model.id, display_name: model.display_name, family: model.family || 'models', family_name: model.family_name || '其他',
    score: scores[i], probability: weights[i] / total, gaussian_distance: distances[i],
    distance_ratio: calibrated ? distances[i] / (tuned ? config.distance_limits[i] : config.distance_limit) : null,
    in_candidate_set: candidateSet.includes(model.id),
  })).sort((a, b) => b.score - a.score);
  const top = results[0];
  const state = !calibrated ? 'uncalibrated' : tuned ? confidence >= .9 ? 'supported' : confidence <= .1 ? 'outside' : 'ambiguous' : candidateSet.length === 0 ? 'outside' :
    candidateSet.length === 1 && candidateSet[0] === top.model ? 'supported' : 'ambiguous';
  const labels = { uncalibrated: '参考校准不足', outside: '超出参考支持范围', supported: '参考数据支持单一候选', ambiguous: '候选存在歧义' };
  const reasons = {
    uncalibrated: '参考数据缺少可用的留出组；仅展示候选排名。',
    outside: '没有候选同时满足参考距离与区分条件；保留排名供查看。',
    supported: '第一候选是唯一同时满足参考距离与区分条件的模型；这不构成后端身份认证。',
    ambiguous: '当前回答不能确定单一候选；保留排名供查看。',
  };
  if (tuned) {
    labels.supported = '校准置信度达到高置信门槛';
    labels.outside = '校准置信度较低';
    labels.ambiguous = '校准置信度未达到高置信门槛';
    reasons.supported = '置信度达到 90%；校准使用真实已知回答和整类留出的未知回答，不构成后端身份认证。';
    reasons.outside = '置信度不高于 10%；保留最高似然候选供查看。';
    reasons.ambiguous = '置信度处于 10% 与 90% 之间；保留排名和分数。';
  }
  const familyIds = [...new Set(results.map(row => row.family))];
  const families = familyIds.map(family => ({ family, display_name: results.find(row => row.family === family).family_name,
    probability: results.filter(row => row.family === family).reduce((sum, row) => sum + row.probability, 0) }));
  const family = [...families].sort((a, b) => b.probability - a.probability)[0];
  results.forEach(row => { row.conditional_probability = row.probability / (families.find(f => f.family === row.family).probability || 1); });
  return {
    prediction: top.model, prediction_name: top.display_name, probability: top.probability,
    confirmed_prediction: state === 'supported' ? top.model : null, distance_ratio: top.distance_ratio,
    ...(tuned ? { confidence } : {}),
    candidate_set: candidateSet, results, used_outputs: valid.length, diagnostics,
    evidence: { insufficient: state !== 'supported', state, label: labels[state], reason: reasons[state], method: artifact.version,
      distance_limit: tuned ? config.distance_limits?.[order[0]] : config.distance_limit, ambiguity_limit: config.ambiguity_limit,
      ...(tuned ? { confidence, high_threshold: .9, low_threshold: .1 } : {}) },
    calibration: { queries: key, ...config }, method: '正则化高斯数字指纹',
    family_prediction: family.family, family_prediction_name: family.display_name, family_probability: family.probability, family_probabilities: families,
  };
}
