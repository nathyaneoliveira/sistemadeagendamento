FROM node:22-alpine AS frontend-build

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend/ frontend/
COPY shared/ shared/
ENV VITE_API_URL=/api
RUN npm run build:frontend

FROM php:8.4-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev \
    && docker-php-ext-install pdo_pgsql \
    && rm -rf /var/lib/apt/lists/*

COPY deploy/apache-vhost.conf /etc/apache2/sites-available/000-default.conf
RUN sed -i 's/^Listen 80$/Listen 10000/' /etc/apache2/ports.conf \
    && a2enmod rewrite headers

WORKDIR /var/www/app
COPY php-backend/public/ public/
COPY php-backend/src/ src/
COPY --from=frontend-build /workspace/frontend/dist/ public/

ENV NOA_ENV_FILE=php://memory \
    NODE_ENV=production

EXPOSE 10000
CMD ["apache2-foreground"]
