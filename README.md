# BIG BROTHER Notification Center

Standalone notification administration module for the BIG BROTHER system.

## Purpose

This repository is intentionally separated from the Accounting, AR, Sales Support, Dashboard, and other BIG BROTHER modules.

The Notification Center manages notification configuration only:

- Telegram staff mapping
- Notification rules
- Overdue reminder timing
- Request submitted notifications
- Request approved notifications
- Request rejected notifications
- Delivery logs and bot health

## Security boundary

Telegram is **notification-only**.

This module must not provide Telegram actions that:

- clear receivables
- approve or reject accounting requests
- edit invoices
- edit payments
- expose the Telegram bot token

`TELEGRAM_BOT_TOKEN` stays in Supabase Edge Function Secrets and must never be committed to this repository.

## Supabase backend

Project: `BIG BROTHER DEV`

Notification tables:

- `notification_settings`
- `telegram_staff_links`
- `notification_rules`
- `notification_log`
- `notification_delivery_state`

All notification tables have RLS enabled. Browser-side writes are revoked; secure backend functions will mediate administration and delivery.

## Existing Telegram Edge Functions

- `bb-telegram-notify-test`
- `bb-telegram-chat-id`

## Initial event plan

1. Overdue invoice → responsible salesperson
2. Request submitted → requesting staff
3. Request approved → requesting staff
4. Request rejected → requesting staff with reason

Default overdue reminder milestones: 1, 3, 7, 15, and 30 days, with duplicate-delivery protection.

## Frontend

The current UI is a standalone foundation with:

- Overview
- Staff Telegram Mapping
- Notification Rules
- Delivery Logs

The next implementation step is a secure authenticated admin API/Edge Function that supplies live data to this page without exposing service credentials or Telegram secrets.


## Telegram Manager integrated workspace (2026-10-22)

The BIG BROTHER Dashboard opens Telegram Manager inside its module workspace.
The previous Notification Center sidebar linked to several separate pages
outside the Telegram shell; many of the Admin Work pages had a light theme.

The sidebar now opens these modules **inside the same Telegram workspace**:

- Invoice Photo Organizer
- Bank Personal Review Routes
- Assistant Topic Mapping
- Telegram Team Groups
- Bank Assistant Setup
- Customer Bank Directory
- Private Staff Mapping (also available from the original Staff section)

Implementation and safeguards:

- `index.html` uses `data-tool` navigation and one trusted frame
  (`#toolWorkspaceFrame`); `app.js` uses a **fixed URL allow-list**. It
  does not embed arbitrary URLs from search boxes or user input.
- The seven tools keep their **original HTML, JavaScript, session checks,
  permission rules and API routes** at their existing GitHub Pages paths.
  No bot, invoice, payment or A/R logic is changed.
- Approved frames share the `https://angsokhey11-cloud.github.io` origin.
  The parent injects `telegram-workspace-tools-v1.css` on load to harmonize
  the paper background, forms, cards, tables, status text and buttons with
  the Telegram Manager dark palette. It **never processes image pixels**.
- Back and Manage links between approved tools stay within the Telegram
  workspace. The sidebar remains visible; Telegram Overview remains accessible.
  A new tool has a `#tool-...` hash for refresh/deep link. Refresh affects
  the active tool rather than triggering a second notification data reload.
- Switching back to a normal Notification Center page unloads the old iframe
  via `about:blank` to release hidden timers and client-side activity.
  Attempts to iframe-navigate outside the approved tool paths are blocked.
- Underlying applications remain authenticated and authorized as before.
  The shared CSS does not grant access or alter security controls.

QA: synthetic DOM test of all seven links, first click, current selection,
internal navigation, hash, theme injection, refresh, Back and blocked external
frame navigation. JS syntax and known URL checks passed. Signed-in browser
acceptance is still required.

Deployment: GitHub Pages frontend only. **No SQL migration**, new tables or
Cloud-to-Local business-data sync. Reload the Dashboard / Telegram Manager
after GitHub Pages updates; Local Brain database needs no migration.

## Customer Telegram invoice delivery

The Notification Center also manages customer-specific invoice delivery:

- Customer Telegram invoice routing by stable `customer_id`
- Per-customer Send Invoice ON / OFF
- Exact Group Chat ID + Topic ID
- Destination verification tests
- Exact invoice job queue (no customer/latest-invoice scanning)
- PAID / PARTIAL / CREDIT status from the saved accounting invoice
- Private PNG snapshot storage for safe retry
- Failed delivery retry and delivery history

Invoice sending remains notification-only. The bot cannot edit invoices, payments, or receivables.
