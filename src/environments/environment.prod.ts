/**
 * Entorno de producción (ng build). La app se publica en Netlify: las llamadas a /api/*
 * se reenvían al backend de Elastic Beanstalk mediante public/_redirects (evita mixed content y CORS).
 * Backend real: http://agrocrew-backend.us-east-1.elasticbeanstalk.com/api/v1
 */
export const environment = {
  production: true,
  apiUrl: '/api/v1',
  /** Landing de presentación publicada en Netlify. */
  landingUrl: 'https://agrocrew.netlify.app',
};
