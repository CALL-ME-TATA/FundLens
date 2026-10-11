import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xirr } from './xirr.ts';

test('matches Excel XIRR documentation example (37.34%)', () => {
  const r = xirr([
    { amount: -10000, date: '2008-01-01' },
    { amount: 2750, date: '2008-03-01' },
    { amount: 4250, date: '2008-10-30' },
    { amount: 3250, date: '2009-02-15' },
    { amount: 2750, date: '2009-04-01' },
  ]);
  assert.ok(r !== null && Math.abs(r - 0.373362535) < 1e-6, `got ${r}`);
});

test('one year, 10% gain -> 10%', () => {
  const r = xirr([{ amount: -1000, date: '2023-01-01' }, { amount: 1100, date: '2024-01-01' }]);
  assert.ok(r !== null && Math.abs(r - 0.1) < 1e-6, `got ${r}`);
});

test('loss gives negative rate', () => {
  const r = xirr([{ amount: -1000, date: '2023-01-01' }, { amount: 800, date: '2024-01-01' }]);
  assert.ok(r !== null && Math.abs(r + 0.2) < 1e-6, `got ${r}`);
});

test('no inflow -> null', () => {
  assert.equal(xirr([{ amount: -1000, date: '2023-01-01' }]), null);
});
