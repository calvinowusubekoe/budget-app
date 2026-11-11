# Database schema

MongoDB with Mongoose. This reference is generated from the models in `server/modules/**/*model*.js`. Regenerate it after changing a model; the model files are the source of truth.

## Conventions

- **Money:** amounts are `Decimal128` and are never stored as floating-point numbers. The API sends them as decimal strings.
- **Currencies:** ISO 4217 codes.
- **Workspace isolation:** every workspace-scoped collection has `workspaceId`, and every query filters on it. Susu groups have their own membership (`SusuGroupMember`) and don't belong to a workspace.
- **Removing records:**
  - Financial records are soft-deleted (`deletedAt`) or reversed or cancelled with a reason, so history stays intact.
  - `AuditLog` and `SusuActivityLog` reject updates.
- **Exchange rates:** each transaction stores its own snapshot (`reporting.rate`, `source`, `rateDate`), and snapshots are never recalculated.
- **Idempotency:** `clientRef` or `idempotencyKey` fields have partial unique indexes, so a retried or offline-replayed create is stored once.
- **Payments:** these collections are for BudgetFlow subscriptions only (`Payment`, `PaymentWebhookEvent`, `Subscription`). No collection holds a balance or a wallet, and none moves Susu money.
- **Expiring data (TTL indexes):** notifications after 180 days, AI usage rows after 400 days, plus the expiring auth tokens.
- **Transactions:** multi-document writes use MongoDB transactions where the deployment supports them (any replica set, including Atlas). See `runAtomic` in `server/config/db.js`.

## Collections

### Account (`accounts`)

  - `workspaceId` ObjectId (required)
  - `name` String (required)
  - `type` String (required) cash | bank | mobile_money | savings | other
  - `currency` String (required)
  - `institution` String
  - `openingBalance` Decimal128 (required)
  - `openingDate` Date (required)
  - `notes` String
  - `status` String active | archived
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}
  - {"workspaceId":1,"status":1,"name":1}

### AiConsent (`aiconsents`)

  - `userId` ObjectId (required)
  - `version` String (required)
  - `consentedAt` Date (required)

Indexes:
  - {"userId":1} unique

### AiUsage (`aiusages`)

  - `workspaceId` ObjectId (required)
  - `userId` ObjectId (required)
  - `model` String (required)
  - `inputTokens` Number
  - `outputTokens` Number
  - `outcome` String (required) answered | refused | error
  - `createdAt` Date

Indexes:
  - {"workspaceId":1,"createdAt":-1}
  - {"createdAt":1} TTL 400d

