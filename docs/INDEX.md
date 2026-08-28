# Documentation Index

This index catalogs all documentation in the SYNCRO repository, organized by category.

## Root Documentation

| File | Description |
|------|-------------|
| [README.md](../README.md) | Project overview and getting started guide |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Contribution guidelines |
| [INSTALL.md](../INSTALL.md) | Installation instructions |
| [AGENTS.md](../AGENTS.md) | Agent configuration and usage |
| [CLAUDE.md](../CLAUDE.md) | Claude AI integration documentation |
| [DEBT.md](../DEBT.md) | Technical debt tracking |
| [TODO.md](../TODO.md) | Pending tasks and future work |

## Documentation Directory

### Core Documentation
- [introduction.mdx](introduction.mdx) - Project introduction
- [environment-variables.md](environment-variables.md) - Environment configuration
- [ENVIRONMENT.md](ENVIRONMENT.md) - Environment setup guide

### API & Integration
- [api-reference/](api-reference/) - API documentation
- [api-changelog.md](api-changelog.md) - API versioning changes
- [contracts.mdx](contracts.mdx) - Smart contract documentation
- [payment-providers.md](payment-providers.md) - Payment integration guide
- [PAYPAL_INTEGRATION.md](PAYPAL_INTEGRATION.md) - PayPal-specific integration

### Security & Authentication
- [authentication.mdx](authentication.mdx) - Auth implementation
- [CSP_INCIDENT_RESPONSE.md](CSP_INCIDENT_RESPONSE.md) - Content Security Policy incident handling
- [CSP_MONITORING_README.md](CSP_MONITORING_README.md) - CSP monitoring setup
- [CSP_POLICY_TUNING.md](CSP_POLICY_TUNING.md) - CSP policy optimization
- [CSP_QUICK_REFERENCE.md](CSP_QUICK_REFERENCE.md) - CSP quick reference
- [SECRET_ROTATION_POLICY.md](SECRET_ROTATION_POLICY.md) - Secret rotation procedures
- [SENTRY_ALERT_ROUTING.md](SENTRY_ALERT_ROUTING.md) - Sentry alert configuration
- [security/](security/) - Security documentation

### Architecture & Design
- [adr/](adr/) - Architecture Decision Records
- [DOMAIN_GLOSSARY_AND_DATA_MODEL.md](DOMAIN_GLOSSARY_AND_DATA_MODEL.md) - Canonical Domain Glossary & Data Model Specification
- [shared-business-logic.md](shared-business-logic.md) - Shared logic documentation
- [blockchain-feature-flags.md](blockchain-feature-flags.md) - Feature flag system

### Operations & Deployment
- [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) - Deployment procedures
- [DEPLOYMENT_DRIFT_CHECKING.md](MIGRATION_DRIFT_CHECKING.md) - Migration drift detection
- [MIGRATION_REMEDIATION.md](MIGRATION_REMEDIATION.md) - Migration remediation
- [MIGRATION_ROLLBACK_PLAYBOOKS.md](MIGRATION_ROLLBACK_PLAYBOOKS.md) - Rollback procedures
- [JOB_FAILURE_RUNBOOK.md](JOB_FAILURE_RUNBOOK.md) - Job failure handling
- [rollbacks/](rollbacks/) - Rollback documentation

### Development Process
- [code-review-process.md](code-review-process.md) - Code review guidelines
- [branch-protection.md](branch-protection.md) - Branch protection rules
- [deprecation-policy.md](deprecation-policy.md) - Deprecation procedures
- [issue-triage-policy.md](issue-triage-policy.md) - Issue management
- [TYPESCRIPT_POLICY.md](TYPESCRIPT_POLICY.md) - TypeScript standards

### Testing & Quality
- [SMOKE_TESTS.md](SMOKE_TESTS.md) - Smoke test documentation
- [SMOKE_TESTS_QUICK_REFERENCE.md](SMOKE_TESTS_QUICK_REFERENCE.md) - Quick reference
- [COVERAGE_THRESHOLDS.md](COVERAGE_THRESHOLDS.md) - Coverage requirements
- [coverage.md](coverage.md) - Coverage reporting
- [fault-injection-degraded-behaviour.md](fault-injection-degraded-behaviour.md) - Fault injection testing

### Package Management
- [PACKAGE_BOUNDARY_LINTING.md](PACKAGE_BOUNDARY_LINTING.md) - Package boundary rules
- [PACKAGE_NAMES.md](PACKAGE_NAMES.md) - Package naming conventions
- [DEPENDENCY_MANAGEMENT.md](DEPENDENCY_MANAGEMENT.md) - Dependency management
- [DEPENDENCY_QUICK_REFERENCE.md](DEPENDENCY_QUICK_REFERENCE.md) - Quick reference
- [dependency-inventory.md](dependency-inventory.md) - Dependency tracking

