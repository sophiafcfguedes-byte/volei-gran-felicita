// Service worker mínimo: deixa o Chrome do Android "instalar" o app (com o ícone do escudo). Não guarda nada em cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
