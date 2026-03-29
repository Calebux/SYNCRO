# Contributing to SYNCRO

Thank you for your interest in contributing! This guide will help you set up the project, follow conventions, and submit high-quality contributions.

---

## Development Setup

### Prerequisites

- Node.js >= 20
- npm or yarn
- Supabase CLI (for database)
- (Optional) Stellar CLI for contract interactions

---

### Clone and Install

```bash
git clone https://github.com/<your-username>/SYNCRO.git
cd SYNCRO
```

### Backend Setup
```bash
cd backend
cp .env.example .env   # Fill in required values
npm install
npm run dev
```

### Client Setup
```bash
cd client
cp .env.example .env.local   # Fill in required values
npm install
npm run dev
```

### Database Setup
```bash
supabase start
supabase db push
```

## Environment Variables
Environment variables are defined in `.env.example`.

Key variables include:

- `SUPABASE_URL` – Supabase project URL
- `SUPABASE_KEY` – API key
- `JWT_SECRET` – Secret for authentication
- `REDIS_URL` – Redis connection (if used)
- `EMAIL_SERVICE` – SMTP configuration

> Ensure all required variables are set before running the app.


## Branch Naming Convention
Use the following format:

```bash
feat/add-feature-name
fix/bug-description
chore/update-dependencies
docs/update-readme
test/add-unit-tests
```

## Branch Naming Convention
Use the following format:

```bash
feat/add-feature-name
fix/bug-description
chore/update-dependencies
docs/update-readme
test/add-unit-tests
```

## Pull Request Guidelines
- Reference the issue:
```bash
Closes #<issue-number>
```
- Ensure all tests pass
- Include a clear description of changes
- Add a test plan (how reviewers can verify)
- Keep PRs focused and small


## Code Review Standards

### TypeScript
- No `any` types
- Avoid unsafe non-null assertions

### Security
- No hardcoded secrets
- Validate all inputs (use Zod where applicable)

### Testing
Required for:
- New endpoints
- Bug fixes
- Business logic

## Before Submitting
 - Code builds successfully (npm run build)
 - Tests pass (npm test)
 - Environment variables configured
 - No lint or type errors
 - PR description completed


## Questions or Issues?

If you encounter any issues with the branch protection or have questions about the contribution process:
1. Check existing issues on GitHub
2. Open a new issue with details about your problem
3. Ask for help in discussions or pull request comments

## Code of Conduct

- Be respectful and professional in all interactions
- Provide constructive feedback in reviews
- Help newer contributors learn and improve
- Report any code of conduct violations to the maintainers

## Additional Resources

- [PR Submission Guide](./PR_SUBMISSION_GUIDE.md)
- [Backend README](./backend/README.md)
- [Client README](./client/README.md)
- [GitHub Docs on Branch Protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

---

Thank you for helping make Synchro better! 🚀
