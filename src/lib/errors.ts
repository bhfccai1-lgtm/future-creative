export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}
export class BudgetExceededError extends AppError {
  constructor(message: string) { super('BUDGET_EXCEEDED', message, 402); }
}
export class KillSwitchError extends AppError {
  constructor() { super('KILL_SWITCH_ACTIVE', 'Global kill switch is active — all publishing is halted', 423); }
}
export class ConfigurationError extends AppError {
  constructor(message: string) { super('CONFIGURATION_MISSING', message, 412); }
}
