from rest_framework import serializers
from .models import Expense, Category


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'emoji', 'color', 'is_default', 'created_at']
        read_only_fields = ['id', 'created_at']


class ExpenseSerializer(serializers.ModelSerializer):
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.all(),
        source='category',
        write_only=True,
        required=False,
        allow_null=True,
    )
    category_detail = CategorySerializer(source='category', read_only=True)

    class Meta:
        model = Expense
        fields = [
            'id', 'title', 'amount', 'category_id', 'category_detail',
            'date', 'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError('Amount must be greater than zero.')
        if value > 99999999:
            raise serializers.ValidationError('Amount is unreasonably large.')
        return value

    def validate_title(self, value):
        if len(value.strip()) < 2:
            raise serializers.ValidationError('Title must be at least 2 characters.')
        return value.strip()


class CSVImportSerializer(serializers.Serializer):
    file = serializers.FileField()

    def validate_file(self, value):
        if not value.name.endswith('.csv'):
            raise serializers.ValidationError('Only CSV files are accepted.')
        if value.size > 5 * 1024 * 1024:  # 5 MB limit
            raise serializers.ValidationError('File size must be under 5 MB.')
        return value
