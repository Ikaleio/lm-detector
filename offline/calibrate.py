"""Fit ranking temperature with 12 single and 66 paired held-out environments."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

import numpy as np
from scipy.special import softmax
from sklearn.metrics import roc_auc_score

from calibration import temperature
from ensemble_confidence_core import Ensemble
from export import save, sha
from shared_verifier_core import json_default

ENVIRONMENTS = range(1, 13)


def condition(row):
    return row['condition_id'].split(':', 1)[0].split('-e', 1)[0].split('-p', 1)[0]


def binary(probabilities, truth):
    """Top-candidate binary metrics against the identity-agnostic accuracy constant."""
    top = probabilities.argmax(axis=1)
    correct = top == truth
    confidence = probabilities.max(axis=1)
    accuracy = float(correct.mean())
    clipped = np.clip(np.where(correct, confidence, 1 - confidence), 1e-15, None)
    constant = np.clip(np.where(correct, accuracy, 1 - accuracy), 1e-15, None)
    edges = np.linspace(0, 1, 11)
    ece = 0.
    for low, high in zip(edges[:-1], edges[1:]):
        take = (confidence >= low) & ((confidence < high) if high < 1 else (confidence <= 1))
        if take.any():
            ece += take.mean() * abs(confidence[take].mean() - correct[take].mean())
    return dict(groups=int(len(truth)), top1_correct=int(correct.sum()), accuracy=accuracy,
        binary_nll=float(-np.log(clipped).mean()), binary_brier=float(((confidence - correct) ** 2).mean()),
        auc=float(roc_auc_score(correct, confidence)) if 0 < correct.sum() < len(correct) else None,
        ece=float(ece), constant_binary_nll=float(-np.log(constant).mean()),
        constant_binary_brier=float(accuracy * (1 - accuracy)),
        multiclass_nll=float(-np.log(np.clip(probabilities[np.arange(len(truth)), truth],
                                               1e-15, None)).mean()))


def fit(data_dir: Path, out: Path, rows: list[dict], bank: dict, panel: list[dict], artifact_path: Path) -> bool:
    """Return whether the untouched outer-fold gate passed; always keep evidence."""
    out.mkdir()
    artifact = json.loads(artifact_path.read_text(encoding='utf-8'))
    ids = [model['id'] for model in bank['models']]
    by_id = {row['row_id']: row for row in rows}
    truth = np.array([ids.index(group['model']) for group in panel])
    save(out / 'plan.json', dict(created_at=datetime.now(timezone.utc).isoformat(),
        scope='Fit one positive temperature on frozen ranker; ranking and verifier unchanged',
        method='For each reference environment, refit full ranker outside that environment, '
               'score held-out three-answer groups, pool scores and minimize multiclass NLL',
        nested_check='Each outer environment is excluded from every inner ranker; fit tau on '
                     'eleven inner held-out environments and score untouched outer environment',
        acceptance=dict(nested_binary_nll_below_constant=True, nested_auc_above=.75),
        models=ids, environments=list(ENVIRONMENTS), tau_bounds=[.001, 1000.],
        reference_sha256=artifact['source_reference_sha256'],
        reference_panel=panel, external_training_forbidden=True, new_api_calls=0))
    fold_index = np.array([group['environment'] for group in panel])
    numbers = [[by_id[row_id]['numbers'] for row_id in group['row_ids']] for group in panel]
    fold_scores = {}
    folds = []

    def score_fold(excluded):
        conditions = {f'environment-{environment:02d}' for environment in excluded}
        training = [row for row in rows if condition(row) not in conditions]
        held = np.flatnonzero(np.isin(fold_index, excluded))
        held_ids = {row_id for index in held for row_id in panel[index]['row_ids']}
        training_ids = {row['row_id'] for row in training}
        if held_ids & training_ids or {row['source'] for row in training} != set(ids):
            raise ValueError('Held-out rows leaked into fold training or a model lost all training rows')
        ranker = Ensemble(training, ids)
        predictions = np.array([value for value, _ in ranker.score_groups([numbers[index]
                                                                          for index in held])])
        if predictions.shape != (len(held), len(ids)) or not np.isfinite(predictions).all():
            raise ValueError('Fold predictions are incomplete or nonfinite')
        record = dict(excluded_environments=list(excluded), training_row_ids=sorted(training_ids),
            held_row_ids=sorted(held_ids), query_ids=[panel[index]['id'] for index in held],
            ranking=predictions)
        name = '-'.join(f'{environment:02d}' for environment in excluded)
        path = out / f'fold-{name}.json'
        save(path, record)
        folds.append(dict(excluded_environments=list(excluded), training_rows=len(training),
            held_groups=int(len(held)), artifact=path.name, sha256=sha(path)))
        print('FOLD', name, 'training rows', len(training), file=sys.stderr, flush=True)
        return held, predictions

    scores = np.zeros((len(panel), len(ids)))
    for environment in ENVIRONMENTS:
        held, predictions = score_fold((environment,))
        scores[held] = predictions
        for inner in range(environment + 1, 13):
            held_pair, predictions_pair = score_fold((environment, inner))
            fold_scores[(environment, inner)] = dict(zip(held_pair, predictions_pair))
    fitted = temperature(scores, truth)
    tau = fitted['tau']
    nested_tau = {}
    nested = np.zeros_like(scores)
    for environment in ENVIRONMENTS:
        held = fold_index == environment
        inner_indices = np.flatnonzero(~held)
        inner_scores = np.array([fold_scores[tuple(sorted((environment, int(fold_index[index]))))][index]
            for index in inner_indices])
        nested_tau[environment] = temperature(inner_scores, truth[inner_indices])['tau']
        nested[held] = softmax(nested_tau[environment] * scores[held], axis=1)
    pooled = softmax(tau * scores, axis=1)
    metrics = dict(tau=tau, nested_tau=nested_tau, raw=binary(softmax(scores, axis=1), truth),
        pooled=binary(pooled, truth), nested=binary(nested, truth),
        confusions=sorted(({'truth': ids[t], 'prediction': ids[p]}
                          for t, p in zip(truth, nested.argmax(axis=1)) if t != p),
                         key=lambda item: (item['truth'], item['prediction'])))
    save(out / 'metrics.json', metrics)
    (out / 'oof.jsonl').write_text(''.join(json.dumps(dict(id=group['id'],
        environment=group['environment'], truth=group['model'],
        prediction=ids[int(nested[index].argmax())],
        nested_top_probability=float(nested[index].max()),
        nested_truth_probability=float(nested[index, truth[index]]),
        deployed_probabilities=pooled[index].tolist(), ranking=scores[index].tolist()),
        default=json_default) + '\n' for index, group in enumerate(panel)), encoding='utf-8')
    gate = metrics['nested']
    passed = gate['binary_nll'] < gate['constant_binary_nll'] and gate['auc'] is not None and gate['auc'] > .75
    head = dict(schema='shared-confidence-v2', method='ranking-temperature', tau=tau,
        binding=dict(base_sha256=artifact['base_sha256'], verifier_sha256=artifact['verifier_sha256'],
            reference_sha256=artifact['source_reference_sha256'], model_ids=ids),
        calibration_run=str(out.relative_to(data_dir)),
        fit_groups=int(len(panel)), fit_environments=len(ENVIRONMENTS),
        scope='Closed-set reference calibration of ranking scores. No unknown-model probability, '
              'no acceptance threshold, not a service identity certificate.')
    save(out / 'calibration.json', head)
    save(out / 'completion.json', dict(status='complete' if passed else 'rejected', gate_passed=passed,
        models=len(ids), training_rows=len(rows), fit_groups=len(panel), folds=folds, new_api_calls=0,
        validation='nested-leave-environment-out', ranker_fits=len(folds),
        calibration_sha256=sha(out / 'calibration.json')))
    if passed:
        save(out / 'calibration-frozen.json', dict(sha256=sha(out / 'calibration.json'),
            at=datetime.now(timezone.utc).isoformat()))
    print('METRICS', json.dumps(dict(tau=tau, nested=gate, raw=metrics['raw']),
                                default=json_default), file=sys.stderr, flush=True)
    print('COMPLETE' if passed else 'REJECTED', out, file=sys.stderr, flush=True)
    return passed