### Data & Storage
- [CORRELATION_IDS.md](CORRELATION_IDS.md) - Correlation ID system
- [rls-policy-registry.md](rls-policy-registry.md) - Row Level Security policies
- [RLS_AUDIT_GUIDE.md](RLS_AUDIT_GUIDE.md) - RLS audit procedures
- [RETENTION_POLICY.md](RETENTION_POLICY.md) - Data retention rules
- [timestamp-timezone-rules.md](timestamp-timezone-rules.md) - Time handling

### SDK & Clients
- [sdk-reference.mdx](sdk-reference.mdx) - SDK documentation
- [label-migration.md](label-migration.md) - Label migration guide

### Project Management
- [ROADMAP.md](ROADMAP.md) - Project roadmap
- [DOCUMENTATION_VALIDATION.md](DOCUMENTATION_VALIDATION.md) - Doc validation
- [repo-issue-backlog-2026-05.md](repo-issue-backlog-2026-05.md) - Issue backlog

### Additional Directories
- [ops/](ops/) - Operations documentation
- [performance/](performance/) - Performance documentation
- [privacy/](privacy/) - Privacy documentation
- [superpowers/](superpowers/) - Advanced features

## Archived Documentation

All archived implementation summaries, verification checklists, and issue-specific documentation has been consolidated into the [archive/](archive/) directory.

### Implementation Summaries
| File | Description |
|------|-------------|
| [IMPLEMENTATION_SUMMARY.md](archive/IMPLEMENTATION_SUMMARY.md) | General implementation summary |
| [IMPLEMENTATION_SUMMARY_TOTP.md](archive/IMPLEMENTATION_SUMMARY_TOTP.md) | TOTP implementation summary |
| [IMPLEMENTATION_SUMMARY_956_961_972_973.md](archive/IMPLEMENTATION_SUMMARY_956_961_972_973.md) | Issues #956, #961, #972, #973 implementation |
| [IMPLEMENTATION_COMPLETE.md](archive/IMPLEMENTATION_COMPLETE.md) | Implementation completion report |
| [IMPLEMENTATION_USAGE_GUIDE.md](archive/IMPLEMENTATION_USAGE_GUIDE.md) | Implementation usage guide |
| [IMPLEMENTATION_CHECKLIST.md](archive/IMPLEMENTATION_CHECKLIST.md) | Implementation checklist |
| [FX_ORACLE_IMPLEMENTATION_SUMMARY.md](archive/FX_ORACLE_IMPLEMENTATION_SUMMARY.md) | FX Oracle implementation |
| [PAYPAL_PRODUCTION_IMPLEMENTATION.md](archive/PAYPAL_PRODUCTION_IMPLEMENTATION.md) | PayPal production setup |
| [STEALTH_RECOVERY_IMPLEMENTATION.md](archive/STEALTH_RECOVERY_IMPLEMENTATION.md) | Stealth recovery implementation |
| [TOR_COMPATIBILITY_IMPLEMENTATION.md](archive/TOR_COMPATIBILITY_IMPLEMENTATION.md) | Tor browser compatibility |
| [MFA_IMPLEMENTATION.md](archive/MFA_IMPLEMENTATION.md) | Multi-factor authentication |
| [ONBOARDING_TOUR_IMPLEMENTATION.md](archive/ONBOARDING_TOUR_IMPLEMENTATION.md) | Onboarding tour feature |
| [QUIET_HOURS_IMPLEMENTATION.md](archive/QUIET_HOURS_IMPLEMENTATION.md) | Quiet hours feature |
| [RENEWAL_COOLDOWN_IMPLEMENTATION.md](archive/RENEWAL_COOLDOWN_IMPLEMENTATION.md) | Renewal cooldown logic |
| [RLS_AUDIT_IMPLEMENTATION_SUMMARY.md](archive/RLS_AUDIT_IMPLEMENTATION_SUMMARY.md) | RLS audit implementation |

### Verification & Checklists
| File | Description |
|------|-------------|
| [VERIFICATION_CHECKLIST.md](archive/VERIFICATION_CHECKLIST.md) | Verification checklist |
| [VERIFICATION_TOTP_IMPLEMENTATION.md](archive/VERIFICATION_TOTP_IMPLEMENTATION.md) | TOTP verification |
| [FINAL_VERIFICATION_REPORT.md](archive/FINAL_VERIFICATION_REPORT.md) | Final verification report |
| [FX_ORACLE_CHECKLIST.md](archive/FX_ORACLE_CHECKLIST.md) | FX Oracle checklist |
| [GITHUB_SECRETS_CHECKLIST.md](archive/GITHUB_SECRETS_CHECKLIST.md) | GitHub secrets checklist |

