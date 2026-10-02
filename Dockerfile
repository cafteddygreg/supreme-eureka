FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY scripts ./scripts
COPY gunicorn.conf.py .
RUN mkdir -p app/static/uploads
EXPOSE 8000
CMD ["gunicorn","-c","gunicorn.conf.py","app.main:app"]
