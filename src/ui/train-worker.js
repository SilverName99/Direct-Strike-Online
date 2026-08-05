// Evolutionary-trainer worker: runs headless AI-vs-AI matches off the main
// thread so the browser can use every CPU core. On init it applies the user's
// saved balance (so training reflects the real, tuned units), then answers
// match jobs deterministically.

import { applyBalance } from './balance.js';
import { runMatch, scoreFor0 } from '../sim/match.js';

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg) return;

  if (msg.type === 'init') {
    try { if (msg.balance) applyBalance(msg.balance); } catch (err) { /* fall back to code defaults */ }
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'match') {
    const r = runMatch({
      seed: msg.seed,
      races: msg.races,
      genomeA: msg.a,
      genomeB: msg.b,
      maxSeconds: msg.maxSeconds || 150,
    });
    r.score0 = scoreFor0(r);
    self.postMessage({ type: 'result', jobId: msg.jobId, result: r });
  }
};
