/**
 * Multinomial Naive Bayes text classifier, implemented from scratch.
 *
 *   P(class | message) ∝ P(class) × Π P(token | class)
 *
 * - P(class)          = documents of that class / all documents            (prior)
 * - P(token | class)  = (count of token in class + α) / (tokens in class + α·|V|)
 *                       (Laplace smoothing with α = 1 so unseen words never give probability 0)
 *
 * Products of many small probabilities underflow, so everything is computed as a sum of logs.
 * Confidence is obtained by turning the log scores back into normalized probabilities (softmax).
 */
import { tokenize } from './textPreprocessor';

export interface NaiveBayesModel {
  classes: string[];
  alpha: number;
  docCounts: Record<string, number>;
  tokenCounts: Record<string, Record<string, number>>;
  totalTokens: Record<string, number>;
  vocabulary: string[];
}

export interface Prediction {
  label: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export class NaiveBayesClassifier {
  private model: NaiveBayesModel;
  private vocab: Set<string>;

  constructor(model?: NaiveBayesModel) {
    this.model = model ?? {
      classes: [],
      alpha: 1,
      docCounts: {},
      tokenCounts: {},
      totalTokens: {},
      vocabulary: [],
    };
    this.vocab = new Set(this.model.vocabulary);
  }

  train(texts: string[], labels: string[]): this {
    const m = this.model;
    texts.forEach((text, i) => {
      const label = labels[i];
      if (!m.classes.includes(label)) {
        m.classes.push(label);
        m.docCounts[label] = 0;
        m.tokenCounts[label] = {};
        m.totalTokens[label] = 0;
      }
      m.docCounts[label]++;
      for (const token of tokenize(text)) {
        m.tokenCounts[label][token] = (m.tokenCounts[label][token] ?? 0) + 1;
        m.totalTokens[label]++;
        this.vocab.add(token);
      }
    });
    m.vocabulary = [...this.vocab];
    return this;
  }

  predict(text: string): Prediction {
    const m = this.model;
    const tokens = tokenize(text).filter((t) => this.vocab.has(t));
    const totalDocs = Object.values(m.docCounts).reduce((a, b) => a + b, 0);
    const vocabSize = this.vocab.size;

    const logScores: Record<string, number> = {};
    for (const c of m.classes) {
      let score = Math.log(m.docCounts[c] / totalDocs);
      const denominator = m.totalTokens[c] + m.alpha * vocabSize;
      for (const t of tokens) {
        score += Math.log(((m.tokenCounts[c][t] ?? 0) + m.alpha) / denominator);
      }
      logScores[c] = score;
    }

    // Softmax: convert log scores to probabilities that sum to 1
    const max = Math.max(...Object.values(logScores));
    const exp = Object.fromEntries(m.classes.map((c) => [c, Math.exp(logScores[c] - max)]));
    const sum = Object.values(exp).reduce((a, b) => a + b, 0);
    const probabilities = Object.fromEntries(m.classes.map((c) => [c, exp[c] / sum]));

    const label = m.classes.reduce((best, c) => (probabilities[c] > probabilities[best] ? c : best));
    return { label, confidence: probabilities[label], probabilities };
  }

  toJSON(): NaiveBayesModel {
    return this.model;
  }
}
