import { describe, it, expect } from 'vitest';
import { parseJudgedCsv } from '../src/importJudged/importCommand.js';

const csv = `# NOTE: memory shown is CURRENT, not as it was at answer time.
run_id,message_id,user_query,answer_text,verdict,category,severity,rationale
r1,a1,q1,ans1,broken,hallucination,high,"made up numbers"
r1,a2,q2,ans2,,,,
r1,a3,q3,ans3,good,,low,"fine"`;

describe('parseJudgedCsv', () => {
  it('parses judged rows and skips the comment line + unjudged rows', () => {
    const rows = parseJudgedCsv(csv);
    expect(rows).toHaveLength(2); // a2 has no verdict → skipped
    expect(rows[0]).toMatchObject({ run_id: 'r1', message_id: 'a1', verdict: 'broken', category: 'hallucination', severity: 'high' });
    expect(rows[1]).toMatchObject({ message_id: 'a3', verdict: 'good' });
  });
});
