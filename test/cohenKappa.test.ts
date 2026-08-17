import { describe, expect, it } from "vitest";
import { cohenKappa } from "../src/calibration/cohenKappa.js";

describe("cohenKappa", () => {
  it("returns null for an empty set of pairs", () => {
    expect(cohenKappa([])).toBeNull();
  });

  it("returns null (undefined), not 1.0, when every pair falls in a single shared category", () => {
    const pairs = [
      { judge: 3, human: 3 },
      { judge: 3, human: 3 },
      { judge: 3, human: 3 },
    ];
    expect(cohenKappa(pairs)).toBeNull();
  });

  it("returns 1.0 for perfect agreement with real category spread", () => {
    const pairs = [
      { judge: 0, human: 0 },
      { judge: 1, human: 1 },
      { judge: 2, human: 2 },
      { judge: 3, human: 3 },
    ];
    expect(cohenKappa(pairs)).toBeCloseTo(1.0, 6);
  });

  it("returns a value below 1.0 when raters disagree some of the time", () => {
    const pairs = [
      { judge: 3, human: 3 },
      { judge: 3, human: 3 },
      { judge: 0, human: 3 }, // one strong disagreement
      { judge: 2, human: 2 },
    ];
    const kappa = cohenKappa(pairs);
    expect(kappa).not.toBeNull();
    expect(kappa!).toBeLessThan(1.0);
  });

  it("returns a value at or below 0 for chance-level (or worse) agreement", () => {
    // Judge and human never agree, and each uses both categories evenly -- textbook
    // chance-or-worse agreement.
    const pairs = [
      { judge: 0, human: 1 },
      { judge: 1, human: 0 },
      { judge: 0, human: 1 },
      { judge: 1, human: 0 },
    ];
    const kappa = cohenKappa(pairs);
    expect(kappa).not.toBeNull();
    expect(kappa!).toBeLessThanOrEqual(0);
  });
});
