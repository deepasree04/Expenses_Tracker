import csv
import io
from datetime import date, timedelta

from django.db.models import Sum
from django.http import HttpResponse
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response

from .models import Expense, Category
from .serializers import ExpenseSerializer, CategorySerializer, CSVImportSerializer


class CategoryViewSet(viewsets.ModelViewSet):
    """CRUD for expense categories. Returns global defaults + user's custom ones."""
    serializer_class = CategorySerializer

    def get_queryset(self):
        from django.db.models import Q
        return Category.objects.filter(
            Q(is_default=True) | Q(user=self.request.user)
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class ExpenseViewSet(viewsets.ModelViewSet):
    """Full CRUD for expenses plus summary, analytics, reports, and CSV import."""
    serializer_class = ExpenseSerializer

    def get_queryset(self):
        qs = Expense.objects.filter(user=self.request.user)
        params = self.request.query_params

        # Filter by category id
        category = params.get('category')
        if category and category != 'all':
            qs = qs.filter(category_id=category)

        # Filter by month (YYYY-MM)
        month = params.get('month')
        if month:
            try:
                year, m = month.split('-')
                qs = qs.filter(date__year=int(year), date__month=int(m))
            except (ValueError, IndexError):
                pass

        # Search by title or notes
        search = params.get('search')
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(title__icontains=search) | Q(notes__icontains=search)
            )

        # Sort
        sort = params.get('sort', 'date-desc')
        sort_map = {
            'date-desc': ['-date', '-created_at'],
            'date-asc': ['date', 'created_at'],
            'amount-desc': ['-amount'],
            'amount-asc': ['amount'],
        }
        qs = qs.order_by(*sort_map.get(sort, ['-date', '-created_at']))

        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    # ---- Dashboard summary ----
    @action(detail=False, methods=['get'])
    def summary(self, request):
        today = date.today()

        monthly_qs = Expense.objects.filter(
            user=request.user, date__year=today.year, date__month=today.month
        )
        today_qs = Expense.objects.filter(user=request.user, date=today)

        total_spent = monthly_qs.aggregate(total=Sum('amount'))['total'] or 0
        today_spent = today_qs.aggregate(total=Sum('amount'))['total'] or 0
        today_count = today_qs.count()
        day_of_month = today.day
        avg_per_day = float(total_spent) / day_of_month if day_of_month > 0 else 0

        # Top category
        cat_totals = (
            monthly_qs
            .values('category__id', 'category__name', 'category__emoji', 'category__color')
            .annotate(total=Sum('amount'))
            .order_by('-total')
        )
        top_category = cat_totals[0] if cat_totals else None

        # Category breakdown for donut chart
        category_breakdown = list(cat_totals)

        # Weekly trend (last 7 days)
        week_trend = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            day_total = Expense.objects.filter(
                user=request.user, date=d
            ).aggregate(total=Sum('amount'))['total'] or 0
            week_trend.append({
                'date': d.isoformat(),
                'label': d.strftime('%a'),
                'value': float(day_total),
            })

        # Monthly trend (last 4 weeks)
        month_trend = []
        for i in range(3, -1, -1):
            week_end = today - timedelta(days=i * 7)
            week_start = week_end - timedelta(days=6)
            week_total = Expense.objects.filter(
                user=request.user,
                date__gte=week_start, date__lte=week_end
            ).aggregate(total=Sum('amount'))['total'] or 0
            month_trend.append({
                'label': f'W{4 - i}',
                'value': float(week_total),
            })

        # Recent transactions
        recent = ExpenseSerializer(
            Expense.objects.filter(user=request.user)[:5], many=True
        ).data

        return Response({
            'total_spent': float(total_spent),
            'today_spent': float(today_spent),
            'today_count': today_count,
            'avg_per_day': round(avg_per_day, 2),
            'top_category': {
                'id': top_category['category__id'],
                'name': top_category['category__name'],
                'emoji': top_category['category__emoji'],
                'color': top_category['category__color'],
                'total': float(top_category['total']),
            } if top_category else None,
            'category_breakdown': [
                {
                    'id': c['category__id'],
                    'name': c['category__name'],
                    'emoji': c['category__emoji'],
                    'color': c['category__color'],
                    'total': float(c['total']),
                }
                for c in category_breakdown
            ],
            'week_trend': week_trend,
            'month_trend': month_trend,
            'recent': recent,
            'budget': 50000,
        })

    # ---- Analytics ----
    @action(detail=False, methods=['get'])
    def analytics(self, request):
        today = date.today()

        # Last 6 months totals
        monthly_data = []
        for i in range(5, -1, -1):
            m = today.month - i
            y = today.year
            while m <= 0:
                m += 12
                y -= 1
            month_total = Expense.objects.filter(
                user=request.user, date__year=y, date__month=m
            ).aggregate(total=Sum('amount'))['total'] or 0
            month_label = date(y, m, 1).strftime('%b')
            monthly_data.append({
                'label': month_label,
                'value': float(month_total),
            })

        # Category breakdown for current month
        cat_totals = list(
            Expense.objects.filter(
                user=request.user,
                date__year=today.year, date__month=today.month
            )
            .values('category__id', 'category__name', 'category__emoji', 'category__color')
            .annotate(total=Sum('amount'))
            .order_by('-total')
        )

        # Top expenses this month
        top_expenses = ExpenseSerializer(
            Expense.objects.filter(
                user=request.user,
                date__year=today.year, date__month=today.month
            ).order_by('-amount')[:8],
            many=True
        ).data

        return Response({
            'monthly_comparison': monthly_data,
            'category_breakdown': [
                {
                    'id': c['category__id'],
                    'name': c['category__name'],
                    'emoji': c['category__emoji'],
                    'color': c['category__color'],
                    'total': float(c['total']),
                }
                for c in cat_totals
            ],
            'top_expenses': top_expenses,
        })

    # ---- Monthly Report (JSON) ----
    @action(detail=False, methods=['get'], url_path='report')
    def monthly_report(self, request):
        month = request.query_params.get('month')
        if not month:
            today = date.today()
            month = f"{today.year}-{today.month:02d}"

        try:
            year, m = month.split('-')
            year, m = int(year), int(m)
        except (ValueError, IndexError):
            return Response({'detail': 'Invalid month format. Use YYYY-MM.'},
                            status=status.HTTP_400_BAD_REQUEST)

        qs = Expense.objects.filter(
            user=request.user, date__year=year, date__month=m
        )
        total = qs.aggregate(total=Sum('amount'))['total'] or 0
        count = qs.count()

        cat_breakdown = list(
            qs.values('category__id', 'category__name', 'category__emoji', 'category__color')
            .annotate(total=Sum('amount'))
            .order_by('-total')
        )

        expenses = ExpenseSerializer(qs.order_by('-amount'), many=True).data

        return Response({
            'month': month,
            'total': float(total),
            'count': count,
            'category_breakdown': [
                {
                    'id': c['category__id'],
                    'name': c['category__name'],
                    'emoji': c['category__emoji'],
                    'color': c['category__color'],
                    'total': float(c['total']),
                }
                for c in cat_breakdown
            ],
            'expenses': expenses,
        })

    # ---- Download Report as CSV ----
    @action(detail=False, methods=['get'], url_path='report/download')
    def download_report(self, request):
        month = request.query_params.get('month')
        if not month:
            today = date.today()
            month = f"{today.year}-{today.month:02d}"

        try:
            year, m = month.split('-')
            year, m = int(year), int(m)
        except (ValueError, IndexError):
            return Response({'detail': 'Invalid month format.'},
                            status=status.HTTP_400_BAD_REQUEST)

        qs = Expense.objects.filter(
            user=request.user, date__year=year, date__month=m
        ).select_related('category').order_by('-date')

        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="expenses_{month}.csv"'

        writer = csv.writer(response)
        writer.writerow(['Title', 'Amount', 'Category', 'Date', 'Notes'])
        for exp in qs:
            writer.writerow([
                exp.title,
                exp.amount,
                exp.category.name if exp.category else 'Uncategorized',
                exp.date.isoformat(),
                exp.notes,
            ])

        return response

    # ---- CSV Import ----
    @action(detail=False, methods=['post'], url_path='import-csv',
            parser_classes=[MultiPartParser, FormParser])
    def import_csv(self, request):
        serializer = CSVImportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        csv_file = serializer.validated_data['file']
        decoded = csv_file.read().decode('utf-8')
        reader = csv.DictReader(io.StringIO(decoded))

        # Build a lookup for category names -> Category objects
        from django.db.models import Q
        existing_cats = {
            c.name.lower(): c
            for c in Category.objects.filter(
                Q(is_default=True) | Q(user=request.user)
            )
        }

        created = 0
        errors = []

        for row_num, row in enumerate(reader, start=2):  # start=2 (header is row 1)
            title = (row.get('Title') or row.get('title') or '').strip()
            amount = row.get('Amount') or row.get('amount')
            cat_name = (row.get('Category') or row.get('category') or '').strip()
            exp_date = row.get('Date') or row.get('date')
            notes = (row.get('Notes') or row.get('notes') or '').strip()

            # Validate required fields
            if not title or not amount or not exp_date:
                errors.append(f'Row {row_num}: Missing title, amount, or date.')
                continue

            try:
                amount = float(amount)
                if amount <= 0:
                    raise ValueError
            except (ValueError, TypeError):
                errors.append(f'Row {row_num}: Invalid amount "{amount}".')
                continue

            # Match category
            category = existing_cats.get(cat_name.lower()) if cat_name else None

            try:
                Expense.objects.create(
                    user=request.user,
                    title=title,
                    amount=amount,
                    category=category,
                    date=exp_date,
                    notes=notes,
                )
                created += 1
            except Exception as e:
                errors.append(f'Row {row_num}: {str(e)}')

        return Response({
            'created': created,
            'errors': errors,
        }, status=status.HTTP_201_CREATED if created > 0 else status.HTTP_400_BAD_REQUEST)
