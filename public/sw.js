// Service worker mínimo: deixa o Chrome do Android "instalar" o app (com o ícone do escudo). Não guarda nada em cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

/* Aviso de aprovação pendente (o servidor manda um push sem conteúdo; o texto fica aqui). */
self.addEventListener('push', e => e.waitUntil(fetch('/api/push/msg', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ title: 'Vôlei Gran Felicitá', body: 'Tem novidade no app.' })).then(m => self.registration.showNotification(m.title || 'Vôlei Gran Felicitá', { body: m.body || '', icon: '/icon-192.png', badge: '/icon-192.png' }))));
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => l.length ? l[0].focus() : self.clients.openWindow('/'))); });