### Summaries & Reports
| File | Description |
|------|-------------|
| [DISPUTE_RESOLUTION_SUMMARY.md](archive/DISPUTE_RESOLUTION_SUMMARY.md) | Dispute resolution feature |
| [TOTP_FEATURE_SUMMARY.md](archive/TOTP_FEATURE_SUMMARY.md) | TOTP feature summary |
| [CORRELATION_ID_IMPLEMENTATION.md](archive/CORRELATION_ID_IMPLEMENTATION.md) | Correlation ID implementation |
| [ISSUES_680_683_IMPLEMENTATION.md](archive/ISSUES_680_683_IMPLEMENTATION.md) | Issues #680, #683 implementation |
| [COOLDOWN_COMPLETION_SUMMARY.md](archive/COOLDOWN_COMPLETION_SUMMARY.md) | Cooldown completion |
| [ONBOARDING_TOUR_SUMMARY.md](archive/ONBOARDING_TOUR_SUMMARY.md) | Onboarding tour summary |
| [QUIET_HOURS_SUMMARY.md](archive/QUIET_HOURS_SUMMARY.md) | Quiet hours summary |
| [SUBSCRIPTIONS_REFACTORING_SUMMARY.md](archive/SUBSCRIPTIONS_REFACTORING_SUMMARY.md) | Subscriptions refactoring |

### Issue-Specific Documentation
| File | Description |
|------|-------------|
| [ISSUE_84_EXECUTIVE_SUMMARY.md](archive/ISSUE_84_EXECUTIVE_SUMMARY.md) | Issue #84 executive summary |
| [ISSUE_84_FINAL_CHECKLIST.md](archive/ISSUE_84_FINAL_CHECKLIST.md) | Issue #84 final checklist |
| [ISSUE_84_IMPLEMENTATION_COMPLETE.md](archive/ISSUE_84_IMPLEMENTATION_COMPLETE.md) | Issue #84 completion |
| [ISSUE_84_PR_GUIDE.md](archive/ISSUE_84_PR_GUIDE.md) | Issue #84 PR guide |
| [ISSUE_84_QUICK_REFERENCE.md](archive/ISSUE_84_QUICK_REFERENCE.md) | Issue #84 quick reference |
| [ISSUE_84_VERIFICATION_SUMMARY.md](archive/ISSUE_84_VERIFICATION_SUMMARY.md) | Issue #84 verification |
| [ISSUE_90_COMPLETE.md](archive/ISSUE_90_COMPLETE.md) | Issue #90 completion |
| [ISSUE_90_DELIVERABLES.md](archive/ISSUE_90_DELIVERABLES.md) | Issue #90 deliverables |
| [ISSUE_90_IMPLEMENTATION_SUMMARY.md](archive/ISSUE_90_IMPLEMENTATION_SUMMARY.md) | Issue #90 implementation |
| [ISSUE_90_INDEX.md](archive/ISSUE_90_INDEX.md) | Issue #90 index |
| [ISSUE_101_CHECKLIST.md](archive/ISSUE_101_CHECKLIST.md) | Issue #101 checklist |
| [ISSUE_101_COMPLETE.md](archive/ISSUE_101_COMPLETE.md) | Issue #101 completion |
| [ISSUE_101_IMPLEMENTATION_SUMMARY.md](archive/ISSUE_101_IMPLEMENTATION_SUMMARY.md) | Issue #101 implementation |
| [ISSUE_101_PR_GUIDE.md](archive/ISSUE_101_PR_GUIDE.md) | Issue #101 PR guide |
| [ISSUE_491_CONSOLIDATION_SUMMARY.md](archive/ISSUE_491_CONSOLIDATION_SUMMARY.md) | Issue #491 consolidation |
| [ISSUE_491_VERIFICATION.md](archive/ISSUE_491_VERIFICATION.md) | Issue #491 verification |
| [ISSUE_493_COMPLETE.md](archive/ISSUE_493_COMPLETE.md) | Issue #493 completion |
| [ISSUE_493_IMPLEMENTATION_SUMMARY.md](archive/ISSUE_493_IMPLEMENTATION_SUMMARY.md) | Issue #493 implementation |
| [ISSUE_493_PR_GUIDE.md](archive/ISSUE_493_PR_GUIDE.md) | Issue #493 PR guide |
| [ISSUE_494_COMPLETE.md](archive/ISSUE_494_COMPLETE.md) | Issue #494 completion |
| [ISSUE_494_IMPLEMENTATION_SUMMARY.md](archive/ISSUE_494_IMPLEMENTATION_SUMMARY.md) | Issue #494 implementation |
| [ISSUE_496_COMPLETE.md](archive/ISSUE_496_COMPLETE.md) | Issue #496 completion |
| [ISSUE_496_IMPLEMENTATION_SUMMARY.md](archive/ISSUE_496_IMPLEMENTATION_SUMMARY.md) | Issue #496 implementation |
| [ISSUE_497_IMPLEMENTATION_SUMMARY.md](archive/ISSUE_497_IMPLEMENTATION_SUMMARY.md) | Issue #497 implementation |
| [ISSUE_497_PR_GUIDE.md](archive/ISSUE_497_PR_GUIDE.md) | Issue #497 PR guide |
| [ISSUE_498_COMPLETE.md](archive/ISSUE_498_COMPLETE.md) | Issue #498 completion |
| [ISSUE_498_IMPLEMENTATION_SUMMARY.md](archive/ISSUE_498_IMPLEMENTATION_SUMMARY.md) | Issue #498 implementation |
| [ISSUE_498_PR_GUIDE.md](archive/ISSUE_498_PR_GUIDE.md) | Issue #498 PR guide |
| [ISSUE_499_COMPLETE.md](archive/ISSUE_499_COMPLETE.md) | Issue #499 completion |
| [ISSUE_499_IMPLEMENTATION_SUMMARY.md](archive/ISSUE_499_IMPLEMENTATION_SUMMARY.md) | Issue #499 implementation |
| [ISSUE_605_COMPLETION_SUMMARY.md](archive/ISSUE_605_COMPLETION_SUMMARY.md) | Issue #605 completion |
| [ISSUE_636_COMPLETION_SUMMARY.md](archive/ISSUE_636_COMPLETION_SUMMARY.md) | Issue #636 completion |
| [ISSUE_659_COMPLETION_SUMMARY.md](archive/ISSUE_659_COMPLETION_SUMMARY.md) | Issue #659 completion |

