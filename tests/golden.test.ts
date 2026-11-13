// Golden-file regression tests for the 5 reference cases (tests/golden/cases.mjs).
//
// tests/golden/concept-v7/  outputs of the original concept (v7), frozen by `npm run golden`.
//                           Phase 1 matched these exactly (commit b8a9c98). Kept as the historical baseline;
//                           `npm run compare:concept` reports how each case's best design has moved since.
// tests/golden/engine/      snapshots of the current engine. Any change in results fails this test;
//                           after an intended change run `npm run golden:update` and explain it in the commit.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { CASES } from './golden/cases.mjs';
import { runCase } from './golden/run';

describe('golden: engine matches its snapshots', () => {
  for (const name of Object.keys(CASES)) {
    it(name, async () => {
      await expect(JSON.stringify(runCase(name)) + '\n').toMatchFileSnapshot(join(__dirname, 'golden', 'engine', name + '.json'));
    }, 60000);
  }
});
