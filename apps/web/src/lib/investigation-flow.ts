// Where an incident stands on the path from AI investigation to verified
// recovery, derived only from records the API returned. The stepper renders
// this; nothing here decides anything, it describes what already happened.

import type { Investigation, RecoveryAction } from '@/lib/schemas';

export type StepState = 'done' | 'active' | 'blocked' | 'failed' | 'pending' | 'skipped';

export interface FlowStep {
  key: 'analysis' | 'validation' | 'policy' | 'approval' | 'verification';
  label: string;
  state: StepState;
  detail: string;
}

type Outcome = Pick<FlowStep, 'state' | 'detail'>;

// Statuses an action reaches only after an operator approved it.
const APPROVED = new Set(['approved', 'running', 'succeeded', 'failed', 'blocked']);

function analysis(investigation: Investigation | undefined): Outcome {
  if (!investigation) return { state: 'pending', detail: 'Not requested yet' };
  if (investigation.status === 'completed') return { state: 'done', detail: 'Model answered over bounded, redacted evidence' };
  if (investigation.status === 'error') return { state: 'failed', detail: 'The model call failed; nothing changed' };
  return { state: 'active', detail: 'Model is analysing the evidence' };
}

function validation(investigation: Investigation | undefined): Outcome {
  if (investigation?.status === 'completed') return { state: 'done', detail: 'Strict schema; targets limited to this incident' };
  if (investigation?.status === 'error') return { state: 'failed', detail: 'Rejected before anything was proposed' };
  return { state: 'pending', detail: 'Waits for the model' };
}

function policy(investigation: Investigation | undefined, action: RecoveryAction | undefined): Outcome {
  if (investigation?.status !== 'completed') return { state: 'pending', detail: 'Deterministic rules, never the model' };
  if (!action) return { state: 'skipped', detail: 'No action recommended' };
  if (action.status === 'rejected_by_policy') {
    return { state: 'blocked', detail: `Blocked at the ${action.blockedAt ?? 'policy'} step` };
  }
  return { state: 'done', detail: 'Every proposal-time rule passed' };
}

function approval(previous: Outcome, action: RecoveryAction | undefined): Outcome {
  if (previous.state === 'blocked' || previous.state === 'skipped') return { state: 'skipped', detail: 'Nothing to approve' };
  if (previous.state !== 'done' || !action) return { state: 'pending', detail: 'An operator decides' };
  if (action.status === 'awaiting_approval') return { state: 'active', detail: 'Waiting for an operator' };
  if (action.status === 'rejected') return { state: 'blocked', detail: 'Rejected by an operator' };
  if (action.status === 'expired') return { state: 'blocked', detail: 'The approval expired unused' };
  if (APPROVED.has(action.status)) return { state: 'done', detail: 'Approved; policy re-checked before running' };
  return { state: 'pending', detail: 'An operator decides' };
}

function verification(previous: Outcome, action: RecoveryAction | undefined): Outcome {
  if (previous.state === 'blocked' || previous.state === 'skipped') return { state: 'skipped', detail: 'Nothing ran' };
  if (previous.state !== 'done' || !action) return { state: 'pending', detail: 'Resolved only when every lab is ready' };
  if (action.status === 'blocked') return { state: 'blocked', detail: 'Blocked when policy was re-checked at execution' };
  const result = action.verificationResult;
  if (!result) return { state: 'active', detail: 'Running the action, then re-reading every lab' };
  return result.passed
    ? { state: 'done', detail: 'Every lab re-read and ready' }
    : { state: 'failed', detail: 'Labs not ready; the incident stays open' };
}

/** The newest investigation and the newest action (the API lists both newest first). */
export function flowSteps(investigation: Investigation | undefined, action: RecoveryAction | undefined): FlowStep[] {
  const policyStep = policy(investigation, action);
  const approvalStep = approval(policyStep, action);
  return [
    { key: 'analysis', label: 'AI analysis', ...analysis(investigation) },
    { key: 'validation', label: 'Output checked', ...validation(investigation) },
    { key: 'policy', label: 'Policy check', ...policyStep },
    { key: 'approval', label: 'Human approval', ...approvalStep },
    { key: 'verification', label: 'Verified', ...verification(approvalStep, action) },
  ];
}
