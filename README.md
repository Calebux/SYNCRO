# SYNCRO

![Tests](https://github.com/Calebux/SYNCRO/actions/workflows/test.yml/badge.svg)

## Synchro — Self-Custodial Subscription Manager (MVP)

Synchro is a decentralized, self-custodial subscription management platform that empowers users to take full control of their recurring payments while using crypto. This MVP focuses on gift card–compatible subscriptions and optional email-based subscription detection, pending future automation with non-custodial card issuance on Stellar.

## Key Goals

Prevent unwanted recurring charges: Users only pay when they choose.

Non-custodial design: Synchro does not hold or control funds. Users manage payments directly via gift cards or local accounts.

Subscription awareness: Synchro sends reminders and provides direct cancel links.

Scalable roadmap: MVP will later evolve into fully automated payments once non-custodial Stellar card issuance is available.

## Phase 1 (MVP) Workflow
Supported Payment Method

Crypto → Atomic Wallet → Gift Card (Visa, Amazon, Google Play, Steam)

# Users can pay subscriptions that accept gift cards.

1. User Registers Subscriptions

Adds subscription details (Netflix, Spotify, Amazon Prime, etc.)

Optionally allows Synchro to fetch subscription-related emails.

2. Synchro Sends Reminders

Notifications are sent 3 days before each subscription renewal (daily until payment).

# Each reminder shows:

Subscription name

Renewal date

Amount due

Link to purchase gift card via Atomic Wallet (if applicable)

Embedded cancel link to merchant’s subscription management page

3. User Action — Purchase & Redeem Gift Card

Users purchase gift cards using crypto through Atomic Wallet or other approved providers.

Gift card is delivered to the user’s email.

Users manually redeem the gift card on the subscription service.

4. Dashboard Tracking

Manual marking: Users mark the subscription as “Paid.”

Optional email fetching: If enabled, Synchro can detect gift card emails and automatically track subscription payments without storing sensitive codes.

5. Cancelation

Each subscription entry includes a direct cancel link, so users can stop recurring payments anytime.

Supported Subscriptions (Phase 1)

Netflix

Spotify

Amazon Prime / Audible

YouTube Premium (via Google Play gift cards)

Steam subscriptions / in-app purchases

Only subscriptions compatible with gift cards are included in MVP.

## Future Roadmap

Phase 1 MVP is designed as a manual + semi-automated solution:

Pending: Non-custodial Stellar wallet that issues virtual cards.

Future Phase: Once Stellar supports non-custodial card issuance:

Synchro will automatically fund subscription payments from user crypto

Fully automated recurring payment control

Still retains non-custodial principles — users own their funds at all times

## Design Principles

Non-Custodial: Users remain in full control of their crypto and payments.

User-Centric: Synchro enables users to make intentional subscription payments.

Low-Risk MVP: Gift card–based workflow avoids complex integration while demonstrating core value.

Scalable: Phase 1 is a foundation for automated Stellar card integration.

## MVP Benefits

Users avoid accidental charges or unwanted recurring payments

Simple, non-custodial workflow for crypto users

Tracks subscriptions, sends reminders, and provides cancelation support

Works globally where gift cards are supported

Prepares the ecosystem for fully automated crypto-to-fiat subscription payments in future versions

## Disclaimer

Synchro MVP does not execute payments on behalf of users.
Users are responsible for:

Purchasing gift cards

Redeeming gift cards

Ensuring the subscription is covered

Maintaining card balance

Synchro only tracks subscriptions, sends reminders, and provides guidance to make subscription management easier and safer.
