# Workato Doc Agent

Enterprise B2B SaaS agent that automatically documents Workato recipes. Uses a hybrid AI + rules approach for reliability and cost-effectiveness.

## Features

- Fetches recipe data from Workato OEM API
- Only processes recipes whose names start with `[active]`
- Only includes recipes at project root (excludes subfolders within integrations)
- Hash-based change detection (rules) for fast, deterministic diffing
- AI-powered documentation generation
- Pluggable publishers (FileSystem, Confluence, Custom API)
- Scheduled sync and manual trigger support

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials
2. `npm install`
3. `npm run build`
4. Run: `npm run sync` (one-time) or `npm start` (scheduled)

## Configuration

- `WORKATO_API_TOKEN` - Workato OEM API token (required)
- `WORKATO_BASE_URL` - API base URL (default: https://www.workato.com/api)
- `ANTHROPIC_API_KEY` - Anthropic API key for doc generation (Claude)
- `CRON_SCHEDULE` - Cron expression (default: every 6 hours)
- `OUTPUT_DIR` - Output directory for generated docs

## Commands

- `npm run sync` - Run documentation pipeline once
- `npm run sync <customer_id>` - Run for specific customer
- `npm run sync -- --force` - Force regenerate all recipe docs (ignore change detection)
- `npm start` - Start scheduler (runs pipeline on schedule)

## Testing on a Specific OEM Account

To run a test on a single OEM account by ID:

**Option 1 – CLI argument**
```bash
npm run sync 12345
```
Use the Workato managed user ID (numeric) or external ID (e.g. `E67890`).

**Option 2 – Environment variable**
Set `WORKATO_TEST_ACCOUNT_ID` in `.env`:
```
WORKATO_TEST_ACCOUNT_ID=12345
```
Then run:
```bash
npm run sync
```
Output is written to `output/{customer_id}/{recipe_id}/`.
