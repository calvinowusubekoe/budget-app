export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type WorkspaceType = 'personal' | 'business';

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  defaultCurrency: string;
  locale: string;
  timezone: string;
  lastWorkspaceId: string | null;
  onboardingCompleted: boolean;
  marketingConsent: boolean;
  /** Can read tester feedback (ADMIN_EMAILS on the server). */
  isAdmin?: boolean;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  type: WorkspaceType;
  baseCurrency: string;
  ownerId: string;
  status: 'active' | 'archived';
  business?: { legalName: string; industry: string; country: string };
  aiAssistantEnabled?: boolean;
  role: Role;
  permissions: string[];
  createdAt: string;
}

export interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  actor: { id: string; name: string } | null;
  createdAt: string;
}

export interface Meta {
  currencies: { featured: string[]; all: string[] };
  legal: { termsVersion: string; privacyVersion: string };
  /** 'test' for a tester build: shows a banner and may offer a shared demo account. */
  stage?: 'live' | 'test';
  demo?: { email: string; password: string } | null;
}

export interface AuthResult {
  user: User;
  accessToken: string;
}

/* ---------- Phase 2: money ---------- */

export type AccountType = 'cash' | 'bank' | 'mobile_money' | 'savings' | 'other';
export type TxType = 'income' | 'expense' | 'transfer';
export type RateSource = 'same' | 'entered' | 'manual' | 'provider';
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  institution: string;
  notes: string;
  status: 'active' | 'archived';
  openingBalance: string;
  openingDate: string;
  balance: string;
  transactionCount: number;
  createdAt: string;
}

export interface Category {
  id: string;
  kind: 'income' | 'expense';
  name: string;
  icon: string;
  systemKey: string | null;
  archived: boolean;
}

export interface ReportingSnapshot {
  currency: string;
  rate: string;
  amount: string;
  source: RateSource;
  estimated: boolean;
  rateDate: string | null;
  provider: string | null;
  providerLabel: string | null;
}

