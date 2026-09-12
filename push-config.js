/* Configuração pública. A chave VAPID pública vem de Firebase → Cloud Messaging → Web Push certificates.
   Não colocar chaves privadas nem credenciais de serviço neste ficheiro. Sem VAPID, push fica indisponível. */
self.MAB_PUSH_CONFIG = {
  vapidKey: 'BAPIRqP9RLZYE1pTtfyc39ZSKNn86BkBuPBww3U5Y_B5Oy2ejeuNSuNj91BmAFuuYHtw1XDepqUracORGMIBYuE',
  functionsRegion: 'europe-west1',
  firebase: {
    apiKey: 'AIzaSyBehpIuU0I17uTt6BmarSSTTbzvYTv69h4',
    authDomain: 'todos-os-euros.firebaseapp.com',
    projectId: 'todos-os-euros',
    messagingSenderId: '87191016785',
    appId: '1:87191016785:web:2bc8f4d09ea884cb9f2f70'
  }
};
