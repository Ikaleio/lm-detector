"""Continuous identity posterior and shared-condition Gaussian predictive checks."""
import numpy as np
from scipy.linalg import cho_factor, cho_solve
from mlp_core import features, fit_preprocessing, transform

DIMENSION = 8
IDENTITY_RANK = 4
SHRINKAGE = .75
SCALES = (.5, 1., 2.)


def covariance(x):
    x = np.asarray(x)
    x = x - x.mean(axis=0)
    return x.T @ x / max(len(x) - 1, 1)


def positive(x, floor=1e-6):
    values, vectors = np.linalg.eigh((x + x.T) / 2)
    return (vectors * np.maximum(values, floor)) @ vectors.T


def shrunk(x):
    x = positive(x)
    return .75 * x + .25 * np.trace(x) / len(x) * np.eye(len(x))


def inverse(x):
    return cho_solve(cho_factor(x, lower=True), np.eye(len(x)))


def gaussian(x, mean, covariance_matrix):
    delta = np.asarray(x) - mean
    factor = cho_factor(covariance_matrix, lower=True)
    return float(-.5 * (len(delta) * np.log(2 * np.pi)
        + 2 * np.log(np.diag(factor[0])).sum()
        + delta @ cho_solve(factor, delta)))


def joint_covariance(shared, independent, n):
    return np.kron(np.ones((n, n)), shared) + np.kron(np.eye(n), independent)


