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
