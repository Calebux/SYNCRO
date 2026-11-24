#!/usr/bin/env node
if (!process.env.CI) {
  console.error(
    'Publishing @syncro packages is only allowed from CI on a tagged release.',
  );
  process.exit(1);
}
