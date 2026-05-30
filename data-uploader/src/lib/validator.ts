/**
 * Validator — Phase 2 stub.
 *
 * Concept § 5 picked: Schema-Score (local) + Server-Diff (remote, post-upload).
 * Local part lives here. Each extracted Entity is validated against a JSON
 * schema; per-Entity field-coverage % feeds an aggregate quality score 0..100.
 *
 * For Phase 1, exposes the surface — `scoreExtraction` returns a synthetic
 * placeholder so the UI can render an indicator. Real schemas land in
 * Phase 2 (json-schema files per Entity type: Ship, Weapon, Component, Item).
 */

import type { ExtractionResult } from './extractor.js';

export interface ValidationReport {
  qualityScore: number;
  perEntityType: Record<string, { coverage: number; missingFields: string[] }>;
  warnings: string[];
  status: 'green' | 'yellow' | 'red';
}

export function scoreExtraction(result: ExtractionResult): ValidationReport {
  const counts = result.entityCounts;
  const totalEntities = Object.values(counts).reduce((a, b) => a + b, 0);

  if (totalEntities === 0) {
    return {
      qualityScore: 0,
      perEntityType: {},
      warnings: ['no entities extracted'],
      status: 'red',
    };
  }

  // Phase 1 heuristic: just check there are reasonable counts present.
  // Replace with real per-Entity schema validation in Phase 2.
  const score =
    Math.min(100, Math.round((counts['ships'] ?? 0) > 0 ? 50 : 20) +
      (counts['items'] ?? 0 > 0 ? 25 : 0) +
      (counts['weapons'] ?? 0 > 0 ? 15 : 0) +
      (counts['components'] ?? 0 > 0 ? 10 : 0));

  const status: ValidationReport['status'] =
    score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red';

  return {
    qualityScore: score,
    perEntityType: {},
    warnings: score < 80 ? ['phase-1 heuristic only — replace with real schema in phase 2'] : [],
    status,
  };
}
