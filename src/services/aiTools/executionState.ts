// AI execution state - separated to avoid circular imports
// between aiTools/index.ts and handlers/clips.ts

let _aiExecutionActive = false;
let _totalStaggerBudgetMs = 3000;
let _remainingStaggerBudgetMs = 3000;

export function setAIExecutionActive(active: boolean): void {
  _aiExecutionActive = active;
}

export function isAIExecutionActive(): boolean {
  return _aiExecutionActive;
}

/**
 * Set the total stagger budget for the current operation.
 * All visual stagger delays (splits, reorders, batch steps) share this budget.
 * Once the budget is spent, remaining steps execute instantly.
 */
export function setStaggerBudget(budgetMs: number): void {
  _totalStaggerBudgetMs = budgetMs;
  _remainingStaggerBudgetMs = budgetMs;
}

/**
 * Calculate the delay for one step given how many steps remain.
 * Spreads remaining budget evenly across remaining steps.
 * Returns 0 if budget is exhausted.
 */
export function consumeStaggerDelay(remainingSteps: number): number {
  if (remainingSteps <= 0 || _remainingStaggerBudgetMs <= 0) return 0;
  const delay = Math.min(1000, Math.floor(_remainingStaggerBudgetMs / remainingSteps));
  _remainingStaggerBudgetMs -= delay;
  return delay;
}

export function getStaggerBudget(): number {
  return _totalStaggerBudgetMs;
}