### Attachment (`attachments`)

  - `workspaceId` ObjectId (required)
  - `transactionId` ObjectId (required)
  - `originalName` String (required)
  - `mimeType` String (required) image/jpeg | image/png | image/webp | application/pdf
  - `size` Number (required)
  - `sha256` String (required)
  - `storageKey` String (required)
  - `uploadedBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1,"transactionId":1}

### AuditLog (`auditlogs`)

  - `workspaceId` ObjectId
  - `actorId` ObjectId
  - `action` String (required)
  - `entityType` String (required)
  - `entityId` ObjectId
  - `metadata` Mixed
  - `ip` String
  - `userAgent` String
  - `createdAt` Date

Indexes:
  - {"workspaceId":1}
  - {"actorId":1}
  - {"workspaceId":1,"createdAt":-1}

### AuthToken (`authtokens`)

  - `userId` ObjectId (required)
  - `purpose` String (required) email_verification | password_reset
  - `tokenHash` String (required)
  - `expiresAt` Date (required)
  - `usedAt` Date
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"userId":1}
  - {"tokenHash":1} unique
  - {"expiresAt":1} TTL 7d
  - {"tokenHash":1} unique

### Bill (`bills`)

  - `workspaceId` ObjectId (required)
  - `number` String (required)
  - `issueDate` Date (required)
  - `dueDate` Date (required)
  - `currency` String (required)
  - `lines` Array
  - `subtotal` Decimal128 (required)
  - `taxTotal` Decimal128 (required)
  - `total` Decimal128 (required)
  - `payments` Array
  - `status` String draft | issued | void
  - `issuedAt` Date
  - `voidedAt` Date
  - `voidReason` String
  - `notes` String
  - `terms` String
  - `createdBy` ObjectId (required)
  - `supplierId` ObjectId (required)
  - `reference` String
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1,"number":1} unique
  - {"workspaceId":1,"supplierId":1}

### Budget (`budgets`)

  - `workspaceId` ObjectId (required)
  - `name` String (required)
  - `period` String (required) weekly | monthly | yearly
  - `scope` String (required) all | categories
  - `categoryIds` Array
  - `currency` String (required)
  - `amounts` Array
  - `alertAt` Number
  - `status` String active | paused | archived
  - `notes` String
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}

### Category (`categories`)

  - `workspaceId` ObjectId (required)
  - `kind` String (required) income | expense
  - `name` String (required)
  - `nameKey` String (required)
  - `icon` String
  - `systemKey` String
  - `archived` Boolean
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}
  - {"workspaceId":1,"kind":1,"nameKey":1} unique

### Counter (`counters`)

  - `workspaceId` ObjectId (required)
  - `key` String (required)
  - `seq` Number

Indexes:
  - {"workspaceId":1,"key":1} unique

### Customer (`customers`)

  - `workspaceId` ObjectId (required)
  - `name` String (required)
  - `email` String
  - `phone` String
  - `address` String
  - `taxId` String
  - `notes` String
  - `status` String active | archived
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}

### Debt (`debts`)

  - `workspaceId` ObjectId (required)
  - `name` String (required)
  - `direction` String (required) i_owe | owed_to_me
  - `counterparty` String
  - `principal` Decimal128 (required)
  - `currency` String (required)
  - `interestRate` Decimal128
  - `startDate` Date (required)
  - `dueDate` Date
  - `minimumPayment` Decimal128
  - `paymentFrequency` String weekly | monthly | quarterly | none
  - `notes` String
  - `status` String active | paid_off | archived
  - `paidOffAt` Date
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}

### DebtPayment (`debtpayments`)

  - `workspaceId` ObjectId (required)
  - `debtId` ObjectId (required)
  - `type` String (required) payment | charge
  - `amount` Decimal128 (required)
  - `date` Date (required)
  - `notes` String
  - `status` String recorded | reversed
  - `reversedAt` Date
  - `reversedBy` ObjectId
  - `reversalReason` String
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1,"debtId":1,"date":-1}

### ExchangeRate (`exchangerates`)

  - `workspaceId` ObjectId (required)
  - `from` String (required)
  - `to` String (required)
  - `rate` Decimal128 (required)
  - `effectiveDate` Date (required)
  - `source` String (required) manual | provider
  - `provider` String
  - `fetchedAt` Date
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1,"from":1,"to":1,"effectiveDate":-1}
  - {"workspaceId":1,"from":1,"to":1,"effectiveDate":1,"source":1} unique

### Invoice (`invoices`)

  - `workspaceId` ObjectId (required)
  - `number` String (required)
  - `issueDate` Date (required)
  - `dueDate` Date (required)
  - `currency` String (required)
  - `lines` Array
  - `subtotal` Decimal128 (required)
  - `taxTotal` Decimal128 (required)
  - `total` Decimal128 (required)
  - `payments` Array
  - `status` String draft | issued | void
  - `issuedAt` Date
  - `voidedAt` Date
  - `voidReason` String
  - `notes` String
  - `terms` String
  - `createdBy` ObjectId (required)
  - `customerId` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1,"number":1} unique
  - {"workspaceId":1,"customerId":1}

### Notification (`notifications`)

  - `userId` ObjectId (required)
  - `workspaceId` ObjectId
  - `type` String (required) budget_warning | budget_exceeded | recurring_due | recurring_failed | recurring_created | susu_confirm_request | susu_disputed | susu_payout_recorded | subscription_activated | subscription_renewal_due | subscription_past_due | subscription_expired | payment_failed | payment_review | payment_refunded
  - `title` String (required)
  - `body` String
  - `link` String
  - `data` Mixed
  - `dedupeKey` String (required)
  - `readAt` Date
  - `resolvedAt` Date
  - `createdAt` Date

Indexes:
  - {"userId":1,"dedupeKey":1} unique
  - {"userId":1,"readAt":1,"createdAt":-1}
  - {"createdAt":1} TTL 180d

### Payment (`payments`)

  - `userId` ObjectId (required)
  - `workspaceId` ObjectId (required)
  - `subscriptionId` ObjectId
  - `provider` String (required) paystack | flutterwave
  - `reference` String (required)
  - `providerTransactionId` String
  - `idempotencyKey` String
  - `plan` String (required) personal_pro | business_pro
  - `billingPeriod` String (required) monthly | yearly
  - `amount` Decimal128 (required)
  - `currency` String (required)
  - `status` String pending | succeeded | failed | abandoned | review | refunded | partially_refunded
  - `failureReason` String
  - `checkoutUrl` String
  - `methodType` String
  - `paidAt` Date
  - `fees` Decimal128
  - `coverage.start` Date
  - `coverage.end` Date
  - `verification.webhookVerifiedAt` Date
  - `verification.apiVerifiedAt` Date
  - `verification.lastCheckedAt` Date
  - `verification.providerStatus` String
  - `verification.checks` Number
  - `reconciliationStatus` String unreconciled | matched | mismatch
  - `reconciliationNote` String
  - `refunds` Array
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"reference":1} unique
  - {"workspaceId":1,"createdAt":-1}
  - {"userId":1}
  - {"status":1,"createdAt":1}
  - {"provider":1,"providerTransactionId":1} unique partial
  - {"userId":1,"idempotencyKey":1} unique partial
  - {"reference":1} unique

### PaymentWebhookEvent (`paymentwebhookevents`)

  - `provider` String (required) paystack | flutterwave
  - `eventId` String (required)
  - `type` String (required)
  - `reference` String
  - `payloadHash` String (required)
  - `signatureVerified` Boolean (required)
  - `processedAt` Date
  - `outcome` String
  - `error` String
  - `attempts` Number
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"provider":1,"eventId":1} unique
  - {"reference":1}

### RecurringTransaction (`recurringtransactions`)

  - `workspaceId` ObjectId (required)
  - `template.type` String (required) income | expense | transfer
  - `template.accountId` ObjectId (required)
  - `template.categoryId` ObjectId
  - `template.toAccountId` ObjectId
  - `template.amount` Decimal128 (required)
  - `template.toAmount` Decimal128
  - `template.description` String (required)
  - `template.payee` String
  - `template.notes` String
  - `frequency` String (required) daily | weekly | monthly | quarterly | yearly
  - `interval` Number
  - `anchorDate` Date (required)
  - `endDate` Date
  - `mode` String auto | remind
  - `status` String active | paused | ended
  - `occurrencesDone` Number
  - `nextRunDate` Date
  - `pending` Array
  - `lastRunAt` Date
  - `lastError` String
  - `timezone` String
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}
  - {"status":1,"nextRunDate":1}

### SavingsEntry (`savingsentries`)

  - `workspaceId` ObjectId (required)
  - `goalId` ObjectId (required)
  - `type` String (required) contribution | withdrawal
  - `amount` Decimal128 (required)
  - `date` Date (required)
  - `notes` String
  - `status` String recorded | reversed
  - `reversedAt` Date
  - `reversedBy` ObjectId
  - `reversalReason` String
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1,"goalId":1,"date":-1}

### SavingsGoal (`savingsgoals`)

  - `workspaceId` ObjectId (required)
  - `name` String (required)
  - `description` String
  - `targetAmount` Decimal128 (required)
  - `currency` String (required)
  - `targetDate` Date
  - `contributionFrequency` String weekly | monthly | quarterly | none
  - `notes` String
  - `status` String active | archived
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}

### Session (`sessions`)

  - `userId` ObjectId (required)
  - `tokenHash` String (required)
  - `previousTokenHash` String
  - `userAgent` String
  - `ip` String
  - `lastUsedAt` Date
  - `expiresAt` Date (required)
  - `revokedAt` Date
  - `revokedReason` String
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"userId":1}
  - {"expiresAt":1} TTL 1d

### Subscription (`subscriptions`)

  - `workspaceId` ObjectId (required)
  - `userId` ObjectId (required)
  - `plan` String (required) personal_pro | business_pro
  - `billingPeriod` String (required) monthly | yearly
  - `status` String (required) active | past_due | cancelled | expired
  - `startedAt` Date (required)
  - `currentPeriodStart` Date (required)
  - `currentPeriodEnd` Date (required)
  - `cancelAtPeriodEnd` Boolean
  - `cancelledAt` Date
  - `cancellationReason` String
  - `endedAt` Date
  - `provider` String (required) paystack | flutterwave
  - `providerReference` String
  - `lastPaymentId` ObjectId
  - `currency` String (required)
  - `amount` Decimal128 (required)
  - `paymentStatus` String paid | refunded | partially_refunded
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1} unique
  - {"status":1,"currentPeriodEnd":1}
  - {"workspaceId":1} unique

### Supplier (`suppliers`)

  - `workspaceId` ObjectId (required)
  - `name` String (required)
  - `email` String
  - `phone` String
  - `address` String
  - `taxId` String
  - `notes` String
  - `status` String active | archived
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}

### SusuActivityLog (`susuactivitylogs`)

  - `groupId` ObjectId (required)
  - `actorId` ObjectId
  - `action` String (required)
  - `entityType` String (required)
  - `entityId` ObjectId
  - `memberId` ObjectId
  - `metadata` Mixed
  - `createdAt` Date

Indexes:
  - {"groupId":1,"createdAt":-1}

### SusuContribution (`susucontributions`)

  - `workspaceId` ObjectId (required)
  - `planId` ObjectId (required)
  - `amount` Decimal128 (required)
  - `currency` String (required)
  - `date` Date (required)
  - `notes` String
  - `status` String recorded | cancelled
  - `cancelledAt` Date
  - `cancelledBy` ObjectId
  - `cancelReason` String
  - `createdBy` ObjectId (required)
  - `clientRef` String
  - `attachment` Embedded
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1,"planId":1,"date":1}
  - {"createdBy":1,"clientRef":1} unique partial

### SusuCycle (`susucycles`)

  - `groupId` ObjectId (required)
  - `number` Number (required)
  - `dueDate` Date (required)
  - `recipientMemberId` ObjectId (required)
  - `contributorMemberIds` Array
  - `expectedPerMember` Decimal128 (required)
  - `status` String active | cancelled
  - `cancelReason` String
  - `notes` String
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"groupId":1}
  - {"groupId":1,"number":1}

### SusuGroup (`susugroups`)

  - `name` String (required)
  - `description` String
  - `currency` String (required)
  - `contributionAmount` Decimal128 (required)
  - `frequency` String (required) daily | weekly | monthly | custom
  - `intervalDays` Number
  - `startDate` Date (required)
  - `endDate` Date
  - `rotationMethod` String fixed_order | random | manual
  - `collectionSchedule` String
  - `maxMembers` Number
  - `assistantPermissions.manageMembers` Boolean
  - `assistantPermissions.manageCycles` Boolean
  - `assistantPermissions.recordContributions` Boolean
  - `assistantPermissions.recordPayouts` Boolean
  - `status` String active | completed | cancelled
  - `cancelReason` String
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - _id only

### SusuGroupContribution (`susugroupcontributions`)

  - `groupId` ObjectId (required)
  - `cycleId` ObjectId (required)
  - `currency` String (required)
  - `notes` String
  - `status` String recorded | confirmed | disputed | cancelled
  - `recordedBy` ObjectId (required)
  - `events` Array
  - `memberId` ObjectId (required)
  - `amount` Decimal128 (required)
  - `date` Date (required)
  - `clientRef` String
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"groupId":1}
  - {"groupId":1,"cycleId":1,"memberId":1}
  - {"recordedBy":1,"clientRef":1} unique partial

### SusuGroupMember (`susugroupmembers`)

  - `groupId` ObjectId (required)
  - `userId` ObjectId
  - `displayName` String (required)
  - `contact.phone` String
  - `contact.email` String
  - `role` String (required) organizer | assistant | member
  - `status` String (required) invited | active | suspended | removed
  - `rotationPosition` Number
  - `joinedAt` Date
  - `addedBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"groupId":1}
  - {"groupId":1,"userId":1} unique partial

