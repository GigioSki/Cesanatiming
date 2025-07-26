# Cesana Timing

Applicazione Node.js per gestire un semplice sistema di cronometraggio tramite MQTT e database SQLite.

## Installazione

1. Clona il repository e posizionati nella cartella del progetto.
2. Installa le dipendenze:
   ```bash
   npm install
   ```
3. Crea `config/config.json` partendo dal facsimile più sotto ed imposta le credenziali MQTT,
   la porta del web server e i percorsi dei database.
4. Avvia il server:
   ```bash
   node index.js
   ```
5. Visita `http://localhost:3000/` (o la porta configurata) per la schermata dei tempi. La pagina di setup si trova a `/setup.html` e richiede autenticazione.

## Avvio con Docker Compose

Per eseguire l'applicazione in container è presente un `docker-compose.yml`.
Da terminale avvia:

```bash
docker-compose up --build
```

La porta `3000` sarà esposta e le cartelle `config` e `data` verranno
montate come volumi per permettere la personalizzazione delle impostazioni e
la persistenza dei database.

## Pubblicazione su Docker Hub

Per creare e caricare l'immagine:

```bash
# build
docker build -t <tuo-utente>/cesana-timing:latest .
# login (una volta sola)
docker login
# push
docker push <tuo-utente>/cesana-timing:latest
```

Sostituisci `<tuo-utente>` con il tuo nome su Docker Hub.

## Struttura cartelle

- **html/** contiene i file HTML (`timing.html` e `setup.html`).
- **css/** contiene i fogli di stile.
- **data/** verrà creata automaticamente e conterrà i database SQLite.
- **config/** contiene il file `config.json` con le impostazioni dell'applicazione (deve essere creato partendo dall'esempio).

## Esempio `config.json`

```json
{
  "web": {
    "host": "0.0.0.0",
    "port": 3000,
    "username": "admin",
    "password": "secret"
  },
  "mqtt": {
    "brokerUrl": "mqtt://test.mosquitto.org:1883",
    "options": {
      "username": "guest",
      "password": "guest"
    },
    "topicStatusStartGate": "crono/status/start",
    "topicStatusStopGate": "crono/status/stop",
    "topicTag": "crono/uuid/start",
    "topicStart": "crono/timing/start",
    "topicEnd": "crono/timing/stop"
  },
  "database": {
    "timingPath": "./data/timing.db",
    "associationsPath": "./data/associations.db"
  }
}
```

## Utilizzo

- Nella pagina **Setup** è possibile associare un colore e un nome agli UUID rilevati o inseriti manualmente, oltre a gestire i database.
- Nella pagina **Tempi** vengono mostrati in tempo reale i cronometraggi ricevuti via MQTT.

