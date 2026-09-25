"""Reference-only feature preprocessing shared by identity verification."""
import numpy as np
from fingerprint import count_numbers, hellinger_feature, ordered_block_feature


def features(numbers):
    return [np.stack([hellinger_feature(count_numbers(n)) for n in numbers]),
            np.stack([ordered_block_feature(n) for n in numbers])]


def fit_preprocessing(blocks):
    result = []
    for block in blocks:
        scale = block.std(axis=0)
        scale[scale < 1e-10] = 1
        result.append(dict(mean=block.mean(axis=0).tolist(), scale=scale.tolist()))
    return result


def transform(blocks, preprocessing):
    result = []
    for block, params, weight in zip(blocks, preprocessing, (.75, .25)):
        z = (block - params['mean']) / params['scale']
        norm = np.linalg.norm(z, axis=1, keepdims=True)
        result.append(z / np.maximum(norm, 1e-12) * np.sqrt(weight))
    return np.concatenate(result, axis=1)


