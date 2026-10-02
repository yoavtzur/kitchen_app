import { describe, expect, it } from 'vitest';
import { assigneeInitial, showCookCompletions, showStationHeadings, showStationTabs } from '../taskRow';

const station = { id: 'station-hot', name: 'פס חם', createdAt: '2026-10-01' };

describe('showStationTabs', () => {
  it('hides the tabs until the kitchen has a station of its own', () => {
    expect(showStationTabs([])).toBe(false);
    expect(showStationTabs(undefined)).toBe(false);
    expect(showStationTabs(null)).toBe(false);
  });

  it('shows them as soon as there is one to narrow to', () => {
    expect(showStationTabs([station])).toBe(true);
  });
});

describe('showStationHeadings', () => {
  it('drops the heading over the only group when there are no tabs', () => {
    expect(showStationHeadings(1, false)).toBe(false);
  });

  it('keeps headings when there are several groups', () => {
    expect(showStationHeadings(2, false)).toBe(true);
  });

  it('keeps the headings of the survey view whenever the tabs are shown', () => {
    expect(showStationHeadings(1, true)).toBe(true);
  });
});

describe('assigneeInitial', () => {
  it('takes the first letter of the name', () => {
    expect(assigneeInitial('דני')).toBe('ד');
    expect(assigneeInitial('  מאיה ')).toBe('מ');
  });

  it('does not split a character made of several code units', () => {
    expect(assigneeInitial('😀 צוות')).toBe('😀');
  });

  it('has an answer for an empty name', () => {
    expect(assigneeInitial('   ')).toBe('?');
  });
});

describe('showCookCompletions', () => {
  it('waits for the first completed task', () => {
    expect(showCookCompletions([{ count: 0 }, { count: 0 }])).toBe(false);
    expect(showCookCompletions([])).toBe(false);
    expect(showCookCompletions([{ count: 0 }, { count: 2 }])).toBe(true);
  });
});