### Secret & Security Documentation
| File | Description |
|------|-------------|
| [SECRET_HANDLING_ACTION_ITEMS.md](archive/SECRET_HANDLING_ACTION_ITEMS.md) | Secret handling actions |
| [SECRET_HANDLING_AUDIT_REPORT.md](archive/SECRET_HANDLING_AUDIT_REPORT.md) | Secret handling audit |
| [SECRET_HANDLING_QUICK_REFERENCE.md](archive/SECRET_HANDLING_QUICK_REFERENCE.md) | Secret handling quick ref |
| [SECURITY_AUDIT_MATRIX_API_ROUTES.md](archive/SECURITY_AUDIT_MATRIX_API_ROUTES.md) | API route security audit |

### Validation & Integration
| File | Description |
|------|-------------|
| [VALIDATION_ERROR_EXAMPLES.md](archive/VALIDATION_ERROR_EXAMPLES.md) | Validation error examples |
| [VALIDATION_INTEGRATION_GUIDE.md](archive/VALIDATION_INTEGRATION_GUIDE.md) | Validation integration guide |
| [VALIDATION_QUICK_REFERENCE.md](archive/VALIDATION_QUICK_REFERENCE.md) | Validation quick reference |

### Subscriptions
| File | Description |
|------|-------------|
| [SUBSCRIPTIONS_PR_GUIDE.md](archive/SUBSCRIPTIONS_PR_GUIDE.md) | Subscriptions PR guide |
| [SUBSCRIPTIONS_PR_QUICK_REFERENCE.md](archive/SUBSCRIPTIONS_PR_QUICK_REFERENCE.md) | Subscriptions PR quick ref |

### Other Archived Documentation
| File | Description |
|------|-------------|
| [COOLDOWN_COMPLETION_SUMMARY.md](archive/COOLDOWN_COMPLETION_SUMMARY.md) | Cooldown completion summary |
| [CurrentState.md](archive/CurrentState.md) | Current state documentation |
| [DEBT.md](archive/DEBT.md) | Debt documentation |
| [DEPENDENCY_UPDATE_POLICY.md](archive/DEPENDENCY_UPDATE_POLICY.md) | Dependency update policy |
| [DEPENDENCY_VERSION_MANAGEMENT.md](archive/DEPENDENCY_VERSION_MANAGEMENT.md) | Dependency version management |
| [DIRECTORY_OWNERSHIP_MATRIX.md](archive/DIRECTORY_OWNERSHIP_MATRIX.md) | Directory ownership |
| [OWNERSHIP_QUICK_REFERENCE.md](archive/OWNERSHIP_QUICK_REFERENCE.md) | Ownership quick reference |
| [PR_SUBMISSION_GUIDE.md](archive/PR_SUBMISSION_GUIDE.md) | PR submission guide |
| [TODO.md](archive/TODO.md) | Archived TODO items |
