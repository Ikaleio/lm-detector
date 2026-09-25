# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy==2.5.3", "scipy==1.17.1", "scikit-learn==1.9.0"]
# ///
"""Offline refit, nested ranking calibration and atomic detector installation."""
import os
for name in ('OPENBLAS_NUM_THREADS', 'OMP_NUM_THREADS', 'VECLIB_MAXIMUM_THREADS'):
    os.environ[name] = '1'

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys

from bank_builder import read_rows
from calibrate import fit as calibrate
from export import install, save, sha
from shared_verifier_core import reference_panel
from train import fit as train

SOURCE_FILES = ('retrain.py', 'train.py', 'calibrate.py', 'export.py', 'fingerprint.py',
                'reference_data.py', 'bank_builder.py', 'ensemble_confidence_core.py',
                'identity_verification_core.py', 'mlp_core.py', 'shared_verifier_core.py',
                'calibration.py')


def input_data(data_dir: Path):
    reference = data_dir / 'unified_reference.jsonl'
    bank_path = data_dir / 'unified_bank.json'
    reference_sha, bank_sha = sha(reference), sha(bank_path)
    bank = json.loads(bank_path.read_text(encoding='utf-8'))
    if bank.get('schema') != 'robust-number-fingerprint-bank' or bank.get('reference_sha256') != reference_sha:
        raise ValueError('Reference data and bank differ; rebuild the bank first')
    ids = [model['id'] for model in bank['models']]
    if len(ids) < 10 or len(set(ids)) != len(ids):
        raise ValueError('The eight-dimensional verifier needs at least ten distinct reference identities')
    rows = read_rows(reference)
    if (Counter(row['source'] for row in rows)
            != Counter({model['id']: model['response_count'] for model in bank['models']})):
        raise ValueError('Reference counts differ from the bank')
    if (bank['robust']['model_order'] != ids
            or bank['robust']['training_rows'] != len(rows)):
        raise ValueError('Bank robust statistics differ from the reference gallery')
    panel = reference_panel(rows, ids)
    return rows, bank, panel, reference_sha, bank_sha


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, required=True, help='Existing absolute data directory')
    args = parser.parse_args()
    if not args.data_dir.is_absolute() or not args.data_dir.is_dir():
        parser.error('--data-dir must be an existing absolute directory')
    data_dir = args.data_dir.resolve()
    try:
        print('VALIDATE reference data and bank', file=sys.stderr, flush=True)
        rows, bank, panel, reference_sha, bank_sha = input_data(data_dir)
        previous = data_dir / 'shared_detector.json'
        previous_sha = sha(previous) if previous.exists() else None
        source_dir = Path(__file__).resolve().parent
        code_hashes = {name: sha(source_dir / name) for name in SOURCE_FILES}
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        out = data_dir / '.training' / stamp
        out.mkdir(parents=True, exist_ok=False)
        if previous_sha is not None:
            backup = out / 'before-shared-detector.json'
            shutil.copyfile(previous, backup)
            if sha(backup) != previous_sha:
                raise ValueError('Previous detector changed while saving its backup')
        frozen = out / 'frozen-source'
        frozen.mkdir()
        for name in SOURCE_FILES:
            shutil.copyfile(source_dir / name, frozen / name)
        save(out / 'plan.json', dict(created_at=datetime.now(timezone.utc).isoformat(),
            reference_sha256=reference_sha, bank_sha256=bank_sha,
            previous_detector_sha256=previous_sha, code_sha256=code_hashes,
            model_ids=[model['id'] for model in bank['models']],
            panel_groups=len(panel), new_api_calls=0))
        print('TRAIN', out, file=sys.stderr, flush=True)
        candidate = train(data_dir, out / 'fit', rows, bank, panel, reference_sha, bank_sha)
        if sha(data_dir / 'unified_reference.jsonl') != reference_sha or sha(data_dir / 'unified_bank.json') != bank_sha:
            raise ValueError('Reference inputs changed during fitting')
        print('CALIBRATE 78 held-out ranker fits', file=sys.stderr, flush=True)
        calibration_dir = out / 'calibration'
        passed = calibrate(data_dir, calibration_dir, rows, bank, panel, candidate)
        if not passed:
            raise ValueError('Nested calibration gate rejected the fitted detector')
        if any(sha(source_dir / name) != digest or sha(frozen / name) != digest
               for name, digest in code_hashes.items()):
            raise ValueError('Frozen training code changed during fitting')
        print('EXPORT frozen and gate-passed detector', file=sys.stderr, flush=True)
        result = install(data_dir, candidate.parent, calibration_dir, bank, reference_sha, previous_sha)
        print(json.dumps(result, separators=(',', ':')), flush=True)
        return 0
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        print(f'Retraining failed: {error}', file=sys.stderr, flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
