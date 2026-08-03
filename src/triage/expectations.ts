export interface CaseExpectation {
  scopePlatform?: string;
  forbidPlatforms?: string[];
  entity?: string;
  entityExists?: boolean;
  mustNotWrite?: boolean;
}

export type ExpectationMap = Record<string, CaseExpectation>;

/** Parse a hand-authored expectations file (tag → expectation). Pure; never throws. */
export function parseExpectations(json: string): ExpectationMap {
  try {
    const obj = JSON.parse(json) as unknown;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    return obj as ExpectationMap;
  } catch {
    return {};
  }
}

export function expectationFor(map: ExpectationMap, messageId: string): CaseExpectation | undefined {
  return map[messageId];
}