### SusuInvitation (`susuinvitations`)

  - `groupId` ObjectId (required)
  - `memberId` ObjectId (required)
  - `email` String (required)
  - `tokenHash` String (required)
  - `invitedBy` ObjectId (required)
  - `expiresAt` Date (required)
  - `acceptedAt` Date
  - `revokedAt` Date
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"groupId":1}
  - {"tokenHash":1} unique

### SusuPayout (`susupayouts`)

  - `groupId` ObjectId (required)
  - `cycleId` ObjectId (required)
  - `currency` String (required)
  - `notes` String
  - `status` String recorded | confirmed | disputed | cancelled
  - `recordedBy` ObjectId (required)
  - `events` Array
  - `recipientMemberId` ObjectId (required)
  - `expectedAmount` Decimal128 (required)
  - `actualAmount` Decimal128 (required)
  - `payoutDate` Date (required)
  - `confirmationDetails` String
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"groupId":1}
  - {"groupId":1,"cycleId":1}

### SusuPlan (`susuplans`)

  - `workspaceId` ObjectId (required)
  - `name` String (required)
  - `description` String
  - `currency` String (required)
  - `targetAmount` Decimal128
  - `contributionAmounts` Array
  - `frequency` String (required) daily | weekly | monthly | custom
  - `intervalDays` Number
  - `startDate` Date (required)
  - `targetDate` Date
  - `location.type` String (required) home_box | envelope | safe | collector | other
  - `location.label` String
  - `status` String active | paused | completed | cancelled
  - `pauses` Array
  - `notes` String
  - `completedAt` Date
  - `cancelledAt` Date
  - `cancelReason` String
  - `createdBy` ObjectId (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}

