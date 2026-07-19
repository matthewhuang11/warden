export interface TreasuryPosition {
  availableBalanceCents: number;
  pendingDebitCents: number;
  nextPayrollCents: number;
  minimumOperatingBalanceCents: number;
  destinationCapacityCents: number;
}

export interface SweepInstruction {
  transferCents: number;
  retainedBalanceCents: number;
  reason: 'excess_cash' | 'insufficient_buffer' | 'capacity_limit';
}

const PENDING_DEBIT_BUFFER_RATE = 1.1;
const PAYROLL_BUFFER_RATE = 1.05;

export function planTreasurySweep(position: TreasuryPosition): SweepInstruction {
  const debitBuffer = Math.ceil(position.pendingDebitCents * PENDING_DEBIT_BUFFER_RATE);
  const payrollBuffer = Math.ceil(position.nextPayrollCents * PAYROLL_BUFFER_RATE);
  const requiredLiquidity = Math.max(position.minimumOperatingBalanceCents, debitBuffer + payrollBuffer);
  const availableToSweep = Math.max(0, position.availableBalanceCents - requiredLiquidity);
  const transferCents = Math.min(availableToSweep, Math.max(0, position.destinationCapacityCents));

  let reason: SweepInstruction['reason'] = 'excess_cash';
  if (availableToSweep === 0) reason = 'insufficient_buffer';
  else if (transferCents < availableToSweep) reason = 'capacity_limit';

  return {
    transferCents,
    retainedBalanceCents: position.availableBalanceCents - transferCents,
    reason,
  };
}
