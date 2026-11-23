export interface NBModel {
  labels: string[];
  classDocCounts: Record<string, number>;
  tokenCounts: Record<string, Record<string, number>>;
  classTokenTotals: Record<string, number>;
  vocab: string[];
  totalDocs: number;
}

export interface NBPrediction {
  label: string;
  probability: number;
  scores: Record<string, number>; // normalized posterior per label
}

/** Multinomial Naive Bayes with Laplace smoothing. Pure TS, runs offline in Expo Go. */
export class NaiveBayes {
  private model: NBModel;
  private vocabSet: Set<string>;

  constructor(model?: NBModel) {
    this.model = model ?? {
      labels: [],
      classDocCounts: {},
      tokenCounts: {},
      classTokenTotals: {},
      vocab: [],
      totalDocs: 0,
    };
    this.vocabSet = new Set(this.model.vocab);
  }

  train(tokens: string[], label: string): void {
    const m = this.model;
    if (!m.classDocCounts[label]) {
      m.labels.push(label);
      m.classDocCounts[label] = 0;
      m.tokenCounts[label] = {};
      m.classTokenTotals[label] = 0;
    }
    m.classDocCounts[label] += 1;
    m.totalDocs += 1;
    for (const t of tokens) {
      m.tokenCounts[label][t] = (m.tokenCounts[label][t] ?? 0) + 1;
      m.classTokenTotals[label] += 1;
      if (!this.vocabSet.has(t)) {
        this.vocabSet.add(t);
        m.vocab.push(t);
      }
    }
  }

  predict(tokens: string[]): NBPrediction | null {
    const m = this.model;
    if (m.labels.length === 0) return null;
    const V = Math.max(m.vocab.length, 1);
    const logs: Record<string, number> = {};
    for (const label of m.labels) {
      let lp = Math.log(m.classDocCounts[label] / m.totalDocs);
      for (const t of tokens) {
        if (!this.vocabSet.has(t)) continue; // ignore unseen tokens
        const c = m.tokenCounts[label][t] ?? 0;
        lp += Math.log((c + 1) / (m.classTokenTotals[label] + V));
      }
      logs[label] = lp;
    }
    const max = Math.max(...Object.values(logs));
    let z = 0;
    const exp: Record<string, number> = {};
    for (const label of m.labels) {
      exp[label] = Math.exp(logs[label] - max);
      z += exp[label];
    }
    const scores: Record<string, number> = {};
    let best = m.labels[0];
    for (const label of m.labels) {
      scores[label] = exp[label] / z;
      if (scores[label] > scores[best]) best = label;
    }
    return { label: best, probability: scores[best], scores };
  }

  toJSON(): NBModel {
    return this.model;
  }
}