export interface Transaction {
  id: string;
  type: TxType;
  account: { id: string; name: string; currency: string; type?: AccountType; status?: string };
  toAccount: { id: string; name: string; currency: string } | null;
  category: { id: string; name: string; icon: string; kind: 'income' | 'expense' } | null;
  amount: string;
  currency: string;
  toAmount: string | null;
  toCurrency: string | null;
  date: string;
  description: string;
  payee: string;
  notes: string;
  reporting: ReportingSnapshot;
  recurrence: { isRecurring: boolean; frequency: Frequency | null };
  recurringId: string | null;
  invoiceId?: string | null;
  billId?: string | null;
  status: 'recorded' | 'reconciled';
  reconciledAt: string | null;
  attachmentCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionInput {
  type: TxType;
  accountId: string;
  categoryId?: string | null;
  toAccountId?: string | null;
  amount: string;
  toAmount?: string | null;
  exchangeRate?: string;
  date: string;
  description: string;
  payee?: string;
  notes?: string;
  recurrence?: { isRecurring: boolean; frequency: Frequency | null };
  version?: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface ExchangeRate {
  id: string;
  from: string;
  to: string;
  rate: string;
  effectiveDate: string;
  source: 'manual' | 'provider';
  provider: string | null;
  providerLabel: string | null;
  fetchedAt: string | null;
  createdAt: string;
}

export interface RateResolution {
  from: string;
  to: string;
  date: string;
  found: boolean;
  rate?: string;
  source?: RateSource;
  estimated?: boolean;
  rateDate?: string;
  provider?: string | null;
  convertedAmount: string | null;
  providerAvailable: boolean;
}

export interface CategoryTotal {
  categoryId: string;
  name: string;
  icon: string;
  amount: string;
  count: number;
  share: string;
}

export interface Summary {
  currency: string;
  from: string | null;
  to: string | null;
  income: string;
  expense: string;
  net: string;
  incomeCount: number;
  expenseCount: number;
  incomeByCategory: CategoryTotal[];
  expenseByCategory: CategoryTotal[];
}

export interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface Dashboard extends DashboardPlanning {
  summary: Summary;
  accounts: Account[];
  recent: Transaction[];
  totalTransactions: number;
}

/* ---------- Phase 3: planning ---------- */

export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';
export type PlanFrequency = 'weekly' | 'monthly' | 'quarterly' | 'none';

export interface PeriodProgress {
  start: string;
  end: string;
  key: string;
  amount: string;
  spent: string;
  remaining: string;
  utilisation: string;
  state: 'under' | 'warning' | 'over';
  transactionCount?: number;
  daysLeft?: number;
}

export interface Budget {
  id: string;
  name: string;
  period: BudgetPeriod;
  scope: 'all' | 'categories';
  categories: { id: string; name: string; icon: string }[];
  currency: string;
  alertAt: number;
  status: 'active' | 'paused' | 'archived';
  notes: string;
  amountHistory: { amount: string; effectiveFrom: string }[];
  current: PeriodProgress;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  type: 'contribution' | 'withdrawal' | 'payment' | 'charge';
  amount: string;
  date: string;
  notes: string;
  status: 'recorded' | 'reversed';
  reversedAt: string | null;
  reversalReason: string;
  createdAt: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  description: string;
  targetAmount: string;
  currency: string;
  targetDate: string | null;
  contributionFrequency: PlanFrequency;
  notes: string;
  status: 'active' | 'archived';
  summary: {
    contributed: string;
    withdrawn: string;
    current: string;
    remaining: string;
    progress: string;
    reached: boolean;
    entryCount: number;
    projectedDate: string | null;
    requiredPerPeriod: string | null;
    onTrack: boolean | null;
    overdue: boolean;
  };
  createdAt: string;
}

export interface Debt {
  id: string;
  name: string;
  direction: 'i_owe' | 'owed_to_me';
  counterparty: string;
  principal: string;
  currency: string;
  interestRate: string | null;
  startDate: string;
  dueDate: string | null;
  minimumPayment: string | null;
  paymentFrequency: PlanFrequency;
  notes: string;
  status: 'active' | 'paid_off' | 'archived';
  paidOffAt: string | null;
  summary: {
    paid: string;
    charges: string;
    owedTotal: string;
    balance: string;
    paidPercent: string;
    paymentCount: number;
    lastPaymentDate: string | null;
    overdue: boolean;
    projectedPayoff: string | null;
  };
  createdAt: string;
}

export interface RecurringSchedule {
  id: string;
  type: TxType;
  description: string;
  payee: string;
  notes: string;
  amount: string;
  currency: string;
  toAmount: string | null;
  account: { id: string; name: string; currency: string } | null;
  toAccount: { id: string; name: string; currency: string } | null;
  category: { id: string; name: string; icon: string } | null;
  frequency: Frequency;
  interval: number;
  anchorDate: string;
  endDate: string | null;
  mode: 'auto' | 'remind';
  status: 'active' | 'paused' | 'ended';
  nextDate: string | null;
  upcoming: string[];
  pending: string[];
  created: number;
  lastRunAt: string | null;
  lastError: string | null;
}

export interface AppNotification {
  id: string;
  workspaceId: string | null;
  type: 'budget_warning' | 'budget_exceeded' | 'recurring_due' | 'recurring_failed' | 'recurring_created';
  title: string;
  body: string;
  link: string | null;
  data: Record<string, string>;
  read: boolean;
  resolved: boolean;
  createdAt: string;
}

export interface DashboardPlanning {
  susu: SusuTotals[];
  budgets: Budget[];
  savings: { currency: string; goals: number; saved: string; target: string }[];
  debts: { direction: Debt['direction']; currency: string; balance: string; count: number; overdue: number }[];
}

/* ---------- Phase 4: Personal Susu (record-keeping only) ---------- */

export type SusuLocationType = 'home_box' | 'envelope' | 'safe' | 'collector' | 'other';
export type SusuWindowStatus = 'met' | 'partial' | 'missed' | 'open' | 'paused';

export interface SusuScheduleStats {
  periods: number;
  met: number;
  partial: number;
  missed: number;
  open: number;
  paused: number;
  expectedToDate: string;
  arrears: string;
  streak: number;
  nextDue: string | null;
}

export interface SusuWindow {
  index: number;
  due: string;
  end: string;
  expected: string;
  contributed: string;
  entries: number;
  status: SusuWindowStatus;
}

export interface SusuPlan {
  id: string;
  name: string;
  description: string;
  currency: string;
  targetAmount: string | null;
  contributionAmount: string;
  contributionHistory: { amount: string; effectiveFrom: string }[];
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom';
  intervalDays: number | null;
  startDate: string;
  targetDate: string | null;
  location: { type: SusuLocationType; label: string };
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  notes: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string;
  summary: {
    contributed: string;
    withdrawn: string;
    current: string;
    target: string | null;
    remaining: string | null;
    progress: string | null;
    reached: boolean;
    contributionCount: number;
    withdrawalCount: number;
    lastContribution: string | null;
    onScheduleFinish: string | null;
    schedule: SusuScheduleStats;
  };
  createdAt: string;
}

export interface SusuEntry {
  id: string;
  kind: 'contribution' | 'withdrawal';
  amount: string;
  currency: string;
  date: string;
  notes: string;
  reason?: string;
  status: 'recorded' | 'cancelled';
  cancelledAt: string | null;
  cancelReason: string;
  attachment: { name: string; mimeType: string; size: number } | null;
  createdAt: string;
}

export interface SusuMonth {
  month: string;
  contributed: string;
  withdrawn: string;
  net: string;
  contributions: number;
  withdrawals: number;
}

export interface SusuTotals {
  currency: string;
  plans: number;
  current: string;
  arrears: string;
  missed: number;
}

/* ---------- Phase 5: Group Susu (record-keeping only) ---------- */

export type GroupRole = 'organizer' | 'assistant' | 'member';
export type GroupCapability = 'manageSettings' | 'manageMembers' | 'manageCycles' | 'recordContributions' | 'recordPayouts' | 'viewAllRecords' | 'viewContacts' | 'cancelConfirmed';
export type GroupRecordStatus = 'recorded' | 'confirmed' | 'disputed' | 'cancelled';

export interface SusuGroup {
  id: string;
  name: string;
  description: string;
  currency: string;
  contributionAmount: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom';
  intervalDays: number | null;
  startDate: string;
  endDate: string | null;
  rotationMethod: 'fixed_order' | 'random' | 'manual';
  collectionSchedule: string;
  maxMembers: number;
  assistantPermissions: { manageMembers: boolean; manageCycles: boolean; recordContributions: boolean; recordPayouts: boolean };
  status: 'active' | 'completed' | 'cancelled';
  cancelReason: string;
  me: { memberId: string; role: GroupRole; status: string; capabilities: GroupCapability[] } | null;
  memberCount?: number;
  standing?: { outstanding: string; missedCycles: number; nextCycle: { number: number; dueDate: string; recipient?: string } | null } | null;
  createdAt: string;
}

export interface GroupMember {
  id: string;
  displayName: string;
  role: GroupRole;
  status: 'invited' | 'active' | 'suspended' | 'removed';
  registered: boolean;
  rotationPosition: number | null;
  joinedAt: string | null;
  contact?: { phone: string; email: string };
}

export interface GroupCycle {
  id: string;
  number: number;
  dueDate: string;
  recipient: { id: string; displayName: string };
  contributorCount: number;
  contributorMemberIds: string[];
  expectedPerMember: string;
  expectedPool: string;
  status: 'active' | 'cancelled';
  cancelReason: string;
  notes: string;
}

export interface RecordEvent {
  type: 'recorded' | 'corrected' | 'confirmed' | 'disputed' | 'cancelled';
  actor: string;
  reason: string;
  changes: Record<string, { from: string; to: string }> | null;
  at: string;
}

interface GroupRecordBase {
  id: string;
  cycleId: string;
  cycleNumber: number | null;
  currency: string;
  notes: string;
  status: GroupRecordStatus;
  recordedBy: string;
  events: RecordEvent[];
  canRespond: boolean;
  selfRecorded: boolean;
  /** A receipt or screenshot of the external payment, if someone added one. */
  proof: { name: string; mimeType: string; size: number; uploadedAt: string } | null;
  createdAt: string;
}

export interface GroupContribution extends GroupRecordBase {
  kind: 'contribution';
  member: { id: string; displayName: string };
  amount: string;
  date: string;
}

export interface GroupPayout extends GroupRecordBase {
  kind: 'payout';
  recipient: { id: string; displayName: string };
  expectedAmount: string;
  actualAmount: string;
  payoutDate: string;
  confirmationDetails: string;
}

export type CellState = 'paid' | 'partial' | 'missed' | 'due' | 'disputed' | 'scheduled';

export interface GroupReport {
  currency: string;
  asOf: string;
  totals: { cycles: number; dueCycles: number; expectedToDate: string; received: string; confirmed: string; outstanding: string; payoutsRecorded: number; payoutsConfirmed: number };
  cycles: {
    cycleId: string;
    number: number;
    dueDate: string;
    due: boolean;
    recipient: { id: string; displayName: string } | null;
    expectedPool: string;
    received: string;
    confirmed: string;
    disputed: string;
    outstanding: string;
    payout: { id: string; actualAmount: string; payoutDate: string; status: GroupRecordStatus } | null;
    members: { memberId: string; received: string; confirmed: string; disputed: string; state: CellState }[];
  }[];
  members: {
    member: { id: string; displayName: string };
    expectedToDate: string;
    received: string;
    confirmed: string;
    disputed: string;
    outstanding: string;
    missedCycles: number;
    partialCycles: number;
    upcoming: string;
  }[];
  disputes: { kind: 'contribution' | 'payout'; id: string; member?: { displayName: string }; amount: string; reason: string; at: string }[];
}

export interface GroupActivity {
  id: string;
  action: string;
  entityType: string;
  actor: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/* ---------- Phase 6: Business ---------- */

export type DocKind = 'invoice' | 'bill';
export type DocDisplayStatus = 'draft' | 'open' | 'overdue' | 'partially_paid' | 'paid' | 'void';

export interface Party {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  taxId: string;
  notes: string;
  status: 'active' | 'archived';
  outstanding: { currency: string; amount: string }[];
  createdAt: string;
}

export interface DocLine {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string | null;
  amount: string;
  tax: string;
}

export interface BizDocument {
  id: string;
  kind: DocKind;
  number: string;
  reference?: string;
  party: { id: string; name: string; email: string } | null;
  issueDate: string;
  dueDate: string;
  currency: string;
  lines: DocLine[];
  subtotal: string;
  taxTotal: string;
  total: string;
  paid: string;
  balance: string;
  status: 'draft' | 'issued' | 'void';
  displayStatus: DocDisplayStatus;
  daysOverdue: number;
  payments: { id: string; amount: string; date: string; account: { id: string; name: string }; transactionId: string; receiptCount: number; removed: boolean; removeReason: string }[];
  notes: string;
  terms: string;
  voidReason: string;
  issuedAt: string | null;
  createdAt: string;
}

export interface ProfitLoss {
  currency: string;
  basis: 'cash';
  note: string;
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  income: { total: string; byCategory: CategoryTotal[] };
  expenses: { total: string; byCategory: CategoryTotal[] };
  netProfit: string;
  margin: string | null;
  previous: { income: string; expenses: string; netProfit: string };
  change: Record<'income' | 'expenses' | 'netProfit', { amount: string; percent: string | null }>;
}

export interface CashFlow {
  currency: string;
  note: string;
  period: { from: string; to: string };
  months: { month: string; inflow: string; outflow: string; net: string; cumulative: string }[];
  totals: { inflow: string; outflow: string; net: string };
}

export type AgingTotals = { currency: string; total: string; count: number; current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string };

export interface Aging {
  kind: 'receivables' | 'payables';
  asOf: string;
  buckets: { key: keyof Omit<AgingTotals, 'currency' | 'total' | 'count'>; label: string }[];
  totals: AgingTotals[];
  items: { id: string; number: string; party: string; dueDate: string; daysOverdue: number; bucket: string; currency: string; balance: string }[];
}

export interface BusinessOverview {
  profitAndLoss: ProfitLoss;
  receivables: AgingTotals[];
  payables: AgingTotals[];
  overdueInvoices: number;
  overdueBills: number;
}

/* ---------------- Phase 7: subscriptions ---------------- */

export type PlanKey = 'free' | 'personal_pro' | 'business_pro';
export type BillingPeriod = 'monthly' | 'yearly';
export type LimitKey = 'accounts' | 'budgets' | 'savingsGoals' | 'debts' | 'recurring' | 'susuPlans' | 'invoicesPerMonth' | 'billsPerMonth' | 'aiQuestionsPerMonth' | 'receiptScansPerMonth';
export type PaymentProviderKey = 'paystack' | 'flutterwave';

export interface Plan {
  key: PlanKey;
  name: string;
  summary: string;
  workspaceType: WorkspaceType | null;
  limits: Record<LimitKey, number | null>;
  currency: string;
  /** Decimal strings; null when that period isn't on sale. */
  prices: Record<BillingPeriod, string | null> | null;
}

export interface PlansResponse {
  plans: Plan[];
  providers: { key: PaymentProviderKey; label: string; testMode: boolean }[];
}

export interface SubscriptionInfo {
  id: string;
  plan: Exclude<PlanKey, 'free'>;
  planName: string;
  billingPeriod: BillingPeriod;
  status: 'active' | 'past_due' | 'cancelled' | 'expired';
  startedAt: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  renewalDate: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  endedAt: string | null;
  provider: PaymentProviderKey;
  currency: string;
  amount: string;
  paymentStatus: 'paid' | 'refunded' | 'partially_refunded';
}

export interface CurrentPlan {
  plan: PlanKey;
  planName: string;
  /** none/expired/cancelled/lapsed → Free; active; ending (cancelled, still running); grace (ended, within grace period). */
  state: 'none' | 'active' | 'ending' | 'grace' | 'lapsed' | 'expired' | 'cancelled' | 'past_due';
  graceUntil: string | null;
  limits: Record<LimitKey, number | null>;
  usage: Record<LimitKey, number>;
  subscription: SubscriptionInfo | null;
}

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'abandoned' | 'review' | 'refunded' | 'partially_refunded';

export interface PlanPayment {
  id: string;
  reference: string;
  provider: PaymentProviderKey;
  plan: Exclude<PlanKey, 'free'>;
  planName: string;
  billingPeriod: BillingPeriod;
  amount: string;
  currency: string;
  status: PaymentStatus;
  failureReason: string | null;
  methodType: string | null;
  paidAt: string | null;
  fees: string | null;
  coverage: { start: string; end: string } | null;
  reconciliationStatus: 'unreconciled' | 'matched' | 'mismatch';
  refunds: { amount: string; status: string; processedAt: string | null }[];
  checkoutUrl: string | null;
  createdAt: string;
}

/* ---------------- Phase 8: analytics and AI ---------------- */

export type Granularity = 'month' | 'quarter' | 'year';

export interface SeriesPoint {
  key: string;
  label: string;
  start: string;
  end: string;
  income: string;
  expense: string;
  net: string;
  cumulativeNet: string;
  savingsRate: string | null;
}

export interface IncomeSpending {
  currency: string;
  from: string;
  to: string;
  granularity: Granularity;
  series: SeriesPoint[];
  totals: { income: string; expense: string; net: string; savingsRate: string | null };
  previous: { from: string; to: string; income: string; expense: string; net: string; incomeChange: string | null; expenseChange: string | null };
}

export interface SpendingCategory {
  categoryId: string;
  name: string;
  icon: string;
  amount: string;
  count: number;
  share: string;
  previous: string;
  change: string | null;
  threePeriodAverage: string;
}

export type Unusual =
  | { kind: 'category_spike'; categoryId: string; category: string; amount: string; average: string; ratio: string }
  | { kind: 'large_expense'; transactionId: string; date: string; category: string; amount: string; typical: string; ratio: string };

export interface SpendingAnalysis {
  currency: string;
  from: string;
  to: string;
  total: string;
  previousTotal: string;
  change: string | null;
  previous: { from: string; to: string };
  categories: SpendingCategory[];
  unusual: Unusual[];
  rules: string;
}

export interface FlowSeries {
  currency: string;
  points: { key: string; label: string; in: string; out: string; net: string }[];
}

export interface SavingsAnalysis {
  from: string;
  to: string;
  goals: SavingsGoal[];
  savingsFlow: FlowSeries[];
  personalSusu: { totals: { currency: string; plans: number; current: string; arrears: string; missed: number }[]; plans: { id: string; name: string; currency: string; status: string; current: string; progress: string; missed: number; arrears?: string; nextDue: string | null }[]; flow: FlowSeries[] };
  groupSusu: { groupId: string; name: string; currency: string; outstanding: string; missedCycles: number; nextCycle: { number: number; dueDate: string; recipient?: string } | null }[];
}

export interface CurrencyAmount {
  currency: string;
  amount: string;
  count: number;
}

export interface SeparatedTotals {
  from: string;
  to: string;
  trackedIncomeExpense: { currency: string; income: string; expense: string; count: number };
  transfers: CurrencyAmount[];
  savingsAllocations: { currency: string; contributed: string; withdrawn: string; count: number }[];
  personalSusu: { contributions: CurrencyAmount[]; withdrawals: CurrencyAmount[] };
  groupSusu: { yourContributions: CurrencyAmount[]; payoutsToYou: CurrencyAmount[] };
  subscriptionPayments: CurrencyAmount[] | null;
}

export interface Insight {
  id: string;
  topic: 'income' | 'spending' | 'budgets' | 'savings' | 'debts' | 'susu' | 'business';
  severity: 'warning' | 'info' | 'good';
  title: string;
  detail: string;
  figures: Record<string, string | null>;
  link: string;
}

export interface AiStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  consented: boolean;
  consentVersion: string;
  workspaceEnabled: boolean;
  usage: { used: number; limit: number | null };
  scans: { used: number; limit: number | null };
}

export interface AiAnswer {
  answer: string;
  kind: 'ai_suggestion';
  disclaimer: string;
  unverifiedFigures: string[];
  model: string;
  period: { from: string; to: string };
  insights: { title: string; detail: string }[];
}

/* ---------------- receipt scanning ---------------- */

export interface ReceiptDraft {
  type: 'income' | 'expense' | null;
  amount: string | null;
  currency: string | null;
  date: string | null;
  counterparty: string | null;
  description: string | null;
  reference: string | null;
  fees: string | null;
  categoryId: string | null;
  categoryName: string | null;
  documentKind: 'receipt' | 'invoice' | 'mobile_money' | 'bank_alert' | 'other';
}

export interface ReceiptScan {
  kind: 'ai_suggestion';
  draft: ReceiptDraft;
  warnings: string[];
  possibleDuplicates: { id: string; date: string; description: string; amount: string; currency: string; type: TxType }[];
}
