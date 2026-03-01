from django.contrib import admin
from django.urls import path, include
from django.views.generic import TemplateView
from django.conf import settings
from django.http import FileResponse
import os


def serve_frontend_file(request, filename):
    """Serve frontend static files (CSS/JS) from the parent directory."""
    filepath = os.path.join(settings.FRONTEND_DIR, filename)
    if os.path.isfile(filepath):
        content_types = {
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.html': 'text/html',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
        }
        ext = os.path.splitext(filename)[1].lower()
        content_type = content_types.get(ext, 'application/octet-stream')
        return FileResponse(open(filepath, 'rb'), content_type=content_type)
    from django.http import Http404
    raise Http404


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('expenses.urls')),
    path('api/auth/', include('accounts.urls')),
    # Serve frontend static files
    path('style.css', serve_frontend_file, {'filename': 'style.css'}),
    path('app.js', serve_frontend_file, {'filename': 'app.js'}),
    # Serve frontend index
    path('', TemplateView.as_view(template_name='index.html'), name='home'),
]
