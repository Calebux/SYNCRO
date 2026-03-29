-- Seed data for cancellation_guides
INSERT INTO cancellation_guides (service_name, difficulty, direct_url, steps, estimated_time, warning_note)
VALUES
  ('Netflix', 'easy', 'https://www.netflix.com/cancelplan', 
   ARRAY['Sign in to Netflix', 'Go to Account page', 'Select Cancel Membership', 'Confirm cancellation'], 
   '2 minutes', NULL),
  
  ('Adobe Creative Cloud', 'hard', 'https://account.adobe.com/plans', 
   ARRAY['Log in to Adobe Account', 'Manage plan', 'Cancel your plan', 'Select reason', 'Confirm (Watch out for early termination fees)'], 
   '10 minutes', 'Annual plans may charge 50% of the remaining contract balance upon early cancellation.'),
  
  ('Amazon Prime', 'medium', 'https://www.amazon.com/gp/primecentral', 
   ARRAY['Log in to Amazon', 'Account & Lists > Prime Membership', 'Manage Membership', 'End Membership', 'Confirm through multiple prompts'], 
   '5 minutes', 'Amazon often asks you to confirm multiple times through various "Keep my benefits" screens.'),
  
  ('Disney+', 'easy', 'https://www.disneyplus.com/account', 
   ARRAY['Log in to Disney+', 'Select Profile > Account', 'Select Subscription', 'Cancel Subscription', 'Complete survey and confirm'], 
   '3 minutes', NULL),
  
  ('Spotify', 'easy', 'https://www.spotify.com/account/plans/', 
   ARRAY['Log in to Spotify website', 'Account Overview', 'Change Plan', 'Cancel Premium', 'Follow prompts to confirm'], 
   '3 minutes', 'Cancellation must be done via web browser, not the mobile app.'),
  
  ('YouTube Premium', 'easy', 'https://www.youtube.com/paid_memberships', 
   ARRAY['Open YouTube', 'Profile > Purchases and memberships', 'Manage membership', 'Deactivate', 'Continue to cancel'], 
   '2 minutes', NULL),
  
  ('Hulu', 'medium', 'https://secure.hulu.com/account', 
   ARRAY['Log in to Hulu', 'Account page', 'Cancel under Your Subscription', 'Follow prompts (may offer to pause)', 'Confirm cancellation'], 
   '5 minutes', 'Hulu may offer a free month or a "pause" option to prevent cancellation.'),
  
  ('HBO Max', 'medium', 'https://auth.max.com/subscription', 
   ARRAY['Sign in to Max', 'Settings > Subscription', 'Cancel Your Subscription', 'Confirm'], 
   '3 minutes', 'If billed through a third party (Apple/Google), you must cancel through their respective stores.'),
  
  ('Apple Music', 'easy', 'https://music.apple.com/account', 
   ARRAY['Open Settings on Apple device', 'Tap your Name > Subscriptions', 'Select Apple Music', 'Cancel Subscription'], 
   '2 minutes', NULL),
  
  ('Microsoft 365', 'medium', 'https://account.microsoft.com/services', 
   ARRAY['Sign in to Microsoft Account', 'Find subscription > Manage', 'Cancel subscription', 'Follow prompts to turn off recurring billing'], 
   '5 minutes', NULL),

  ('Google One', 'easy', 'https://one.google.com/settings', 
   ARRAY['Open Google One', 'Settings', 'Cancel membership', 'Confirm in Google Play'], 
   '2 minutes', NULL),

  ('Dropbox', 'medium', 'https://www.dropbox.com/account/plan', 
   ARRAY['Log in to Dropbox', 'Settings > Plan', 'Cancel plan', 'Select reason', 'Confirm cancellation'], 
   '4 minutes', NULL),

  ('iCloud+', 'easy', 'https://support.apple.com/HT204247', 
   ARRAY['Open Settings on iPhone/iPad', 'Tap Name > iCloud', 'Manage Storage > Change Storage Plan', 'Downgrade Options', 'Select Free'], 
   '3 minutes', 'Downgrading to the free 5GB plan effectively cancels the paid subscription.'),

  ('Slack', 'medium', 'https://my.slack.com/admin/billing', 
   ARRAY['Log in to Slack Workspace', 'Administration > Billing', 'Click "Change Plan"', 'Select "Cancel Plan"'], 
   '5 minutes', 'Only Workspace Owners can cancel the subscription.'),

  ('Zoom', 'easy', 'https://zoom.us/billing', 
   ARRAY['Log in to Zoom web portal', 'Account Management > Billing', 'Current Plans', 'Cancel Subscription', 'Confirm'], 
   '3 minutes', NULL),

  ('LinkedIn Premium', 'medium', 'https://www.linkedin.com/premium/manage', 
   ARRAY['Log in to LinkedIn', 'Me icon > Settings & Privacy', 'Account preferences > Subscriptions', 'Manage Premium account', 'Cancel subscription'], 
   '5 minutes', NULL),

  ('GitHub Copilot', 'easy', 'https://github.com/settings/billing', 
   ARRAY['Log in to GitHub', 'Settings > Billing and plans', 'Plans and usage', 'Edit > Cancel Copilot'], 
   '2 minutes', NULL),

  ('ChatGPT Plus', 'easy', 'https://chat.openai.com/#settings/Billing', 
   ARRAY['Log in to ChatGPT', 'Settings > My plan', 'Manage my subscription', 'Cancel Plan', 'Confirm'], 
   '2 minutes', NULL),

  ('Midjourney', 'easy', 'https://www.midjourney.com/account/', 
   ARRAY['Log in to Midjourney', 'Manage Sub', 'Cancel Plan', 'Confirm'], 
   '2 minutes', NULL),

  ('Canva Pro', 'easy', 'https://www.canva.com/settings/billing-and-plans', 
   ARRAY['Log in to Canva', 'Settings > Billing & Plans', 'Cancel Plan', 'Confirm'], 
   '3 minutes', NULL),

  ('Figma Professional', 'medium', 'https://www.figma.com/settings', 
   ARRAY['Log in to Figma', 'Settings > Billing', 'Cancel subscription', 'Confirm'], 
   '4 minutes', NULL),

  ('Notion Plus', 'easy', 'https://www.notion.so/settings/billing', 
   ARRAY['Log in to Notion', 'Settings & Members > Billing', 'Change plan', 'Downgrade to Free'], 
   '3 minutes', NULL),

  ('Evernote', 'hard', 'https://www.evernote.com/Registration.action', 
   ARRAY['Log in to Evernote', 'Account Summary', 'Manage Subscription', 'Cancel Subscription'], 
   '7 minutes', 'Evernote often hides the cancellation button deep in account settings.'),

  ('1Password', 'easy', 'https://my.1password.com/billing', 
   ARRAY['Log in to 1Password', 'Billing in sidebar', 'Cancel Subscription', 'Confirm'], 
   '3 minutes', NULL),

  ('NordVPN', 'medium', 'https://my.nordaccount.com/billing/subscriptions/', 
   ARRAY['Log in to NordAccount', 'Billing > Subscriptions', 'Manage > Cancel auto-renewal', 'Confirm'], 
   '5 minutes', 'You may need to contact support via chat for a refund if within 30 days.'),

  ('ExpressVPN', 'medium', 'https://www.expressvpn.com/order', 
   ARRAY['Log in to ExpressVPN', 'Subscription settings', 'Turn off automatic renewal', 'Confirm'], 
   '5 minutes', NULL),

  ('New York Times', 'hard', 'https://www.nytimes.com/subscription/cancel', 
   ARRAY['Log in to NYT', 'Account page', 'Cancel subscription', 'Chat with an agent (required in some regions)'], 
   '15 minutes', 'Often requires chatting with a live agent to finalize cancellation.'),

  ('PlayStation Plus', 'medium', 'https://id.playstation.com/account/subscription', 
   ARRAY['Log in to PSN Account', 'Subscription Management', 'Cancel Subscription', 'Confirm'], 
   '4 minutes', NULL),

  ('Xbox Game Pass', 'easy', 'https://account.microsoft.com/services/', 
   ARRAY['Log in to Microsoft Account', 'Manage subscription', 'Cancel subscription', 'Confirm'], 
   '3 minutes', NULL),

  ('Nintendo Switch Online', 'easy', 'https://accounts.nintendo.com/shop/subscriptions', 
   ARRAY['Log in to Nintendo Account', 'Shop Menu', 'Subscription settings', 'Turn off automatic renewal'], 
   '3 minutes', NULL),

  ('Audible', 'medium', 'https://www.audible.com/account/overview', 
   ARRAY['Log in to Audible', 'Account Details', 'Cancel membership', 'Follow the "Are you sure?" prompts'], 
   '5 minutes', 'You will lose any remaining credits upon cancellation unless you spend them first.'),

  ('Peloton', 'easy', 'https://members.onepeloton.com/preferences/subscriptions', 
   ARRAY['Log in to Peloton', 'Preferences > Subscriptions', 'Cancel Subscription', 'Confirm'], 
   '3 minutes', NULL),

  ('Strava', 'medium', 'https://www.strava.com/settings/subscription', 
   ARRAY['Log in to Strava', 'Settings > My Account', 'Cancel Subscription', 'Confirm'], 
   '4 minutes', 'Must be cancelled via web browser if subscribed directly.'),

  ('Tinder Gold', 'easy', 'https://tinder.com/app/settings', 
   ARRAY['Open Tinder', 'Profile > Settings', 'Manage Payment Account', 'Cancel Subscription'], 
   '2 minutes', NULL),

  ('Bumble Premium', 'easy', 'https://bumble.com/app', 
   ARRAY['Open Bumble', 'Profile > Subscription', 'Cancel'], 
   '2 minutes', NULL),

  ('Coursera Plus', 'easy', 'https://www.coursera.org/my-purchases', 
   ARRAY['Log in to Coursera', 'My Purchases', 'Manage Subscription', 'Cancel Subscription'], 
   '3 minutes', NULL),

  ('Skillshare', 'medium', 'https://www.skillshare.com/settings/payments', 
   ARRAY['Log in to Skillshare', 'Account Settings > Payments', 'Cancel Membership', 'Confirm'], 
   '4 minutes', NULL),

  ('Patreon', 'easy', 'https://www.patreon.com/settings/billing', 
   ARRAY['Log in to Patreon', 'Settings > Billing History', 'Manage Memberships', 'Cancel'], 
   '3 minutes', NULL),

  ('Substack', 'easy', 'https://substack.com/settings', 
   ARRAY['Log in to Substack', 'Settings', 'Select publication', 'Cancel subscription'], 
   '2 minutes', NULL),

  ('Twitch Turbo', 'easy', 'https://www.twitch.tv/subscriptions', 
   ARRAY['Log in to Twitch', 'Subscriptions', 'Other Subscriptions', 'Cancel Turbo'], 
   '2 minutes', NULL),

  ('Dashlane', 'easy', 'https://www.dashlane.com/subscription', 
   ARRAY['Log in to Dashlane', 'My Account > Subscription', 'Cancel Subscription', 'Confirm'], 
   '3 minutes', NULL),

  ('Duolingo Super', 'easy', 'https://www.duolingo.com/settings/plus', 
   ARRAY['Open Duolingo', 'Profile > Settings', 'Manage Subscription', 'Cancel Subscription'], 
   '2 minutes', NULL),

  ('Babbel', 'medium', 'https://www.babbel.com/prices', 
   ARRAY['Log in to Babbel', 'Account > Settings', 'Manage Subscription', 'Cancel auto-renewal'], 
   '4 minutes', NULL),

  ('MasterClass', 'medium', 'https://www.masterclass.com/account/edit', 
   ARRAY['Log in to MasterClass', 'Account > Settings', 'Cancel Subscription', 'Confirm'], 
   '5 minutes', NULL),

  ('Scribd', 'medium', 'https://www.scribd.com/account-settings', 
   ARRAY['Log in to Scribd', 'Account Settings', 'Cancel Subscription', 'Complete the multi-step process'], 
   '6 minutes', NULL),

  ('Kindle Unlimited', 'easy', 'https://www.amazon.com/kindle-dbs/ku/ku-central', 
   ARRAY['Log in to Amazon', 'Manage Kindle Unlimited Membership', 'Cancel Kindle Unlimited Membership', 'Confirm'], 
   '2 minutes', NULL),

  ('Paramount+', 'medium', 'https://www.paramountplus.com/account/', 
   ARRAY['Log in to Paramount+', 'Account', 'Cancel Subscription', 'Confirm'], 
   '4 minutes', NULL),

  ('Peacock', 'easy', 'https://www.peacocktv.com/account', 
   ARRAY['Log in to Peacock', 'Plans & Payment', 'Change Plan', 'Cancel Plan'], 
   '3 minutes', NULL),

  ('Apple TV+', 'easy', 'https://tv.apple.com/settings', 
   ARRAY['Open Settings on Apple device', 'Tap Name > Subscriptions', 'Apple TV+', 'Cancel Subscription'], 
   '2 minutes', NULL),

  ('Crunchyroll', 'medium', 'https://www.crunchyroll.com/acct/membership', 
   ARRAY['Log in to Crunchyroll', 'Account Settings > Membership Info', 'Cancel Membership', 'Confirm'], 
   '4 minutes', NULL)
ON CONFLICT (service_name) DO UPDATE SET
  difficulty = EXCLUDED.difficulty,
  direct_url = EXCLUDED.direct_url,
  steps = EXCLUDED.steps,
  estimated_time = EXCLUDED.estimated_time,
  warning_note = EXCLUDED.warning_note;
