"""Fit the closed-set ranking temperature from held-out reference scores."""
import numpy as np
from scipy.optimize import minimize_scalar
from scipy.special import logsumexp


def temperature(scores, truth):
    scores, truth = np.asarray(scores), np.asarray(truth)
    def loss(log_tau):
        s = np.exp(log_tau)*scores
        return float(np.mean(logsumexp(s, axis=1)-s[np.arange(len(truth)), truth]))
    fit = minimize_scalar(loss, method='bounded', bounds=(np.log(.001), np.log(1000)),
                          options=dict(xatol=1e-9))
    if not fit.success:
        raise ValueError('Temperature fitting failed')
    return dict(tau=float(np.exp(fit.x)), multiclass_nll=float(fit.fun))
