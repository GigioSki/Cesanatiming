# Cesana Timing

Applicazione Node.js per gestire un semplice sistema di cronometraggio tramite MQTT e database SQLite.

## Installazione

1. Clona il repository e posizionati nella cartella del progetto.
2. Installa le dipendenze:
   ```bash
   npm install
   ```
3. Configura `config/config.json` impostando credenziali MQTT, porta del web server e percorsi dei database.
4. Avvia il server:
   ```bash
   node index.js
   ```
5. Visita `http://localhost:3000/` (o la porta configurata) per la schermata dei tempi. La pagina di setup si trova a `/setup.html` e richiede autenticazione.

## Struttura cartelle

- **html/** contiene i file HTML (`timing.html` e `setup.html`).
- **css/** contiene i fogli di stile.
- **data/** verrà creata automaticamente e conterrà i database SQLite.
- **config/** contiene il file `config.json` con le impostazioni dell'applicazione.

## Utilizzo

- Nella pagina **Setup** è possibile associare un colore e un nome agli UUID rilevati o inseriti manualmente, oltre a gestire i database.
- Nella pagina **Tempi** vengono mostrati in tempo reale i cronometraggi ricevuti via MQTT.