### SusuWithdrawal (`susuwithdrawals`)

  - `workspaceId` ObjectId (required)
  - `planId` ObjectId (required)
  - `amount` Decimal128 (required)
  - `currency` String (required)
  - `date` Date (required)
  - `notes` String
  - `status` String recorded | cancelled
  - `cancelledAt` Date
  - `cancelledBy` ObjectId
  - `cancelReason` String
  - `createdBy` ObjectId (required)
  - `clientRef` String
  - `reason` String (required)
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1,"planId":1,"date":1}
  - {"createdBy":1,"clientRef":1} unique partial

### Transaction (`transactions`)

  - `workspaceId` ObjectId (required)
  - `type` String (required) income | expense | transfer
  - `accountId` ObjectId (required)
  - `categoryId` ObjectId
  - `amount` Decimal128 (required)
  - `currency` String (required)
  - `toAccountId` ObjectId
  - `toAmount` Decimal128
  - `toCurrency` String
  - `date` Date (required)
  - `description` String (required)
  - `payee` String
  - `notes` String
  - `reporting` Embedded (required)
  - `recurrence.isRecurring` Boolean
  - `recurrence.frequency` String daily | weekly | monthly | quarterly | yearly
  - `status` String recorded | reconciled
  - `reconciledAt` Date
  - `reconciledBy` ObjectId
  - `attachmentCount` Number
  - `recurringId` ObjectId
  - `invoiceId` ObjectId
  - `billId` ObjectId
  - `clientRef` String
  - `createdBy` ObjectId (required)
  - `updatedBy` ObjectId
  - `deletedAt` Date
  - `deletedBy` ObjectId
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1,"deletedAt":1,"date":-1,"_id":-1}
  - {"workspaceId":1,"accountId":1,"date":-1}
  - {"workspaceId":1,"toAccountId":1} partial
  - {"workspaceId":1,"categoryId":1,"date":-1}
  - {"workspaceId":1,"clientRef":1} unique partial

