#!/usr/bin/env bash
# Render build script — runs during every deploy
set -o errexit

# Install dependencies
pip install -r backend/requirements.txt

# Collect static files (frontend + Django admin assets)
python backend/manage.py collectstatic --noinput

# Run database migrations
python backend/manage.py migrate

# Seed default categories (idempotent)
python backend/manage.py seed_data
