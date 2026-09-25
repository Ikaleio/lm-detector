"""Read reference batches and project their samples into algorithm records."""
from __future__ import annotations

import json
from pathlib import Path
import re


def validate_channel(channel: str) -> None:
    if (not isinstance(channel, str) or not re.fullmatch(r'[a-z0-9][a-z0-9._/-]*', channel)
            or '..' in channel or channel.endswith('/')):
        raise ValueError('Invalid reference channel')
    if re.match(r'^(codex|kimi-code)(?:/|$|-)', channel) and not channel.endswith('-subscription'):
        raise ValueError('Subscription channels must end with -subscription')


def reference_records(path: Path) -> list[dict]:
    """Accept only version 1 batches; preserve batch and sample order, including truncation."""
    records, ids = [], set()
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        batch = json.loads(line)
        if (not isinstance(batch, dict) or batch.get('schema_version') != 1
                or batch.get('purpose') != 'reference' or not batch.get('id')
                or not isinstance(batch.get('model'), dict)
                or not all(batch['model'].get(k) for k in ('id', 'family', 'family_name'))
                or not isinstance(batch.get('source'), dict)
                or not isinstance(batch.get('request'), dict)
                or not isinstance(batch.get('plan'), dict)
                or not isinstance(batch.get('samples'), list) or not batch['samples']
                or batch.get('test_set_id')):
            raise ValueError('Reference data must contain version 1 reference batches, not legacy or evaluation rows')
        validate_channel(batch['source'].get('channel'))
        for sample in batch['samples']:
            if (not isinstance(sample, dict) or not isinstance(sample.get('id'), str)
                    or not sample['id'] or sample['id'] in ids
                    or not sample.get('challenge_id') or not sample.get('condition')
                    or not isinstance(sample.get('text'), str)
                    or type(sample.get('expected_count')) is not int or sample['expected_count'] < 1
                    or sample.get('completion') not in ('complete', 'truncated', 'unknown')
                    or sample.get('test_set_id') or sample.get('purpose', 'reference') != 'reference'):
                raise ValueError(f"Invalid or duplicate reference sample in batch {batch['id']}")
            actual_channel = sample.get('actual_channel')
            if actual_channel is not None:
                validate_channel(actual_channel)
            ids.add(sample['id'])
            records.append(dict(
                row_id=sample['id'], source=batch['model']['id'],
                family_id=batch['model']['family'], family_name=batch['model']['family_name'],
                challenge_id=sample['challenge_id'], condition_id=sample['condition'],
                text=sample['text'], prompt=sample['prompt'], system_prompt=sample['system_prompt'],
                requested_count=sample['expected_count'], completion=sample['completion'],
                reasoning_effort=sample.get('reasoning_effort', batch['request']['reasoning_effort']),
                channel=actual_channel or batch['source']['channel'],
                provider=sample.get('provider_reported'), batch_id=batch['id'],
                endpoint=batch['source'].get('endpoint'), collected_at=batch.get('created_at'),
            ))
    return records
