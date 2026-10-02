# Igitoro Live 🇧🇮
Application communautaire mobile-first pour consulter des informations récentes sur le carburant à Bujumbura.

## Contraintes
Pas de carte intégrée, GPS, tracking, offline, PWA agressive, SMS, téléphone obligatoire ou score de réputation. Google Sign-In uniquement. L'information carburant reste gratuite et une station ne peut pas payer pour apparaître disponible.

## Local
`python -m venv .venv` puis `pip install -r requirements.txt`, copier `.env.example` vers `.env`, exécuter `python -m app.seed`, puis `uvicorn app.main:app --reload`.

## Docker
`docker compose up --build` après configuration de `.env`.

## Tests
`pytest -q`

Avant production Railway : configurer PostgreSQL, HTTPS, SECRET_KEY aléatoire, Google Client ID et un stockage durable des photos.
