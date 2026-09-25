"""Export a completed offline fit only after its frozen nested calibration passes."""
import hashlib
import json
import os
from pathlib import Path
import tempfile

import numpy as np

from identity_verification_core import inverse, joint_covariance
from shared_verifier_core import json_default


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False,
                               default=json_default) + '\n', encoding='utf-8')


def lines(path: Path, records: list[dict]) -> None:
    path.write_text(''.join(json.dumps(row, ensure_ascii=False, allow_nan=False,
                                      default=json_default) + '\n' for row in records), encoding='utf-8')


def gaussian(cov):
    return dict(precision=inverse(cov), constant=float(-.5 * (
        len(cov) * np.log(2 * np.pi) + np.linalg.slogdet(cov)[1])))


def export_verifier(verifier, model):
    candidates = []
    for label in verifier.ids:
        c = verifier.candidates[label]
        shared = c['condition'] + c['posterior_covariance']
        alternative = shared + verifier.identity
        candidates.append(dict(mean=c['mean'],
            same_joint=gaussian(joint_covariance(shared, c['noise'], 3)),
            alternative_joint=gaussian(joint_covariance(alternative, c['noise'], 3)),
            same_single=gaussian(shared + c['noise']),
            alternative_single=gaussian(alternative + c['noise'])))
    return dict(preprocessing=verifier.preprocessing, origin=verifier.origin, basis=verifier.basis,
        unit_scale=verifier.unit_scale, mu=verifier.mu,
        references=[verifier.gallery_base[np.array(verifier.gallery_labels) == label] for label in verifier.ids],
        new_joint=gaussian(joint_covariance(verifier.identity + verifier.condition, verifier.noise, 3)),
        candidates=candidates, model=model)


def export_ranker(ranker):
    return dict(head_params=ranker.head_params, full_params=ranker.full_params,
        lda_weights=ranker.lda.coef_, lda_bias=ranker.lda.intercept_,
        references=[ranker.full[ranker.labels == i] for i in range(len(ranker.ids))],
        bank=ranker.bank)


def install(data_dir: Path, fit_dir: Path, calibration_dir: Path, bank: dict,
            reference_sha: str, previous_sha: str | None) -> dict:
    """Check the frozen fit, gate, binding and current inputs before one atomic replacement."""
    candidate = fit_dir / 'shared_detector.json'
    fit = json.loads((fit_dir / 'fit-complete.json').read_text(encoding='utf-8'))
    artifact = json.loads(candidate.read_text(encoding='utf-8'))
    if (sha(candidate) != fit['artifact_sha256']
            or sha(fit_dir / 'base.pkl') != artifact['base_sha256']
            or sha(fit_dir / 'verifier.json') != artifact['verifier_sha256']
            or fit['verifier_sha256'] != artifact['verifier_sha256']):
        raise ValueError('Frozen verifier fit changed')
    ids = [model['id'] for model in bank['models']]
    if (artifact['source_reference_sha256'] != reference_sha
            or artifact['bank_built_at'] != bank['built_at']
            or artifact['bank_robust_sha256'] != hashlib.sha256(json.dumps(bank['robust'],
                sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            or artifact['model_ids'] != ids
            or artifact['response_counts'] != [model['response_count'] for model in bank['models']]):
        raise ValueError('Completed verifier is bound to a different reference bank')
    completion = json.loads((calibration_dir / 'completion.json').read_text(encoding='utf-8'))
    frozen = json.loads((calibration_dir / 'calibration-frozen.json').read_text(encoding='utf-8'))
    head_path = calibration_dir / 'calibration.json'
    head_sha = sha(head_path)
    if (completion.get('status') != 'complete' or completion.get('gate_passed') is not True
            or completion.get('validation') != 'nested-leave-environment-out'
            or completion.get('ranker_fits') != 78
            or len(completion.get('folds', [])) != 78
            or completion.get('calibration_sha256') != head_sha or frozen.get('sha256') != head_sha):
        raise ValueError('Confidence calibration requires frozen passing nested validation')
    for fold in completion['folds']:
        if sha(calibration_dir / fold['artifact']) != fold['sha256']:
            raise ValueError('Frozen calibration fold changed: ' + fold['artifact'])
    head = json.loads(head_path.read_text(encoding='utf-8'))
    binding = head['binding']
    if (head.get('schema') != 'shared-confidence-v2'
            or head.get('method') != 'ranking-temperature'
            or type(head.get('tau')) not in (int, float) or not .001 <= head['tau'] <= 1000
            or binding != dict(base_sha256=artifact['base_sha256'],
                verifier_sha256=artifact['verifier_sha256'],
                reference_sha256=reference_sha, model_ids=ids)):
        raise ValueError('Confidence calibration is bound to a different scorer')
    artifact.update(calibration=head, calibration_sha256=head_sha,
                    probability_status='reference_calibrated')
    out = data_dir / 'shared_detector.json'
    if (sha(data_dir / 'unified_reference.jsonl') != reference_sha
            or sha(data_dir / 'unified_bank.json') != fit['bank_sha256']):
        raise ValueError('Reference inputs changed during fitting')
    if (out.exists() and sha(out) != previous_sha) or (not out.exists() and previous_sha is not None):
        raise ValueError('Previous detector changed during fitting')
    payload = json.dumps(artifact, separators=(',', ':'), allow_nan=False,
                         default=json_default) + '\n'
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=data_dir,
                                         prefix='.shared_detector-', suffix='.tmp', delete=False) as file:
            temporary = Path(file.name)
            file.write(payload)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, out)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return dict(path=str(out), bytes=len(payload.encode('utf-8')),
                sha256=hashlib.sha256(payload.encode('utf-8')).hexdigest(), models=len(ids))
