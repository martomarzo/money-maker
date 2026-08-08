#!/bin/sh
set -e

npx drizzle-kit migrate
exec npx next start -H 0.0.0.0 -p 3000
