import { describe, expect, it } from 'vitest';

import { AI_EVENT_TYPES } from '../src/ai/contracts.js';
import { routeAiEvent } from '../src/ai/router.js';

describe('deterministic AI event router', () => {
  it('routes overdue deliveries through materials, planning, then PM', () => {
    expect(routeAiEvent('material_delivery_overdue').agents).toEqual([
      'materials',
      'planning',
      'pm'
    ]);
  });

  it('adds planning to low-stock events only when linked work exists', () => {
    expect(routeAiEvent('material_stock_low').agents).toEqual(['materials', 'pm']);
    expect(routeAiEvent('material_stock_low', { linkedWorkExists: true }).agents).toEqual([
      'materials',
      'planning',
      'pm'
    ]);
  });

  it('adds materials to overdue tasks only when procurement relevance exists', () => {
    expect(routeAiEvent('task_overdue').agents).toEqual(['planning', 'pm']);
    expect(routeAiEvent('task_overdue', { materialOrProcurementRelevant: true }).agents).toEqual([
      'planning',
      'materials',
      'pm'
    ]);
  });

  it('adds materials to site issues only when procurement relevance exists', () => {
    expect(routeAiEvent('site_issue_created').agents).toEqual(['planning', 'pm']);
    expect(routeAiEvent('site_issue_created', { materialOrProcurementRelevant: true }).agents).toEqual([
      'planning',
      'materials',
      'pm'
    ]);
  });

  it('always puts PM last with no duplicated agent', () => {
    for (const eventType of AI_EVENT_TYPES) {
      for (const relevant of [false, true]) {
        const route = routeAiEvent(eventType, {
          linkedWorkExists: relevant,
          materialOrProcurementRelevant: relevant
        });
        expect(route.agents.at(-1)).toBe('pm');
        expect(new Set(route.agents).size).toBe(route.agents.length);
      }
    }
  });
});
