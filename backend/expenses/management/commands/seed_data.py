"""Seed default categories and optional sample expenses."""
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from expenses.models import Category, Expense
from datetime import date, timedelta
import random


DEFAULT_CATEGORIES = [
    {'name': 'Food', 'emoji': '🍔', 'color': '#f59e0b'},
    {'name': 'Transport', 'emoji': '🚗', 'color': '#3b82f6'},
    {'name': 'Shopping', 'emoji': '🛍️', 'color': '#ec4899'},
    {'name': 'Entertainment', 'emoji': '🎬', 'color': '#8b5cf6'},
    {'name': 'Bills', 'emoji': '📄', 'color': '#ef4444'},
    {'name': 'Health', 'emoji': '💊', 'color': '#10b981'},
    {'name': 'Education', 'emoji': '📚', 'color': '#6366f1'},
    {'name': 'Other', 'emoji': '📦', 'color': '#64748b'},
]

SAMPLE_EXPENSES = [
    ('Grocery Shopping', 2500, 'Food'),
    ('Uber Ride', 350, 'Transport'),
    ('Netflix Subscription', 649, 'Entertainment'),
    ('Electricity Bill', 1800, 'Bills'),
    ('New Headphones', 3200, 'Shopping'),
    ('Gym Membership', 1500, 'Health'),
    ('Online Course', 999, 'Education'),
    ('Lunch at Café', 450, 'Food'),
    ('Bus Pass', 500, 'Transport'),
    ('Movie Tickets', 600, 'Entertainment'),
    ('Water Bill', 300, 'Bills'),
    ('Cough Syrup', 180, 'Health'),
    ('T-shirt', 799, 'Shopping'),
    ('Pizza Delivery', 550, 'Food'),
    ('Books', 1200, 'Education'),
    ('Auto Rickshaw', 120, 'Transport'),
    ('Stationery', 250, 'Other'),
    ('Coffee & Snacks', 320, 'Food'),
    ('Mobile Recharge', 599, 'Bills'),
    ('Spotify Premium', 119, 'Entertainment'),
]


class Command(BaseCommand):
    help = 'Seed default categories and optional sample data'

    def add_arguments(self, parser):
        parser.add_argument(
            '--with-expenses',
            action='store_true',
            help='Also create sample expenses for the first user',
        )

    def handle(self, *args, **options):
        # Seed default categories
        created_cats = 0
        for cat_data in DEFAULT_CATEGORIES:
            _, created = Category.objects.get_or_create(
                name=cat_data['name'],
                is_default=True,
                defaults={
                    'emoji': cat_data['emoji'],
                    'color': cat_data['color'],
                }
            )
            if created:
                created_cats += 1
        self.stdout.write(self.style.SUCCESS(
            f'Categories: {created_cats} created, '
            f'{len(DEFAULT_CATEGORIES) - created_cats} already existed.'
        ))

        if options['with_expenses']:
            user = User.objects.first()
            if not user:
                self.stdout.write(self.style.ERROR(
                    'No users found. Create a user first with '
                    '"python manage.py createsuperuser".'
                ))
                return

            # Build category lookup
            cats = {c.name: c for c in Category.objects.filter(is_default=True)}
            today = date.today()
            created_exps = 0

            for title, amount, cat_name in SAMPLE_EXPENSES:
                days_ago = random.randint(0, 60)
                exp_date = today - timedelta(days=days_ago)
                Expense.objects.create(
                    user=user,
                    title=title,
                    amount=amount,
                    category=cats.get(cat_name),
                    date=exp_date,
                    notes='',
                )
                created_exps += 1

            self.stdout.write(self.style.SUCCESS(
                f'Created {created_exps} sample expenses for user "{user.username}".'
            ))
