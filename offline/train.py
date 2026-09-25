"""Fit the unchanged shared verifier on disjoint reference-panel roles."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import pickle
import sys

import numpy as np
from scipy.special import expit

from ensemble_confidence_core import Ensemble
from export import export_ranker, export_verifier, lines, save, sha
from identity_verification_core import IdentityVerifier
from shared_verifier_core import extract_group, fit_verifier, json_default, training_pairs, verifier_scores


def summary(records, model):
    correct = 0
    losses, briers, predictions = [], [], []
    for record in records:
        scores = verifier_scores(record, model)
        truth = record['gallery_ids'].index(record['truth'])
        target = np.arange(len(scores)) == truth
        weight = np.where(target, .5, .5 / (len(scores) - 1))
        losses.append(float(weight @ (np.logaddexp(0, scores) - target * scores)))
        briers.append(float(weight @ ((expit(scores) - target) ** 2)))
        top = record['gallery_ids'][int(np.argmax(scores))]
        correct += top == record['truth']
        predictions.append(dict(id=record['id'], truth=record['truth'], prediction=top))
    return dict(groups=len(records), top1_correct=correct,
        balanced_pair_nll=float(np.mean(losses)), balanced_pair_brier=float(np.mean(briers)),
        predictions=predictions)


def fit(data_dir: Path, out: Path, rows: list[dict], bank: dict, panel: list[dict],
        reference_sha: str, bank_sha: str) -> Path:
    """Freeze fitting evidence; return the uninstalled candidate artifact."""
    out.mkdir()
    ids = [model['id'] for model in bank['models']]
    by_id = {row['row_id']: row for row in rows}
    groups, enrollment = [], []
    for entry in panel:
        members = [by_id[row_id] for row_id in entry['row_ids']]
        if len(members) != 3 or any(row['source'] != entry['model'] for row in members):
            raise ValueError('Reference group identity mismatch')
        if entry['environment'] <= 8:
            enrollment.extend(dict(row, environment=entry['environment']) for row in members)
        else:
            groups.append(dict(id=entry['id'], truth=entry['model'], row_ids=entry['row_ids'],
                environment=entry['environment'], complete=True,
                numbers=[row['numbers'] for row in members]))
    fitting = [group for group in groups if group['environment'] in (9, 10)]
    audit_groups = [group for group in groups if group['environment'] in (11, 12)]
    if (len(enrollment) != len(ids) * 8 * 3 or len(fitting) != len(ids) * 2
            or len(audit_groups) != len(ids) * 2):
        raise ValueError('Expected 8 enrollment, 2 fit, and 2 audit groups per identity')
    enrollment_ids = {row['row_id'] for row in enrollment}
    fit_ids = {row_id for group in fitting for row_id in group['row_ids']}
    audit_ids = {row_id for group in audit_groups for row_id in group['row_ids']}
    if enrollment_ids & fit_ids or enrollment_ids & audit_ids or fit_ids & audit_ids:
        raise ValueError('Reference roles overlap')
    save(out / 'plan.json', dict(created_at=datetime.now(timezone.utc).isoformat(),
        scope='Refit current gallery with unchanged ranking and verification algorithms',
        models=ids, enrollment_environments=list(range(1, 9)), fit_environments=[9, 10],
        reference_audit_environments=[11, 12], penalty=.1, features=list(range(6)),
        masked_views='Refit all base statistics after removing each query identity',
        reference_sha256=reference_sha, bank_sha256=bank_sha,
        reference_panel=panel, enrollment_row_ids=sorted(enrollment_ids),
        fit_row_ids=sorted(fit_ids), audit_row_ids=sorted(audit_ids),
        production_ranker='All reference rows; audit uses an enrollment-only ranker',
        probability_calibration='Fitted separately by nested leave-environment-out ranking'))
    verifier = IdentityVerifier(enrollment, ids, ids)
    audit_ranker = Ensemble(enrollment, ids)
    save(out / 'enrollment.json', dict(verifier=verifier.artifact,
        ranker_training_ids=sorted(enrollment_ids), fit_row_ids=sorted(fit_ids),
        audit_row_ids=sorted(audit_ids)))
    present = [extract_group(verifier, audit_ranker, group) for group in fitting]
    for record in present:
        record['base_object'] = 'current-gallery-enrollment-1-8'
    pairs = [pair for record in present for pair in training_pairs(record)]
    lines(out / 'training-present.jsonl', present)
    print('FIT registered groups', len(present), file=sys.stderr, flush=True)
    for index, label in enumerate(ids):
        allowed = [model for model in ids if model != label]
        training = [row for row in enrollment if row['source'] != label]
        masked_verifier = IdentityVerifier(training, allowed, allowed)
        masked_ranker = Ensemble(training, allowed)
        masked = [extract_group(masked_verifier, masked_ranker, group)
                  for group in fitting if group['truth'] == label]
        for record in masked:
            record['base_object'] = 'current-gallery-without-' + label
        pairs.extend(pair for record in masked for pair in training_pairs(record, masked=True))
        print('MASK', index + 1, '/', len(ids), label, file=sys.stderr, flush=True)
    mass = Counter()
    for pair in pairs:
        mass[pair['parent_query']] += pair['weight']
    if (len(pairs) != len(fitting) * (2 * len(ids) - 1)
            or len(mass) != len(fitting)
            or any(abs(weight - 1) > 1e-12 for weight in mass.values())):
        raise ValueError('Invalid parent query weights')
    lines(out / 'pair-training.jsonl', pairs)
    model = fit_verifier(pairs, list(range(6)), .1)
    save(out / 'verifier.json', model)
    if not model['optimization']['success']:
        raise ValueError('Verifier fitting did not converge')
    # Deliberately exclude reference audit environments from every verifier fit;
    # the production ranker follows the existing all-reference-rows convention.
    production_ranker = Ensemble(rows, ids)
    with (out / 'base.pkl').open('wb') as file:
        pickle.dump(dict(ranker=production_ranker, verifier=verifier), file, protocol=5)
    artifact = dict(schema='shared-detector-v1',
        source_run=str(out.relative_to(data_dir)),
        base_sha256=sha(out / 'base.pkl'), verifier_sha256=sha(out / 'verifier.json'),
        source_reference_sha256=reference_sha,
        bank_built_at=bank['built_at'], bank_robust_sha256=hashlib.sha256(json.dumps(bank['robust'],
            sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
        model_ids=ids, response_counts=[entry['response_count'] for entry in bank['models']],
        ranker=export_ranker(production_ranker), verifier=export_verifier(verifier, model),
        verifier_training_models=ids, calibration=None, calibration_sha256=None,
        probability_status='unavailable', risk_certificate=None)
    candidate = out / 'shared_detector.json'
    candidate.write_text(json.dumps(artifact, separators=(',', ':'), allow_nan=False,
                                    default=json_default) + '\n', encoding='utf-8')
    records = [extract_group(verifier, audit_ranker, group) for group in audit_groups]
    lines(out / 'reference-audit-after.jsonl', records)
    audit = dict(after=summary(records, model),
        scope='Reference environments 11-12 excluded from verifier enrollment and fitting; '
              'enrollment-only audit ranker. Production ranker uses all reference rows and is not '
              'evaluated by the reference audit.',
        numerical=verifier.numerical_audit(audit_groups[0]['numbers']))
    save(out / 'reference-audit.json', audit)
    parity = []
    for group in audit_groups:
        record = extract_group(verifier, production_ranker, group)
        ranking, _ = production_ranker.score_groups([group['numbers']])[0]
        parity.append(dict(id=group['id'], numbers=group['numbers'], ranking=ranking,
            scores=verifier_scores(record, model),
            features=[candidate['features'] for candidate in record['candidates']]))
    save(out / 'python-replay.json', dict(scope='Numerical parity only; queries in production ranker',
                                         groups=parity))
    save(out / 'fit-complete.json', dict(artifact_sha256=sha(candidate),
        verifier_sha256=sha(out / 'verifier.json'), bank_sha256=bank_sha,
        fit_parent_queries=len(fitting), candidate_pair_rows=len(pairs),
        disjoint_reference_roles=True, frozen_before_audit=True, new_api_calls=0))
    save(out / 'completion.json', dict(status='complete', models=len(ids), training_rows=len(rows),
        verifier_enrollment_rows=len(enrollment), fit_queries=len(fitting),
        audit_queries=len(audit_groups), artifact_sha256=sha(candidate)))
    print('AUDIT', json.dumps({key: value for key, value in audit['after'].items()
                               if key != 'predictions'}), file=sys.stderr, flush=True)
    return candidate
