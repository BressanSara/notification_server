import express, { Request, Response } from "express";
import * as admin from "firebase-admin";
import * as fs from "fs";
import axios from "axios";

// Configurazione Firebase Admin SDK
const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

const app = express();
app.use(express.json());

const tokensFile = "./tokens.json";
const remindersFile = "./reminders.json";

// Funzione per ottenere la chiave API
const getApiKey = (): string => {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
        throw new Error("Chiave API non trovata nelle variabili d'ambiente");
    }
    return apiKey;
};

// Funzione per leggere un file JSON
const readFile = (filePath: string): any[] => {
    if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    return [];
};

// Funzione per scrivere un file JSON
const writeFile = (filePath: string, data: any[]) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
};

// Endpoint per registrare un token
app.post("/register", (req: Request, res: Response) => {
    const { token } = req.body;
    if (!token) return res.status(400).send("Token mancante");

    const tokens = readFile(tokensFile);
    if (!tokens.includes(token)) {
        tokens.push(token);
        writeFile(tokensFile, tokens);
    }
    res.send("Token salvato con successo");
});

// Endpoint per inviare notifiche
app.post("/send-notification", async (req: Request, res: Response) => {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).send("Titolo o corpo della notifica mancanti");

    const tokens = readFile(tokensFile);
    if (tokens.length === 0) return res.status(400).send("Nessun token registrato");

    const messages = tokens.map((token) => ({
        token,
        notification: { title, body },
    }));

    try {
        await Promise.all(messages.map((message) => admin.messaging().send(message)));
        res.send("Notifiche inviate con successo");
    } catch (error) {
        console.error("Errore nell'invio delle notifiche:", error);
        res.status(500).send("Errore nell'invio delle notifiche");
    }
});

// Endpoint per aggiungere un reminder
app.post("/reminders", (req: Request, res: Response) => {
    const { token, lat, lon, maxTemp, minTemp } = req.body;
    if (!token || !lat || !lon || (!maxTemp && !minTemp)) {
        return res.status(400).send("Dati mancanti");
    }

    const reminders = readFile(remindersFile);
    const newReminder = { id: Date.now(), token, lat, lon, maxTemp, minTemp };
    reminders.push(newReminder);
    writeFile(remindersFile, reminders);

    res.status(201).send(newReminder);
});

// Endpoint per ottenere tutti i reminder
app.get("/reminders", (req: Request, res: Response) => {
    const reminders = readFile(remindersFile);
    if (reminders.length === 0) return res.status(404).send("Nessun reminder trovato");
    res.send(reminders);
});

// Endpoint per aggiornare un reminder
app.put("/reminders/:id", (req: Request, res: Response) => {
    const { id } = req.params;
    const { lat, lon, maxTemp, minTemp } = req.body;

    const reminders = readFile(remindersFile);
    const reminder = reminders.find((r) => r.id === parseInt(id));
    if (!reminder) return res.status(404).send("Reminder non trovato");

    if (lat) reminder.lat = lat;
    if (lon) reminder.lon = lon;
    if (maxTemp !== undefined) reminder.maxTemp = maxTemp;
    if (minTemp !== undefined) reminder.minTemp = minTemp;

    writeFile(remindersFile, reminders);
    res.send(reminder);
});

// Endpoint per eliminare un reminder
app.delete("/reminders/:id", (req: Request, res: Response) => {
    const { id } = req.params;

    const reminders = readFile(remindersFile);
    const updatedReminders = reminders.filter((r) => r.id !== parseInt(id));
    if (reminders.length === updatedReminders.length) {
        return res.status(404).send("Reminder non trovato");
    }

    writeFile(remindersFile, updatedReminders);
    res.status(204).send();
});

// Funzione per controllare le condizioni meteo e inviare notifiche
const checkWeatherAndNotify = async () => {
    const reminders = readFile(remindersFile);
    const OPENWEATHER_API_KEY = getApiKey();

    for (const reminder of reminders) {
        const { token, lat, lon, maxTemp, minTemp } = reminder;

        try {
            const response = await axios.get(
                `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${OPENWEATHER_API_KEY}`
            );
            const currentTemp = response.data.main.temp;

            if (
                (maxTemp !== undefined && currentTemp > maxTemp) ||
                (minTemp !== undefined && currentTemp < minTemp)
            ) {
                await admin.messaging().send({
                    token,
                    notification: {
                        title: "Allerta Meteo",
                        body: `La temperatura è ${currentTemp}°C, superando la soglia impostata.`,
                    },
                });
            }
        } catch (error) {
            console.error("Errore nel controllo meteo o invio notifica:", error);
        }
    }
};

// Avvio del controllo periodico ogni 10 minuti
setInterval(checkWeatherAndNotify, 10 * 60 * 1000);

// Avvio del server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server in esecuzione su http://localhost:${PORT}`);
});