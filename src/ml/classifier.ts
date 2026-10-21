/**
 * Loads the trained model once and predicts the severity of a bug from its error message.
 */
import fs from 'node:fs';
import { config, Severity } from '../config';
import { NaiveBayesClassifier, Prediction } from './naiveBayes';

let classifier: NaiveBayesClassifier | null = null;

function load(): NaiveBayesClassifier {
  if (classifier) return classifier;
  if (!fs.existsSync(config.modelPath)) {
    throw new Error(`Severity model not found at ${config.modelPath}. Run "npm run train" first.`);
  }
  const saved = JSON.parse(fs.readFileSync(config.modelPath, 'utf8'));
  classifier = new NaiveBayesClassifier(saved.model);
  return classifier;
}

export function predictSeverity(errorMessage: string): Prediction & { label: Severity } {
  return load().predict(errorMessage) as Prediction & { label: Severity };
}

// Quick manual check:  npx tsx src/ml/classifier.ts "500 Internal Server Error on checkout"
if (require.main === module) {
  const text = process.argv.slice(2).join(' ');
  console.log(predictSeverity(text));
}