class IdentityVerifier:
    """Fit on eight reference conditions; never consume calibration/query rows."""

    def __init__(self, training, population_ids, gallery_ids):
        self.ids = list(gallery_ids)
        population = [r for r in training if r['source'] in population_ids]
        self.preprocessing = fit_preprocessing(features([r['numbers'] for r in population]))
        pop_x = transform(features([r['numbers'] for r in population]), self.preprocessing)
        centers = np.stack([pop_x[[r['source'] == label for r in population]].mean(axis=0)
                            for label in population_ids])
        self.origin = centers.mean(axis=0)
        _, _, right = np.linalg.svd(centers - self.origin, full_matrices=False)
        self.basis = right[:DIMENSION].T
        self.unit_scale = np.sqrt(np.mean(((pop_x - self.origin) @ self.basis) ** 2))
        self.gallery_base = transform(features([r['numbers'] for r in training]), self.preprocessing)
        self.gallery_labels = [r['source'] for r in training]
        projected = (self.gallery_base - self.origin) @ self.basis / self.unit_scale
        panel = {}
        for label in gallery_ids:
            selected = [i for i, r in enumerate(training) if r['source'] == label]
            environments = sorted({training[i]['environment'] for i in selected})
            panel[label] = np.stack([projected[[i for i in selected
                if training[i]['environment'] == env]] for env in environments])
            if panel[label].shape != (8, 3, DIMENSION):
                raise ValueError('Expected eight complete training conditions: ' + label)
        pop = np.stack([panel[label] for label in population_ids])
        self.mu = pop.mean(axis=(0, 1, 2))
        means = pop.mean(axis=2)
        residual = pop - means[:, :, None, :]
        # Three different prompts, not repeated exact requests. These are working
        # variance components; they do not identify physical sampling noise.
        within = np.einsum('mcsi,mcsj->ij', residual, residual) / (len(pop) * 8 * 2)
        self.noise = shrunk(within)
        centered = means - means.mean(axis=1, keepdims=True)
        between_conditions = np.einsum('mci,mcj->ij', centered, centered) / (len(pop) * 7)
        self.condition = shrunk(positive(between_conditions - self.noise / 3))
        between = positive(covariance(means.mean(axis=1))
                           - (self.condition + self.noise / 3) / 8)
        values, vectors = np.linalg.eigh(between)
        low_rank = (vectors[:, -IDENTITY_RANK:] * values[-IDENTITY_RANK:]) @ vectors[:, -IDENTITY_RANK:].T
        self.identity = positive(.9 * low_rank + .1 * np.trace(between) / DIMENSION * np.eye(DIMENSION))
        self.candidates = {}
        for label, observations in panel.items():
            cm = observations.mean(axis=1)
            residual = observations - cm[:, None, :]
            individual_noise = np.einsum('csi,csj->ij', residual, residual) / (8 * 2)
            noise = positive(SHRINKAGE * self.noise + (1 - SHRINKAGE) * shrunk(individual_noise))
            individual_condition = positive(covariance(cm) - noise / 3)
            condition = positive(SHRINKAGE * self.condition + (1 - SHRINKAGE) * shrunk(individual_condition))
            precision = inverse(condition + noise / 3)
            posterior_covariance = inverse(inverse(self.identity) + 8 * precision)
            posterior_mean = posterior_covariance @ (8 * precision @ (cm.mean(axis=0) - self.mu))
            self.candidates[label] = dict(mean=self.mu + posterior_mean,
                posterior_covariance=posterior_covariance, condition=condition, noise=noise)
        self.artifact = dict(population_ids=population_ids, gallery_ids=self.ids,
            population_row_ids=[r['row_id'] for r in population],
            training_row_ids=[r['row_id'] for r in training], preprocessing=self.preprocessing,
            origin=self.origin, basis=self.basis, unit_scale=self.unit_scale, mu=self.mu,
            identity_covariance=self.identity, condition_covariance=self.condition,
            noise_covariance=self.noise, candidates=self.candidates)

    def distances(self, numbers):
        x = transform(features(numbers), self.preprocessing)
        d = np.maximum(0, (x * x).sum(axis=1)[:, None]
            + (self.gallery_base * self.gallery_base).sum(axis=1)[None, :]
            - 2 * x @ self.gallery_base.T)
        return np.median(np.stack([np.sort(d[:, np.array(self.gallery_labels) == label], axis=1)[:, :7].mean(axis=1)
                                  for label in self.ids], axis=1), axis=0)

    def score(self, numbers):
        n = len(numbers)
        x = (transform(features(numbers), self.preprocessing) - self.origin) @ self.basis / self.unit_scale
        flat = x.ravel()
        result = {label: dict(distance=float(d), scales={}) for label, d in zip(self.ids, self.distances(numbers))}
        for scale in SCALES:
            new_cov = joint_covariance(scale * self.identity + self.condition, self.noise, n)
            new = gaussian(flat, np.tile(self.mu, n), new_cov)
            # Diagnostic ablation: redraw identity and condition for every answer.
            pooled = sum(gaussian(row, self.mu, scale * self.identity + self.condition + self.noise) for row in x)
            for label, candidate in self.candidates.items():
                shared = candidate['condition'] + candidate['posterior_covariance']
                noise, mean = candidate['noise'], candidate['mean']
                same = gaussian(flat, np.tile(mean, n), joint_covariance(shared, noise, n))
                point = gaussian(flat, np.tile(mean, n), joint_covariance(candidate['condition'], noise, n))
                alternative = gaussian(flat, np.tile(mean, n), joint_covariance(shared + scale * self.identity, noise, n))
                gains = []
                if n == 3:
                    for row in x:
                        # log p(X_others|X_first) = log p(X_all) - log p(X_first).
                        gain = alternative - gaussian(row, mean, shared + scale * self.identity + noise)
                        gain -= same - gaussian(row, mean, shared + noise)
                        gains.append(float(gain))
                result[label]['scales'][str(scale)] = dict(log_same=same, log_new=new,
                    log_bayes=same - new, log_bayes_pooled=same - pooled,
                    log_bayes_point=point - new, gains=gains,
                    residual_first=gains[0] if gains else None,
                    residual_mean=float(np.mean(gains)) if gains else None)
        return result

    def numerical_audit(self, numbers):
        """Check Schur prediction against joint-minus-marginal arithmetic."""
        x = (transform(features(numbers), self.preprocessing) - self.origin) @ self.basis / self.unit_scale
        candidate = self.candidates[self.ids[0]]
        errors = []
        for extra in (0., 1.):
            cov = joint_covariance(candidate['condition'] + candidate['posterior_covariance']
                                   + extra * self.identity, candidate['noise'], 3)
            mean = np.tile(candidate['mean'], 3)
            a, cross, b = cov[:DIMENSION, :DIMENSION], cov[DIMENSION:, :DIMENSION], cov[DIMENSION:, DIMENSION:]
            conditional_mean = mean[DIMENSION:] + cross @ inverse(a) @ (x[0] - mean[:DIMENSION])
            conditional_cov = b - cross @ inverse(a) @ cross.T
            direct = gaussian(x[1:].ravel(), conditional_mean, conditional_cov)
            difference = gaussian(x.ravel(), mean, cov) - gaussian(x[0], mean[:DIMENSION], a)
            errors.append(abs(direct - difference))
        if max(errors) > 1e-8:
            raise ValueError('Gaussian conditional calculation mismatch')
        eigenvalues = [np.linalg.eigvalsh(self.identity).min(), np.linalg.eigvalsh(self.condition).min(), np.linalg.eigvalsh(self.noise).min()]
        return dict(conditional_max_error=max(errors), minimum_covariance_eigenvalue=float(min(eigenvalues)),
                    analytic_gaussian_integration=True)
