"""Fit the production ranker on every reference row."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import pickle

from ensemble_confidence_core import Ensemble
from export import export_ranker, json_default, save, sha


def fit(data_dir: Path, out: Path, rows: list[dict], bank: dict, reference_sha: str, bank_sha: str) -> Path:
    """Freeze the fitted ranker; return the uninstalled candidate artifact."""
    out.mkdir()
    ids = [model['id'] for model in bank['models']]
    save(out / 'plan.json', dict(created_at=datetime.now(timezone.utc).isoformat(),
        scope='Refit the production ranker on all reference rows',
        models=ids, reference_sha256=reference_sha, bank_sha256=bank_sha,
        probability_calibration='Fitted separately by nested leave-environment-out ranking'))
    ranker = Ensemble(rows, ids)
    with (out / 'base.pkl').open('wb') as file:
        pickle.dump(dict(ranker=ranker), file, protocol=5)
    artifact = dict(schema='shared-detector-v2',
        source_run=str(out.relative_to(data_dir)),
        base_sha256=sha(out / 'base.pkl'),
        source_reference_sha256=reference_sha,
        bank_built_at=bank['built_at'], bank_robust_sha256=hashlib.sha256(json.dumps(bank['robust'],
            sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
        model_ids=ids, response_counts=[entry['response_count'] for entry in bank['models']],
        ranker=export_ranker(ranker), calibration=None, calibration_sha256=None,
        probability_status='unavailable')
    candidate = out / 'shared_detector.json'
    candidate.write_text(json.dumps(artifact, separators=(',', ':'), allow_nan=False,
                                    default=json_default) + '\n', encoding='utf-8')
    save(out / 'fit-complete.json', dict(artifact_sha256=sha(candidate), bank_sha256=bank_sha,
        models=len(ids), training_rows=len(rows), new_api_calls=0))
    return candidate
