"""Export a completed offline fit only after its frozen nested calibration passes."""
import hashlib
import json
import os
from pathlib import Path
import tempfile

import numpy as np

from ensemble_confidence_core import BLEND


def json_default(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(type(value).__name__)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False,
                               default=json_default) + '\n', encoding='utf-8')


def encode_detector(artifact: dict) -> bytes:
    """Binary detector read by `shared/detector-codec.ts`, which documents the layout."""
    values: list[float] = []

    def pack(value):
        value = json_default(value) if isinstance(value, (np.ndarray, np.generic)) else value
        if isinstance(value, dict):
            return {key: pack(item) for key, item in value.items()}
        if not isinstance(value, (list, tuple)):
            return value
        if value and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in value):
            values.extend(value)
            return {'$f32': len(values) - len(value), 'n': len(value)}
        return [pack(item) for item in value]

    header = json.dumps(pack(artifact), separators=(',', ':'), allow_nan=False).encode('utf-8')
    padding = bytes(-(4 + len(header)) % 4)
    floats = np.asarray(values, dtype='<f4')
    if not np.isfinite(floats).all():
        raise ValueError('Detector parameters do not fit in float32')
    shuffled = floats.view(np.uint8).reshape(-1, 4).T.tobytes()
    return len(header).to_bytes(4, 'little') + header + padding + shuffled


def export_ranker(ranker):
    return dict(head_params=ranker.head_params, full_params=ranker.full_params,
        lda_weights=ranker.lda.coef_, lda_bias=ranker.lda.intercept_,
        references=[ranker.full[ranker.labels == i] for i in range(len(ranker.ids))],
        bank=ranker.bank, blend=BLEND,
        positional=dict(params=ranker.positional.params, weights=ranker.positional.coefficient,
                        bias=ranker.positional.intercept))


def install(data_dir: Path, fit_dir: Path, calibration_dir: Path, bank: dict,
            reference_sha: str, previous_sha: str | None) -> dict:
    """Check the frozen fit, gate, binding and current inputs before one atomic replacement."""
    candidate = fit_dir / 'shared_detector.json'
    fit = json.loads((fit_dir / 'fit-complete.json').read_text(encoding='utf-8'))
    artifact = json.loads(candidate.read_text(encoding='utf-8'))
    if (sha(candidate) != fit['artifact_sha256']
            or sha(fit_dir / 'base.pkl') != artifact['base_sha256']):
        raise ValueError('Frozen ranker fit changed')
    ids = [model['id'] for model in bank['models']]
    if (artifact['source_reference_sha256'] != reference_sha
            or artifact['bank_built_at'] != bank['built_at']
            or artifact['bank_robust_sha256'] != hashlib.sha256(json.dumps(bank['robust'],
                sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            or artifact['model_ids'] != ids
            or artifact['response_counts'] != [model['response_count'] for model in bank['models']]):
        raise ValueError('Completed ranker is bound to a different reference bank')
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
                reference_sha256=reference_sha, model_ids=ids)):
        raise ValueError('Confidence calibration is bound to a different scorer')
    artifact.update(calibration=head, calibration_sha256=head_sha,
                    probability_status='reference_calibrated')
    out = data_dir / 'shared_detector.bin'
    if (sha(data_dir / 'unified_reference.jsonl') != reference_sha
            or sha(data_dir / 'unified_bank.json') != fit['bank_sha256']):
        raise ValueError('Reference inputs changed during fitting')
    if (out.exists() and sha(out) != previous_sha) or (not out.exists() and previous_sha is not None):
        raise ValueError('Previous detector changed during fitting')
    payload = encode_detector(artifact)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='wb', dir=data_dir,
                                         prefix='.shared_detector-', suffix='.tmp', delete=False) as file:
            temporary = Path(file.name)
            file.write(payload)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, out)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return dict(path=str(out), bytes=len(payload),
                sha256=hashlib.sha256(payload).hexdigest(), models=len(ids))
