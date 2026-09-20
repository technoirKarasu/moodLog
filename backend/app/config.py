import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://moodlog:moodlog@localhost:5432/moodlog",
)