### User (`users`)

  - `name` String (required)
  - `email` String (required)
  - `passwordHash` String (required)
  - `emailVerifiedAt` Date
  - `defaultCurrency` String (required)
  - `locale` String
  - `timezone` String
  - `lastWorkspaceId` ObjectId
  - `onboardingCompletedAt` Date
  - `status` String active | disabled
  - `consents` Array
  - `failedLoginCount` Number
  - `lockedUntil` Date
  - `passwordChangedAt` Date
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"email":1} unique

### Workspace (`workspaces`)

  - `name` String (required)
  - `type` String (required) personal | business
  - `baseCurrency` String (required)
  - `ownerId` ObjectId (required)
  - `aiAssistantEnabled` Boolean
  - `status` String active | archived
  - `business.legalName` String
  - `business.industry` String
  - `business.country` String
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"ownerId":1}

### WorkspaceInvitation (`workspaceinvitations`)

  - `workspaceId` ObjectId (required)
  - `email` String (required)
  - `role` String (required) admin | member | viewer
  - `tokenHash` String (required)
  - `invitedBy` ObjectId (required)
  - `expiresAt` Date (required)
  - `acceptedAt` Date
  - `acceptedBy` ObjectId
  - `revokedAt` Date
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}
  - {"tokenHash":1} unique
  - {"workspaceId":1,"email":1}
  - {"tokenHash":1} unique

### WorkspaceMember (`workspacemembers`)

  - `workspaceId` ObjectId (required)
  - `userId` ObjectId (required)
  - `role` String (required) owner | admin | member | viewer
  - `status` String active | removed
  - `invitedBy` ObjectId
  - `joinedAt` Date
  - `removedAt` Date
  - `createdAt` Date
  - `updatedAt` Date

Indexes:
  - {"workspaceId":1}
  - {"userId":1}
  - {"workspaceId":1,"userId":1} unique

