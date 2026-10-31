# KARMA API — Python 3.12 + FastAPI + Qdrant + Redis + Motor (MongoDB)
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY server.py .

EXPOSE 5001
CMD ["python", "server.py"]
