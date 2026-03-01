from django.contrib import admin
from .models import Category, Expense


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'emoji', 'color', 'is_default', 'user']
    list_filter = ['is_default']
    search_fields = ['name']


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ['title', 'amount', 'category', 'date', 'user', 'created_at']
    list_filter = ['category', 'date', 'user']
    search_fields = ['title', 'notes']
    ordering = ['-date', '-created_at']
