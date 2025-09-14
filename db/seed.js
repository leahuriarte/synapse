import 'dotenv/config';
import { insertSnapshot } from '../server/lib/dao.js';

// Simple demo graphs to verify the pipeline end-to-end.
const DG = `graph TD;
  C001["Linear Algebra"] --> C002["Regression"];
  C001 --> C003["Optimization"];
  C003 --> C004["Gradient Descent"];
  C002 --- C005["Evaluation Metrics"];
`;

const SG = `graph TD;
  W1["Week 1: Foundations"] --> L1["Vectors & Matrices"];
  W2["Week 2: Modeling"] --> L2["Linear Regression"];
  L2 --> A1["Assignment 1"];
  W3["Week 3: Optimization"] --> L3["Gradient Descent"];
`;

const PG = `graph TD;
  P1["Vectors & Matrices"] --> P2["Dot Product"];
  P1 --- P3["Matrix Multiplication"];
`;

(async function main() {
  try {
    insertSnapshot('domain', DG);
    insertSnapshot('syllabus', SG);
    insertSnapshot('personal', PG);
    console.log('[seed] Inserted demo snapshots for DG/SG/PG');
  } catch (e) {
    console.error('[seed] Failed:', e);
    process.exit(1);
  }
})();
