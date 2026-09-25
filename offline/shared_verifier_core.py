"""Reference-panel candidate features and the shared verifier fit."""

import re

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

FEATURES = ['distance', 'same_density', 'identity_ratio', 'residual_mean',
            'residual_span', 'rank_margin']


def json_default(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(type(value).__name__)


def reference_panel(rows, ids):
    first = {}
    for row in rows:
        first.setdefault((row['source'], row.get('challenge_id')), row)
    panel = []
    for label in ids:
        for environment in range(1, 13):
            queries = [f'query-{i:02d}' for i in range(3 * environment - 2, 3 * environment + 1)]
            members = [first.get((label, query)) for query in queries]
            if any(row is None for row in members):
                raise ValueError(f'Missing reference challenge: {label}, environment {environment}')
            condition = f'environment-{environment:02d}'
            if any(not re.fullmatch(rf'{condition}(?:-[pe][0-9a-f]{{12}})?(?::.*)?', row['condition_id']) for row in members):
                raise ValueError(f'Reference condition mismatch: {label}, {condition}')
            panel.append(dict(id=f'{label}:{condition}', model=label, environment=environment,
                row_ids=[row['row_id'] for row in members],
                recorded_conditions=[row['condition_id'] for row in members],
                reasoning_efforts=[row.get('reasoning_effort', 'default') for row in members]))
    return panel


def extract_group(verifier, ranker, group):
    ids = verifier.ids
    if ids != ranker.ids:
        raise ValueError('Ranker/verifier gallery order mismatch')
    numbers = group['numbers']
    record = {k: v for k, v in group.items() if k != 'numbers'}
    record.update(gallery_ids=ids, valid_answers=len(numbers),
        scorable=bool(group['complete'] and len(numbers) == 3
                      and all(len(n) >= 80 and all(1 <= x <= 355 for x in n) for n in numbers)))
    if not record['scorable']:
        return record | dict(prediction=None, correct=None, known=group.get('truth') in ids,
                             candidates=[], reason='incomplete_or_invalid_three_answer_group')
    ranking, _ = ranker.score_groups([numbers])[0]
    raw = verifier.score(numbers)
    order = np.argsort(-ranking, kind='stable')
    candidate_rows = []
    for index, label in enumerate(ids):
        value = raw[label]['scales']['1.0']
        gains = np.asarray(value['gains'])
        vector = [np.log1p(raw[label]['distance']), value['log_same'] / 24,
                  value['log_bayes'] / 24, gains.mean() / 16,
                  np.ptp(gains) / 16, ranking[index] - np.max(np.delete(ranking, index))]
        if len(gains) != 3 or not np.isfinite(vector).all():
            raise ValueError('Non-finite candidate features or missing rotations')
        candidate_rows.append(dict(model=label, ranking_score=float(ranking[index]),
            features=np.asarray(vector).tolist(), evidence=dict(distance=raw[label]['distance'], **value)))
    prediction = ids[int(order[0])]
    known = group.get('truth') in ids
    truth_rank = int(np.flatnonzero(order == ids.index(group['truth']))[0]) + 1 if known else None
    return record | dict(prediction=prediction, correct=prediction == group.get('truth'),
        known=known, truth_rank=truth_rank, rank_order=order.tolist(), candidates=candidate_rows)


def training_pairs(record, masked=False):
    candidates = record['candidates']
    wrong = [i for i, c in enumerate(candidates) if masked or c['model'] != record['truth']]
    hard = max(wrong, key=lambda i: candidates[i]['ranking_score'])
    negative_weights = {i: .5 / (len(wrong) - 1) for i in wrong}
    negative_weights[hard] = .5
    result = []
    for i, c in enumerate(candidates):
        positive = not masked and c['model'] == record['truth']
        weight = .5 if positive else .25 * negative_weights[i]
        result.append(dict(parent_query=record['id'], row_ids=record['row_ids'],
            view='masked' if masked else 'registered', candidate=c['model'],
            target=int(positive), weight=weight, hard_negative=not positive and i == hard,
            features=c['features'], ranking_score=c['ranking_score'],
            base_object=record['base_object']))
    return result


def gradient_audit(objective, point):
    _, analytic = objective(point)
    numeric = []
    for index in range(len(point)):
        shift = np.zeros(len(point)); shift[index] = 1e-5
        numeric.append((objective(point + shift)[0] - objective(point - shift)[0]) / 2e-5)
    error = float(np.max(np.abs(analytic - numeric)))
    if error > 1e-6:
        raise ValueError('Objective gradient arithmetic mismatch')
    return error


def fit_verifier(pairs, active, penalty=.1):
    x = np.asarray([r['features'] for r in pairs])[:, active]
    y = np.asarray([r['target'] for r in pairs])
    weight = np.asarray([r['weight'] for r in pairs]); weight /= weight.sum()
    mean = weight @ x
    scale = np.sqrt(weight @ ((x - mean) ** 2)); scale[scale < 1e-8] = 1
    z = (x - mean) / scale

    def objective(theta):
        logits = z @ theta[:-1] + theta[-1]
        residual = weight * (expit(logits) - y)
        loss = weight @ (np.logaddexp(0, logits) - y * logits) + penalty / 2 * (theta[:-1] @ theta[:-1])
        gradient = np.r_[z.T @ residual + penalty * theta[:-1], residual.sum()]
        return float(loss), gradient

    fitted = minimize(objective, np.zeros(len(active) + 1), jac=True, method='L-BFGS-B',
        options=dict(maxiter=2000, gtol=1e-7, ftol=1e-12))
    return dict(schema_version=1, active_features=active, feature_names=[FEATURES[i] for i in active],
        mean=mean, scale=scale, weights=fitted.x[:-1], bias=float(fitted.x[-1]), penalty=penalty,
        training_parent_ids=sorted({r['parent_query'] for r in pairs}), pair_rows=len(pairs),
        positive_loss_mass=float(weight @ y),
        optimization=dict(success=bool(fitted.success), message=str(fitted.message),
            iterations=int(fitted.nit), objective=float(fitted.fun),
            max_gradient=float(np.max(np.abs(fitted.jac))),
            gradient_audit_max_error=gradient_audit(objective, fitted.x)))


def verifier_scores(record, model):
    x = np.asarray([c['features'] for c in record['candidates']])[:, model['active_features']]
    return ((x - model['mean']) / model['scale']) @ np.asarray(model['weights']) + model['bias']
