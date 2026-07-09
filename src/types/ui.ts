export type ProposalDecisionStatus =
  | { state: "pending"; approved: boolean }
  | { state: "done"; approved: boolean; detail?: string };

export type ProposalStatusMap = Record<string, ProposalDecisionStatus>;
