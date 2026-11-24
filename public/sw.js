// Service worker mínimo: deixa o Chrome do Android "instalar" o app (com o ícone do escudo). Não guarda nada em cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

/* Aviso de aprovação pendente (o servidor manda um push sem conteúdo; o texto fica aqui). */
self.addEventListener('push', e => e.waitUntil(self.registration.showNotification('Vôlei Gran Felicitá', { body: 'Tem aprovação esperando por você: comprovante ou convidado.', icon: '/icon-192.png', badge: '/icon-192.png', tag: 'aprovacao' })));
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: 'window' }).then(l => l.length ? l[0].focus() : self.clients.openWindow('/'))); });
