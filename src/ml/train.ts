/**
 * Trains and evaluates the bug-severity classifier (Objective 2).
 *
 *   npm run train
 *
 * 1. Loads the labelled dataset  src/ml/training-data.csv  (severity, error_message)
 * 2. Stratified 80/20 train/test split -> accuracy, precision, recall, F1, confusion matrix
 * 3. Stratified 5-fold cross-validation -> mean accuracy (a more stable estimate)
 * 4. Trains the final model on 100% of the data and saves it to src/ml/model/severity-model.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, SEVERITIES } from '../config';
import { NaiveBayesClassifier } from './naiveBayes';

interface Sample { text: string; label: string }

/** Minimal CSV parser that supports quoted fields and "" escapes. */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"' && content[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

export function loadDataset(file = config.trainingDataPath): Sample[] {
  const [, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
  return rows.map(([label, text]) => ({ label: label.trim(), text }));
}

/** Deterministic pseudo-random generator so results are reproducible. */
function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Splits samples into k folds keeping the class proportions equal in each fold. */
function stratifiedFolds(samples: Sample[], k: number, seed = 42): Sample[][] {
  const rand = seededRandom(seed);
  const folds: Sample[][] = Array.from({ length: k }, () => []);
  for (const label of SEVERITIES) {
    shuffle(samples.filter((s) => s.label === label), rand).forEach((s, i) => folds[i % k].push(s));
  }
  return folds;
}

function evaluate(train: Sample[], test: Sample[]) {
  const clf = new NaiveBayesClassifier().train(train.map((s) => s.text), train.map((s) => s.label));
  const labels = SEVERITIES as string[];
  const matrix: Record<string, Record<string, number>> = Object.fromEntries(
    labels.map((a) => [a, Object.fromEntries(labels.map((p) => [p, 0]))]),
  );
  let correct = 0;
  for (const s of test) {
    const predicted = clf.predict(s.text).label;
    matrix[s.label][predicted]++;
    if (predicted === s.label) correct++;
  }

  const perClass = Object.fromEntries(
    labels.map((c) => {
      const tp = matrix[c][c];
      const fp = labels.reduce((sum, a) => sum + (a !== c ? matrix[a][c] : 0), 0);
      const fn = labels.reduce((sum, p) => sum + (p !== c ? matrix[c][p] : 0), 0);
      const precision = tp + fp ? tp / (tp + fp) : 0;
      const recall = tp + fn ? tp / (tp + fn) : 0;
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      return [c, { precision, recall, f1, support: tp + fn }];
    }),
  );
  return { accuracy: correct / test.length, matrix, perClass };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function main() {
  const data = loadDataset();
  console.log(`\nLoaded ${data.length} labelled error messages`);
  for (const s of SEVERITIES) console.log(`  ${s.padEnd(9)} ${data.filter((d) => d.label === s).length}`);

  // ---- 1. Hold-out evaluation (80% train / 20% test)
  const folds = stratifiedFolds(data, 5);
  const holdOut = evaluate(folds.slice(1).flat(), folds[0]);
  console.log(`\n=== Hold-out test set (80/20 stratified split, ${folds[0].length} samples) ===`);
  console.log(`Accuracy: ${pct(holdOut.accuracy)}\n`);
  console.log('Class      Precision  Recall   F1-score  Support');
  for (const [c, m] of Object.entries(holdOut.perClass)) {
    console.log(`${c.padEnd(10)} ${pct(m.precision).padEnd(10)} ${pct(m.recall).padEnd(8)} ${pct(m.f1).padEnd(9)} ${m.support}`);
  }
  console.log('\nConfusion matrix (rows = actual, columns = predicted)');
  console.log(`${''.padEnd(10)} ${SEVERITIES.map((s) => s.padEnd(9)).join('')}`);
  for (const a of SEVERITIES) {
    console.log(`${a.padEnd(10)} ${SEVERITIES.map((p) => String(holdOut.matrix[a][p]).padEnd(9)).join('')}`);
  }

  // ---- 2. 5-fold cross-validation
  const cvScores = folds.map((testFold, i) => evaluate(folds.filter((_, j) => j !== i).flat(), testFold).accuracy);
  const cvMean = cvScores.reduce((a, b) => a + b, 0) / cvScores.length;
  console.log(`\n=== 5-fold cross-validation ===`);
  console.log(`Fold accuracies: ${cvScores.map(pct).join(', ')}`);
  console.log(`Mean accuracy:   ${pct(cvMean)}`);

  // ---- 3. Final model on all data
  const finalModel = new NaiveBayesClassifier().train(data.map((d) => d.text), data.map((d) => d.label));
  const output = {
    algorithm: 'Multinomial Naive Bayes (unigrams + bigrams, Laplace smoothing)',
    trainedAt: new Date().toISOString(),
    trainingSamples: data.length,
    metrics: {
      holdOutAccuracy: holdOut.accuracy,
      holdOutSamples: folds[0].length,
      crossValidationAccuracy: cvMean,
      crossValidationFolds: cvScores,
      perClass: holdOut.perClass,
      confusionMatrix: holdOut.matrix,
    },
    model: finalModel.toJSON(),
  };
  fs.mkdirSync(path.dirname(config.modelPath), { recursive: true });
  fs.writeFileSync(config.modelPath, JSON.stringify(output));
  console.log(`\nModel saved to ${path.relative(process.cwd(), config.modelPath)} (vocabulary: ${output.model.vocabulary.length} features)\n`);
}

if (require.main === module) main();
