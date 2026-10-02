# ARCHITECTURE.md
Browser -> Jinja2/HTMX/JS -> FastAPI routers -> services -> SQLAlchemy -> PostgreSQL.

Tables : users, stations, reports, confirmations, abuse_reports, zone_subscriptions, action_logs.

L'agrégateur privilégie le signalement récent dans une fenêtre configurable et expose séparément confirmations et contradictions.
